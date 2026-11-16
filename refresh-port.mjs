import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {cp,lstat,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';

const exec=promisify(execFile);
const equal=(a,b)=>a===undefined?b===undefined:b!==undefined&&a.equals(b);
const cleanPath=value=>typeof value==='string'&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&/^[\w.-]+$/.test(part));
const skipped=new Set(['.git','.gradle','build','run','run-client','run-server','logs','.jarhop']);
async function tree(root,required=true) {
  const files=new Map();
  async function walk(folder,prefix) {
    const stat=await lstat(folder).catch(error=>{if(!required&&error.code==='ENOENT')return null;throw error;});
    if(!stat) return;
    if(!stat.isDirectory()||stat.isSymbolicLink()) throw Error('Expected a real source directory: '+folder);
    for(const entry of await readdir(folder,{withFileTypes:true})) {
      const name=prefix+entry.name, location=path.join(folder,entry.name);
      if(entry.isDirectory()) await walk(location,name+'/');
      else if(entry.isFile()) files.set(name,await readFile(location));
      else throw Error('Unsupported source entry: '+location);
    }
  }
  await walk(root,'');
  return files;
}

function textFile(bytes) {
  if(!bytes||bytes.includes(0)) return false;
  try { new TextDecoder('utf-8',{fatal:true}).decode(bytes);return true; } catch { return false; }
}

async function mergeText(temp,base,port,upstream) {
  const filename=name=>path.join(temp,name);
  const portUsesCrLf=port.toString('utf8').includes('\r\n');
  const normalize=bytes=>bytes.toString('utf8').replaceAll('\r\n','\n');
  const restore=bytes=>portUsesCrLf?Buffer.from(bytes.toString('utf8').replaceAll('\n','\r\n')):bytes;
  await Promise.all([['base',base],['port',port],['upstream',upstream]].map(([name,bytes])=>writeFile(filename(name),normalize(bytes))));
  const args=['merge-file','-p','--diff3','-L','Existing port','-L','Previous upstream','-L','New upstream',filename('port'),filename('base'),filename('upstream')];
  try {return {bytes:restore((await exec('git',args,{encoding:'buffer',windowsHide:true,maxBuffer:32*1024*1024})).stdout)};}
  catch (error) {
    if(!Number.isInteger(error.code)||error.code<1||error.code>127||!error.stdout?.includes('<<<<<<< Existing port')) throw error;
    return {bytes:restore(error.stdout),conflict:'Overlapping text changes'};
  }
}

export async function refreshPort({template,output,roots}) {
  if(!path.isAbsolute(template)||!path.isAbsolute(output)||!Array.isArray(roots)||!roots.length) throw Error('Provide absolute template and output paths plus at least one source root.');
  for(const root of roots) {
    if(!root||!path.isAbsolute(root.baseline||'')||!path.isAbsolute(root.upstream||'')||!cleanPath(root.portPath)||root.portPath.split('/').some(part=>skipped.has(part))) throw Error('Invalid refresh root.');
  }
  const seen=new Set();
  for(const {portPath} of roots) {
    const key=portPath.toLowerCase();
    if([...seen].some(old=>old===key||old.startsWith(key+'/')||key.startsWith(old+'/'))) throw Error('Refresh roots overlap: '+portPath);
    seen.add(key);
  }
  const templateRoot=await lstat(template);
  if(!templateRoot.isDirectory()||templateRoot.isSymbolicLink()) throw Error('Template must be a real directory.');
  const sources=[template,...roots.flatMap(root=>[root.baseline,root.upstream])];
  if(sources.some(source=>{
    const relative=path.relative(path.resolve(source),path.resolve(output));
    return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));
  })) throw Error('Output must be outside the source trees.');
  await mkdir(output);
  const project=path.join(output,'project');
  await cp(template,project,{recursive:true,filter:async source=>{
    if(path.relative(template,source).split(path.sep).some(part=>skipped.has(part))) return false;
    const stat=await lstat(source);
    if(stat.isSymbolicLink()) throw Error('Template contains a link: '+source);
    return true;
  }});
  const temp=await mkdtemp(path.join(output,'.merge-'));
  const report={status:'merged',changes:[],conflicts:[]};
  try {
    for(const root of roots) {
      const destination=path.join(project,root.portPath);
      const [base,upstream,port]=await Promise.all([tree(root.baseline),tree(root.upstream),tree(destination,false)]);
      for(const name of new Set([...base.keys(),...upstream.keys()])) {
        const before=base.get(name), next=upstream.get(name), current=port.get(name);
        if(equal(before,next)||equal(current,next)) continue;
        const relative=root.portPath+'/'+name;
        const filename=path.join(destination,name);
        let bytes,conflict;
        if(equal(current,before)) bytes=next;
        else if([before,current,next].every(textFile)) ({bytes,conflict}=await mergeText(temp,before,current,next));
        else conflict='Both sides changed a binary, added the same path, or changed a deleted file';
        if(conflict) {
          report.conflicts.push({file:relative,reason:conflict});
          if(next!==undefined) {
            const copy=path.join(output,'incoming',relative);
            await mkdir(path.dirname(copy),{recursive:true});await writeFile(copy,next);
          }
          if(bytes===undefined) continue;
        }
        if(bytes===undefined) await rm(filename,{force:true});
        else {await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,bytes);}
        report.changes.push(relative);
      }
    }
  } finally {
    for(const file of ['base','port','upstream']) await rm(path.join(temp,file),{force:true});
    const {rmdir}=await import('node:fs/promises');
    await rmdir(temp);
  }
  if(report.conflicts.length) report.status='conflicted';
  await writeFile(path.join(output,'refresh-report.json'),JSON.stringify(report,null,2));
  return report;
}
