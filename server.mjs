import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {mkdir,readFile,readdir,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dependencyCompatibility} from './route.mjs';
import {dynamicRoute,runDynamic} from './dynamic.mjs';
import {readProfiles,validateProfileInputs} from './local-profiles.mjs';
import {inspect,inspectArchive,route,runPort,streamFile,validate,command} from './engine.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const state=path.join(root,'.jarhop');
const port=4789;
const host='127.0.0.1:'+port;
const jobs=new Map();
const saveQueues=new WeakMap();
async function localProfiles() {
  const value=await readFile(path.join(root,'port-profiles.local.json'),'utf8').catch(error=>{
    if(error.code==='ENOENT') return '[]';
    throw error;
  });
  return readProfiles(JSON.parse(value));
}
let active=null;
const defaults=path.join(process.env.USERPROFILE||'', 'Documents','MCreator','Codex');
const codex=process.env.JARHOP_CODEX||defaults;
const cache=path.join(codex,'.regen-build','gradle-home');
const artifacts=path.join(cache,'caches','neoformruntime','artifacts');
const modules=path.join(cache,'caches','modules-2','files-2.1');
async function cached(group,pkg,version,name) {
  const folder=path.join(modules,group,pkg,version);
  for(const hash of await readdir(folder).catch(()=>[])) {
    const file=path.join(folder,hash,name);
    if(existsSync(file)) return file;
  }
}
async function tools() {
  const jdk=process.env.JAVA_HOME||path.join(process.env.USERPROFILE||'','.jdks','openjdk-25.0.1');
  const bundledPort=path.join(state,'ports','viltrumite-26.1.2');
  const template=existsSync(path.join(bundledPort,'settings.gradle'))?bundledPort:path.join(codex,'Viltrumite-26.1.2');
  let config=await readFile(path.join(root,'tools.local.json'),'utf8').then(JSON.parse).catch(error=>{
    if(error.code==='ENOENT') return {};
    throw error;
  });
  const bundled=path.join(root,'gradle');
  const local=path.join(state,'toolchain');
  const names=['AutoRenamingTool-2.0.17-all.jar','vineflower-1.11.2.jar','minecraft_1.21.1_client_mappings.txt','minecraft_1.21.1_client.jar'];
  const paths=names.map(name=>path.join(local,name));
  const independent=paths.every(existsSync);
  const java=path.join(jdk,'bin','java.exe');
  return {
    java:existsSync(java)?java:'java.exe',template,wrapperDir:bundled,
    gradle:path.join(template,'gradlew.bat'), offline:!independent, clientVerification:true,
    env:{...(existsSync(java)?{JAVA_HOME:jdk}:{}),GRADLE_USER_HOME:independent?path.join(state,'gradle-home'):cache},
    art:independent?paths[0]:await cached('net.neoforged','AutoRenamingTool','2.0.17','AutoRenamingTool-2.0.17-all.jar'),
    vineflower:independent?paths[1]:await cached('org.vineflower','vineflower','1.11.2','vineflower-1.11.2.jar'),
    mappings:independent?paths[2]:path.join(artifacts,'minecraft_1.21.1_client_mappings.txt'),
    minecraft:independent?paths[3]:path.join(artifacts,'minecraft_1.21.1_client.jar'), ...config
  };
}
const json=(res,status,value)=>res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(value));
async function payload(req) {
  const chunks=[];
  for await(const chunk of req) {
    chunks.push(chunk);
  }
  return new Response(Buffer.concat(chunks),{headers:{'Content-Type':req.headers['content-type']}}).formData();
}
function summarize(job) {
  const {controller,directory,...publicData}=job;
  return publicData;
}
await mkdir(state,{recursive:true});
for(const id of await readdir(state)) {
  const directory=path.join(state,id);
  const saved=await readFile(path.join(directory,'job.json'),'utf8').then(JSON.parse).catch(()=>null);
  if(!saved) continue;
  const job={...saved,directory};
  if(job.status==='running') {
    job.status='interrupted';
    job.error='The local runner stopped before this build finished. Start a new build to retry.';
    await save(job);
  }
  jobs.set(id,job);
}
async function save(job) {
  const snapshot=JSON.stringify(summarize(job));
  const filename=path.join(job.directory,'job.json');
  const pending=(saveQueues.get(job)||Promise.resolve()).catch(()=>{}).then(async()=>{
    await writeFile(filename+'.tmp',snapshot);
    await rename(filename+'.tmp',filename);
  });
  saveQueues.set(job,pending);
  await pending;
}
const server=createServer(async(req,res)=>{
  try {
    if(req.headers.host!==host || (req.method!=='GET' && req.headers.origin!==('http://'+host))) return json(res,403,{error:'Open the app through its loopback URL.'});
    const url=new URL(req.url,'http://'+host);
    if(req.method==='GET' && url.pathname==='/api/local') return json(res,200,{route,profiles:(await localProfiles()).map(({id,title,target,inputs})=>({id,title,target,inputs})),jobs:[...jobs.values()].reverse().map(summarize)});
    if(req.method==='POST' && url.pathname==='/api/local/inspect') {
      const form=await payload(req);
      const jar=form.get('jar');
      if(!jar || typeof jar==='string' || !jar.size) throw Error('Choose a nonempty JAR.');
      return json(res,200,await inspectArchive(Buffer.from(await jar.arrayBuffer())));
    }
    if(req.method==='POST' && url.pathname==='/api/local') {
      if(active) return json(res,409,{error:'A port is already running.'});
      active=true;
      let started=false;
      try {
        const form=await payload(req);
        const selected=form.get('route');
        const dynamic=selected===dynamicRoute;
        const profile=selected===route||dynamic?null:(await localProfiles()).find(item=>item.id===selected);
        if(!dynamic&&selected!==route&&!profile) throw Error('Unknown build profile.');
        const uploads=form.getAll('jar');
        if((dynamic?(uploads.length<1):(profile?uploads.length!==profile.inputs.length:uploads.length<2||uploads.length>3)) || uploads.some(file=>typeof file==='string'||!file.size)) throw Error('Select the original JARs required by the selected build mode.');
        const bytes=await Promise.all(uploads.map(async file=>Buffer.from(await file.arrayBuffer())));
        const details=await Promise.all(bytes.map(inspect));
        if(profile) validateProfileInputs(details,profile);
        else if(!dynamic) validate(details,selected,true);
        if(dynamic && (new Set(details.map(item=>item.id)).size!==details.length || details.some(item=>!/^[a-z][a-z0-9_]{1,63}$/.test(item.id||'')))) throw Error('Expected distinct NeoForge mod IDs.');
        if(dynamic) {
          const incompatible=details.slice(1).map((item,index)=>[item.id,dependencyCompatibility(item.minecraft,uploads[index+1].name,'26.1.2')]).filter(([,reason])=>reason);
          if(incompatible.length) throw Error('Dependencies must already support Minecraft 26.1.2: '+incompatible.map(([id,reason])=>id+' ('+reason+')').join(', ')+'. For the original Viltrumite JARs, use Prepared project.');
        }
        const id=randomUUID(),directory=path.join(state,id);
        await mkdir(directory);
        const files=await Promise.all(bytes.map(async (data,i)=>{
          const filename=path.join(directory,details[i].id+'-source.jar');
          await writeFile(filename,data);
          return filename;
        }));
        const job={id,directory,status:'running',stage:'Queued',logs:'',startedAt:Date.now(),lastOutputAt:null,controller:new AbortController(),
          inputs:details.map(({id,version,minecraft,dependencies})=>({id,version,minecraft,dependencies}))};
        let config=await tools();
        if(profile) config.template=profile.template;
        jobs.set(id,job);
        await save(job);
        started=true;
        let lastSavedAt=Date.now();
        (async()=>{
          if(dynamic && ['art','vineflower','mappings','minecraft'].some(key=>!config[key]||!existsSync(config[key]))) {
            job.stage='Setting up build tools';
            await save(job);
            await command(process.execPath,[path.join(root,'setup-toolchain.mjs')],{
              cwd:root,signal:job.controller.signal,log:chunk=>{job.logs=(job.logs+chunk).slice(-24000);job.lastOutputAt=Date.now();}
            });
            config=await tools();
          }
          return (dynamic?runDynamic:runPort)({files,target:route,directory,tools:config,profile,local:true,signal:job.controller.signal,update(stage,line){
          if(stage) job.stage=stage;
          if(line) {
            job.logs=(job.logs+line).slice(-24000);
            job.lastOutputAt=Date.now();
          }
          if(stage||Date.now()-lastSavedAt>=3000) {
            lastSavedAt=Date.now();
            save(job).catch(console.error);
          }
        }});
        })().then(result=>{
          job.result=result;job.status=result.status;
        }).catch(error=>{
          job.error=error.message; job.status=job.controller.signal.aborted?'cancelled':'failed';
        }).finally(async()=>{active=null;job.project=existsSync(path.join(job.directory,'migration-project.zip'));job.serverVerificationLog=existsSync(path.join(job.directory,'server-verification.log'));job.clientVerificationLog=existsSync(path.join(job.directory,'client-verification.log'));job.compilerDiagnostics=existsSync(path.join(job.directory,'compiler-errors.json'));await save(job);}).catch(console.error);
        return json(res,202,summarize(job));
      } finally { if(!started) active=null; }
    }
    const match=url.pathname.match(/^\/api\/local\/([a-f\d-]+)(?:\/([a-z\d.-]+))?$/);
    if(match) {
      const job=jobs.get(match[1]);
      if(!job) return json(res,404,{error:'Unknown job.'});
      if(req.method==='POST' && match[2]==='cancel') {
        job.stage='Stopping build processes';job.cancelling=true;job.controller?.abort(Error('Cancelled'));return json(res,200,summarize(job));
      }
      if(req.method==='GET' && (job.project&&['migration-project.zip','migration.log'].includes(match[2]) || job.serverVerificationLog&&match[2]==='server-verification.log' || job.clientVerificationLog&&match[2]==='client-verification.log' || job.compilerDiagnostics&&match[2]==='compiler-errors.json')) {
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+match[2]+'"'});
        return streamFile(path.join(job.directory,match[2])).pipe(res);
      }
      if(req.method==='GET' && !match[2]) return json(res,200,summarize(job));
      if(req.method==='GET' && ['candidate','verified'].includes(job.status) && ['manifest.json',job.result.bundleFilename||'jarhop-candidate.zip',...job.result.outputs.map(item=>item.filename)].includes(match[2])) {
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+match[2]+'"'});
        return streamFile(path.join(job.directory,'exports',match[2])).pipe(res);
      }
    }
    const file=path.join(root,'dist',url.pathname==='/'?'index.html':url.pathname.slice(1));
    if(req.method==='GET' && file.startsWith(path.join(root,'dist')+path.sep) && existsSync(file) && /\.(html|js|css|svg|ico)$/.test(file)) {
      res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.ico':'image/x-icon'}[path.extname(file)],'Cache-Control':'no-cache'});
      return streamFile(file).pipe(res);
    }
    json(res,404,{error:'Not found.'});
  } catch(error) { json(res,400,{error:error.message}); }
});
server.listen(port,'127.0.0.1',async()=>{
  await writeFile(path.join(state,'server.pid'),String(process.pid));
  console.log('JarHop running at http://'+host);
});
