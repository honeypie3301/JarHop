import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {command,inspect} from './engine.mjs';

export async function withRefreshSources(config,run) {
  if(!Array.isArray(config.roots)||!config.roots.some(root=>root?.baselineJar||root?.upstreamJar)) return run(config);
  const {jarTools}=config;
  for(const field of ['java','art','mappings','minecraft','vineflower']) {
    if(!path.isAbsolute(jarTools?.[field]||'')) throw Error('Set jarTools.'+field+' to an absolute path.');
  }
  const temp=await mkdtemp(path.join(os.tmpdir(),'jarhop-upstream-'));
  try {
    const roots=[];
    for(const [index,root] of config.roots.entries()) {
      if(!root?.baselineJar&&!root?.upstreamJar){roots.push(root);continue;}
      if(!path.isAbsolute(root.baselineJar||'')||!path.isAbsolute(root.upstreamJar||'')||
        !['java','resources'].includes(root.kind)) throw Error('Provide two JAR paths and select java or resources.');
      const [baseline,upstream]=await Promise.all([root.baselineJar,root.upstreamJar].map(async jar=>inspect(await readFile(jar))));
      if(baseline.id!==upstream.id || [baseline,upstream].some(mod=>!/^\[?1\.21\.1(?:[\],)]|$)/.test(mod.minecraft||''))) {
        throw Error('Both JARs must be releases of the same NeoForge 1.21.1 mod.');
      }
      const folders=[];
      for(const [i,jar] of [root.baselineJar,root.upstreamJar].entries()) {
        const dir=path.join(temp,index+'-'+i),floor=path.join(dir,'sources');
        await mkdir(floor,{recursive:true});
        if(root.kind==='java') {
          const mapped=path.join(dir,'mapped.jar');
          await command(jarTools.java,['-jar',jarTools.art,'--input',jar,'--output',mapped,'--map',jarTools.mappings,'--reverse','--lib',jarTools.minecraft,'--threads','2'],{cwd:dir});
          const generated=path.join(dir,'decompiled');
          await mkdir(generated);
          await command(jarTools.java,['-jar',jarTools.vineflower,'--folder','--thread-count=2','-e='+jarTools.minecraft,mapped,generated],{cwd:dir});
          const javaFiles=(await readdir(generated,{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile()&&entry.name.endsWith('.java'));
          if(!javaFiles.length) throw Error('No Java sources were recovered from '+jar);
          for(const entry of javaFiles) {
            const original=path.join(entry.parentPath,entry.name);
            await writePart(floor,path.relative(generated,original).split(path.sep).join('/'),await readFile(original));
          }
        } else {
          for(const entry of Object.values([baseline,upstream][i].zip.files)) {
            if(entry.dir||entry.name.endsWith('.class')||/^META-INF\/(?:MANIFEST\.MF|[^/]+\.(?:SF|RSA|DSA|EC))$/i.test(entry.name)) continue;
            await writePart(floor,entry.name,await entry.async('nodebuffer'));
          }
        }
        folders.push(floor);
      }
      roots.push({portPath:root.portPath,baseline:folders[0],upstream:folders[1]});
    }
    return await run({...config,roots});
  } finally {await rm(temp,{recursive:true,force:true});}
}

async function writePart(root,name,bytes) {
  if(name.split('/').some(part=>!part||part==='.'||part==='..'||/[<>:"\\|?*\x00-\x1f]/.test(part))) throw Error('Unsupported archive path: '+name);
  const file=path.join(root,name);
  await mkdir(path.dirname(file),{recursive:true});
  await writeFile(file,bytes);
}
