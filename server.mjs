import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readProfiles,validateProfileInputs} from './local-profiles.mjs';
import {inspect,inspectArchive,limit,route,runPort,streamFile,validate} from './engine.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const state=path.join(root,'.jarhop');
const port=4789;
const host='127.0.0.1:'+port;
const jobs=new Map();
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
  const template=path.join(codex,'Viltrumite-26.1.2');
  const config=await readFile(path.join(root,'tools.local.json'),'utf8').then(JSON.parse).catch(error=>{
    if(error.code==='ENOENT') return {};
    throw error;
  });
  return {
    java:path.join(jdk,'bin','java.exe'),template,
    gradle:path.join(template,'gradlew.bat'), offline:true,
    env:{JAVA_HOME:jdk,GRADLE_USER_HOME:cache},
    art:await cached('net.neoforged','AutoRenamingTool','2.0.17','AutoRenamingTool-2.0.17-all.jar'),
    vineflower:await cached('org.vineflower','vineflower','1.11.2','vineflower-1.11.2.jar'),
    mappings:path.join(artifacts,'minecraft_1.21.1_client_mappings.txt'),
    minecraft:path.join(artifacts,'minecraft_1.21.1_client.jar'), ...config
  };
}
const json=(res,status,value)=>res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(value));
async function payload(req,maxSize=limit*3+65536) {
  let size=0;
  const chunks=[];
  for await(const chunk of req) {
    size+=chunk.length;
    if(size>maxSize) throw Error('Input limit exceeded.');
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
  if(saved) jobs.set(id,{...saved,status:saved.status==='running'?'interrupted':saved.status,directory});
}
async function save(job) {
  await writeFile(path.join(job.directory,'job.json'),JSON.stringify(summarize(job)));
}
const server=createServer(async(req,res)=>{
  try {
    if(req.headers.host!==host || (req.method!=='GET' && req.headers.origin!==('http://'+host))) return json(res,403,{error:'Open the app through its loopback URL.'});
    const url=new URL(req.url,'http://'+host);
    if(req.method==='GET' && url.pathname==='/api/local') return json(res,200,{route,profiles:(await localProfiles()).map(({id,title,target,inputs})=>({id,title,target,inputs})),jobs:[...jobs.values()].reverse().map(summarize)});
    if(req.method==='POST' && url.pathname==='/api/local/inspect') {
      const form=await payload(req,limit+65536);
      const jar=form.get('jar');
      if(!jar || typeof jar==='string' || jar.size>limit) throw Error('Choose a JAR up to 24 MiB.');
      return json(res,200,await inspectArchive(Buffer.from(await jar.arrayBuffer())));
    }
    if(req.method==='POST' && url.pathname==='/api/local') {
      if(active) return json(res,409,{error:'A port is already running.'});
      active=true;
      let started=false;
      try {
        const form=await payload(req);
        const selected=form.get('route');
        const profile=selected===route?null:(await localProfiles()).find(item=>item.id===selected);
        if(selected!==route&&!profile) throw Error('Unknown build profile.');
        const uploads=form.getAll('jar');
        if(uploads.length!==(profile?.inputs.length||3) || uploads.some(file=>typeof file==='string'||file.size>limit)) throw Error('Select the original JARs required by the profile, at most 24 MiB each.');
        const bytes=await Promise.all(uploads.map(async file=>Buffer.from(await file.arrayBuffer())));
        const details=await Promise.all(bytes.map(inspect));
        if(profile) validateProfileInputs(details,profile);
        else validate(details,selected);
        const id=randomUUID(),directory=path.join(state,id);
        await mkdir(directory);
        const files=await Promise.all(bytes.map(async (data,i)=>{
          const filename=path.join(directory,details[i].id+'-source.jar');
          await writeFile(filename,data);
          return filename;
        }));
        const job={id,directory,status:'running',stage:'Queued',logs:'',controller:new AbortController(),
          inputs:details.map(({id,version,minecraft,dependencies})=>({id,version,minecraft,dependencies}))};
        const config=await tools();
        if(profile) config.template=profile.template;
        jobs.set(id,job);
        await save(job);
        started=true;
        runPort({files,target:route,directory,tools:config,profile,signal:job.controller.signal,update(stage,line){
          if(stage) job.stage=stage;
          if(line) job.logs=(job.logs+line).slice(-24000);
        }}).then(result=>{
          job.result=result;job.status=result.status;
        }).catch(error=>{
          job.error=error.message; job.status=job.controller.signal.aborted?'cancelled':'failed';
        }).finally(async()=>{active=null;await save(job);}).catch(console.error);
        return json(res,202,summarize(job));
      } finally { if(!started) active=null; }
    }
    const match=url.pathname.match(/^\/api\/local\/([a-f\d-]+)(?:\/([a-z\d.-]+))?$/);
    if(match) {
      const job=jobs.get(match[1]);
      if(!job) return json(res,404,{error:'Unknown job.'});
      if(req.method==='POST' && match[2]==='cancel') {
        job.controller?.abort(Error('Cancelled'));return json(res,200,summarize(job));
      }
      if(req.method==='GET' && !match[2]) return json(res,200,summarize(job));
      if(req.method==='GET' && job.status==='candidate' && ['manifest.json','jarhop-candidate.zip',...job.result.outputs.map(item=>item.filename)].includes(match[2])) {
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+match[2]+'"'});
        return streamFile(path.join(job.directory,'exports',match[2])).pipe(res);
      }
    }
    const file=path.join(root,'dist',url.pathname==='/'?'index.html':url.pathname.slice(1));
    if(req.method==='GET' && file.startsWith(path.join(root,'dist')+path.sep) && existsSync(file) && /\.(html|js|css|svg)$/.test(file)) {
      res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]});
      return streamFile(file).pipe(res);
    }
    json(res,404,{error:'Not found.'});
  } catch(error) { json(res,400,{error:error.message}); }
});
server.listen(port,'127.0.0.1',async()=>{
  await writeFile(path.join(state,'server.pid'),String(process.pid));
  console.log('JarHop running at http://'+host);
});
