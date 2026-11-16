import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {cp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import JSZip from 'jszip';

import {limit, route, profiles} from './route.mjs';
import {validateProfileInputs} from './local-profiles.mjs';
export {limit, route, profiles};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const commonFields = (text,key) => [...text.matchAll(new RegExp('^\\s*'+key+'\\s*=\\s*"([^"]+)"','gm'))].map(match => match[1]);
const isAsset = name => /^(assets|data)\//.test(name);

async function checkZip(bytes) {
  if (!bytes.length) throw Error('JAR is empty.');
  // Bound the expansion before JSZip decompresses any entry.
  const end = bytes.lastIndexOf(Buffer.from([80,75,5,6]));
  if (end < 0 || end + 22 > bytes.length || end + 22 + bytes.readUInt16LE(end+20) !== bytes.length ||
      bytes.readUInt16LE(end+4) || bytes.readUInt16LE(end+6)) throw Error('Invalid ZIP end record.');
  const count = bytes.readUInt16LE(end+10);
  let offset = bytes.readUInt32LE(end+16), total = 0;
  const availableMemory = process.availableMemory();
  if (count > 24000 || offset + bytes.readUInt32LE(end+12) !== end) throw Error('Unsupported ZIP directory.');
  const names = new Set();
  for (let i=0;i<count;i++) {
    if (offset+46>end || bytes.readUInt32LE(offset)!==0x02014b50) throw Error('Invalid ZIP directory.');
    total += bytes.readUInt32LE(offset+24);
    if (availableMemory>0 && total>availableMemory/2) throw Error('Not enough memory to safely expand this JAR.');
    if (bytes.readUInt16LE(offset+8)&1) throw Error('Encrypted ZIP entries are unsupported.');
    const size = bytes.readUInt16LE(offset+28);
    const name = bytes.toString('utf8',offset+46,offset+46+size);
    if (!name || names.has(name) || name.includes('\\') || /^[/]|^[A-Za-z]:/.test(name) || name.split('/').includes('..')) throw Error('Unsafe or duplicate ZIP entry.');
    names.add(name);
    offset += 46 + size + bytes.readUInt16LE(offset+30) + bytes.readUInt16LE(offset+32);
  }
  if (offset !== end) throw Error('Invalid ZIP directory length.');
  return JSZip.loadAsync(bytes,{checkCRC32:true});
}

export async function inspectArchive(bytes) {
  const zip=await checkZip(bytes);
  const descriptors={'META-INF/neoforge.mods.toml':'NeoForge','META-INF/mods.toml':'Forge','fabric.mod.json':'Fabric','quilt.mod.json':'Quilt'};
  const metadata=Object.keys(descriptors).find(name=>zip.file(name));
  return {loader:descriptors[metadata]||'Unknown',classes:Object.values(zip.files).filter(file=>!file.dir&&file.name.endsWith('.class')).length,sha256:digest(bytes)};
}

export async function inspect(bytes) {
  const zip = await checkZip(bytes);
  const entry = zip.file('META-INF/neoforge.mods.toml');
  if (!entry) throw Error('Expected NeoForge metadata.');
  const metadata = await entry.async('string');
  const [id,...dependencies] = commonFields(metadata,'modId');
  const [version] = commonFields(metadata,'version');
  const minecraft = metadata.split(/\[\[dependencies[^\n]*\]\]/).find(section=>commonFields(section,'modId')[0]==='minecraft');
  const files = Object.values(zip.files).filter(file=>!file.dir).map(file=>file.name);
  return {id,version,dependencies,minecraft:minecraft && commonFields(minecraft,'versionRange')[0],
    hash:digest(bytes),embedded:files.filter(name=>name.endsWith('.jar')),
    mixins:commonFields(metadata,'config'),transformers:files.filter(name=>/accesstransformer.*\.cfg$/.test(name)),
    assets:files.filter(isAsset),zip};
}

export function validate(inputs,target) {
  if (target!==route) throw Error('Unsupported source and target version pair.');
  if (inputs.length!==3 || new Set(inputs.map(input=>input.id)).size!==3) throw Error('Select one original JAR for each of the three mods.');
  const missing = Object.keys(profiles).filter(id=>!inputs.some(input=>input.id===id));
  if (missing.length) throw Error('Missing mod dependencies: '+missing.join(', '));
  for (const input of inputs) {
    const [version,hash] = profiles[input.id];
    if (input.version!==version || !input.minecraft?.includes('1.21.1') || input.hash!==hash) throw Error('Patch conflict: '+input.id+' does not match the supported original binary.');
  }
}

export function command(executable,args,{cwd,env=process.env,signal,log=()=>{}}={}) {
  return new Promise((resolve,reject)=>{
    signal?.throwIfAborted();
    const child=spawn(executable,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const abort=()=>child.kill();
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',chunk=>log(chunk.toString()));
    child.stderr.on('data',chunk=>log(chunk.toString()));
    child.on('error',reject);
    child.on('close',code=>{
      signal?.removeEventListener('abort',abort);
      if (signal?.aborted) reject(signal.reason);
      else if(code===0) resolve();
      else reject(Error(path.basename(executable)+' exited with '+code));
    });
  });
}

export async function runPort({files,target,directory,tools,signal,update,profile}) {
  const inputs=[];
  update('Inspecting inputs');
  for(const file of files) inputs.push(await inspect(await readFile(file)));
  if(profile) validateProfileInputs(inputs,profile);
  else validate(inputs,target);
  for(const key of (profile?['java','template']:['java','art','mappings','minecraft','vineflower','template'])) {
    if (!tools[key]) throw Error('Missing prerequisite: '+key+'. See README.md.');
  }
  const project=path.join(directory,'project'), original=path.join(directory,'original');
  await mkdir(original,{recursive:true});
  const diagnostics=[];
  const run=(exe,args,cwd)=>command(exe,args,{cwd,signal,env:{...process.env,...tools.env},log:chunk=>{
    for (const line of chunk.split(/\r?\n/)) {
      if (diagnostics.length<500 && /ERROR:|Can.t find class|could not decompile/i.test(line)) diagnostics.push(line);
    }
    update(null,chunk);
  }});
  if(!profile) update('Remapping and decompiling');
  for(const [i,input] of (profile?[]:inputs.entries())) {
    const mapped=path.join(original,input.id+'.jar');
    const sources=path.join(original,input.id);
    await mkdir(sources,{recursive:true});
    await run(tools.java,['-jar',tools.art,'--input',files[i],'--output',mapped,'--map',tools.mappings,'--reverse','--lib',tools.minecraft,'--threads','2'],directory);
    await run(tools.java,['-jar',tools.vineflower,'--thread-count=2','-e='+tools.minecraft,mapped,sources],directory);
  }
  update('Staging migration project');
  await cp(tools.template,project,{recursive:true,filter:source=>{
    const relative=path.relative(tools.template,source);
    if(!relative) return true;
    return !relative.split(path.sep).some(part=>['.git','.gradle','build','run','run-server','run-client','logs'].includes(part)) &&
      (profile || /^(viltrumitecore|viltrumiteflight|lasereyes|gradle|libs)(?:[\\/]|$)/.test(relative) || /^(settings.gradle|build.gradle|gradle.properties|gradlew|gradlew.bat)$/.test(relative));
  }});
  update('Building release JARs');
  const gradleArgs=['--no-daemon','--console=plain','build'];
  if(tools.offline) gradleArgs.unshift('--offline');
  await run(tools.java,['-classpath',path.join(project,'gradle','wrapper','gradle-wrapper.jar'),'org.gradle.wrapper.GradleWrapperMain',...gradleArgs],project);
  signal?.throwIfAborted();
  update('Checking exports');
  const exports=path.join(directory,'exports');
  await mkdir(exports);
  const manifest={route:profile?.id||route,target:profile?.target||'26.1.2', status:'candidate', inputs:[], outputs:[],
    tools:profile?{build:'Project Gradle wrapper'}:{java:25,gradle:'9.6.1',neoforge:'26.1.2.95',art:'2.0.17',vineflower:'1.11.2',mappings:'1.21.1 Mojang'},
    patches:[profile?'Local migration project: '+profile.title:'Fingerprint-matched Viltrumite 26.1.2 source template'],
    diagnostics,tests:{archive:'passed',symbolAudit:'pending',runtime:'pending',behaviorParity:'pending'}};
  const bundle=new JSZip();
  for (const input of inputs) {
    const artifact=profile?.inputs.find(item=>item.id===input.id).artifact || input.id+'/build/libs/'+input.id+'-neoforge-26.1.2-'+input.version+'.jar';
    const filename=path.posix.basename(artifact);
    const bytes=await readFile(path.join(project,artifact));
    const built=await inspect(bytes);
    const declaredTarget=built.minecraft?.match(/^(?:\[|\()?\s*(\d+(?:\.\d+)+)(?=[,)\]]|$)/)?.[1];
    if(built.id!==input.id || built.version!==input.version || declaredTarget!==(profile?.target||'26.1.2') ||
       Object.keys(built.zip.files).some(name=>/(?:^|\/)(?:PortSmokeClient|SkinHudSmokeClient|NpcGameModeSmoke)(?:\$[^/]*)?\.class$|\.legacy$/.test(name))) throw Error('Invalid export: '+filename);
    const changedAssets=[];
    const changedClasses=[];
    for(const name of new Set([...Object.keys(input.zip.files),...Object.keys(built.zip.files)].filter(name=>name.endsWith('.class')))) {
      const before=await input.zip.file(name)?.async('nodebuffer');
      const after=await built.zip.file(name)?.async('nodebuffer');
      if(!before||!after||!before.equals(after)) changedClasses.push(name);
    }
    for(const name of new Set([...input.assets,...built.assets])) {
      const before=await input.zip.file(name)?.async('nodebuffer');
      const after=await built.zip.file(name)?.async('nodebuffer');
      if(!before || !after || !before.equals(after)) changedAssets.push(name);
    }
    manifest.inputs.push({id:input.id,hash:input.hash,dependencies:input.dependencies,mixins:input.mixins,transformers:input.transformers,embedded:input.embedded});
    manifest.outputs.push({filename,hash:built.hash,dependencies:built.dependencies,changedAssets,changedClasses});
    await writeFile(path.join(exports,filename),bytes);
    bundle.file(filename,bytes);
  }
  const report=JSON.stringify(manifest,null,2);
  await writeFile(path.join(exports,'manifest.json'),report);
  bundle.file('manifest.json',report);
  await writeFile(path.join(exports,'jarhop-candidate.zip'),await bundle.generateAsync({type:'nodebuffer'}));
  return manifest;
}

export function streamFile(file) { return createReadStream(file); }
