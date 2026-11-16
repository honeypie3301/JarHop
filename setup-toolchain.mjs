import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdir,readFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('./.jarhop/toolchain/',import.meta.url));
await mkdir(root,{recursive:true});
const resources=[
 ['AutoRenamingTool-2.0.17-all.jar','https://maven.neoforged.net/releases/net/neoforged/AutoRenamingTool/2.0.17/AutoRenamingTool-2.0.17-all.jar','sha256','e977ee4422efb51eb54cc99f939833cef769de8b4aa1043294ce5400c60f3b1f'],
 ['vineflower-1.11.2.jar','https://repo.maven.apache.org/maven2/org/vineflower/vineflower/1.11.2/vineflower-1.11.2.jar','sha256','e1e2415e7f78b34960402c4beddfc88e033d7842a23ecd132a8ec2eadd54f6bf']
];
async function checked(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
  if(!response.ok||!response.body) throw Error('Download failed ('+response.status+'): '+url);
  return response;
}
const manifest=await (await checked('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).json();
const release=manifest.versions.find(item=>item.id==='1.21.1');
if(!release) throw Error('Mojang version manifest did not contain Minecraft 1.21.1.');
const meta=Buffer.from(await (await checked(release.url)).arrayBuffer());
if(createHash('sha1').update(meta).digest('hex')!==release.sha1) throw Error('Minecraft version manifest checksum mismatch.');
const version=JSON.parse(meta.toString());
for(const [key,name] of [['client','minecraft_1.21.1_client.jar'],['client_mappings','minecraft_1.21.1_client_mappings.txt']]) {
  const entry=version.downloads[key];
  resources.push([name,entry.url,'sha1',entry.sha1]);
}
for(const [name,url,algorithm,expected] of resources) {
  const file=path.join(root,name),temp=file+'.partial';
  const hasHash=async candidate=>{const bytes=await readFile(candidate).catch(error=>{if(error.code==='ENOENT')return null;throw error;});return bytes&&createHash(algorithm).update(bytes).digest('hex')===expected;};
  if(await hasHash(file)){console.log(name+' already available.');continue;}
  try {
    await pipeline(Readable.fromWeb((await checked(url)).body),createWriteStream(temp));
    if(!await hasHash(temp)) throw Error('Checksum mismatch: '+name);
    await rename(temp,file);
  } finally {await rm(temp,{force:true});}
  console.log('Installed '+name);
}
console.log('Toolchain ready. Restart JarHop. First builds download Gradle and NeoForge dependencies.');
