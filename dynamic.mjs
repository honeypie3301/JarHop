import path from 'node:path';
import {cp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import JSZip from 'jszip';
import {command,inspect} from './engine.mjs';
import {verifyServer} from './server-verification.mjs';
import {runBehaviorSuite} from './verification-suite.mjs';
import {migrateGeneratedApis} from './generated-api-migrations.mjs';

export const dynamicRoute='upload-neoforge-26.1.2';
const target='26.1.2', neo='26.1.2.95';
const lower=range=>range?.match(/^(?:\[|\()?\s*(\d+(?:\.\d+)+)/)?.[1];
import {includesMinecraft} from './route.mjs';
export {includesMinecraft};

const toml='META-INF/neoforge.mods.toml';

async function write(root,name,bytes) {
  if(name.split('/').some(part=>!part||part==='.'||part==='..'||/[<>:"\\|?*\x00-\x1f]/.test(part))) throw Error('Unsupported archive path: '+name);
  const filename=path.join(root,name);
  await mkdir(path.dirname(filename),{recursive:true});
  await writeFile(filename,bytes);
}
const effectNames={MOVEMENT_SPEED:'SPEED',JUMP:'JUMP_BOOST',CONFUSION:'NAUSEA',DAMAGE_RESISTANCE:'RESISTANCE'};
export function migrateJava(source) {
  const tokens=/"{3}[\s\S]*?"{3}|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\bnet\.minecraft\.resources\.ResourceLocation\b|\bResourceLocation\b|\bnet\.minecraft\.world\.entity\.vehicle\.MinecartTNT\b|\b(?:net\.minecraft\.world\.effect\.)?MobEffects\.(?:MOVEMENT_SPEED|JUMP|CONFUSION|DAMAGE_RESISTANCE)\b/g;
  const hasImport=/^\s*import\s+net\.minecraft\.resources\.ResourceLocation\s*;/m.test(source);
  const importsEffects=/^\s*import\s+net\.minecraft\.world\.effect\.MobEffects\s*;/m.test(source);
  let migrated=source.replace(tokens,token=>{
    if(token==='net.minecraft.world.entity.vehicle.MinecartTNT') return 'net.minecraft.world.entity.vehicle.minecart.MinecartTNT';
    const effect=token.match(/^(net\.minecraft\.world\.effect\.)?MobEffects\.(\w+)$/);
    if(effect&&(effect[1]||importsEffects)) return (effect[1]||'')+'MobEffects.'+effectNames[effect[2]];
    if(token==='net.minecraft.resources.ResourceLocation') return 'net.minecraft.resources.Identifier';
    return hasImport&&token==='ResourceLocation'?'Identifier':token;
  });
  if(!/^\s*import\s+net\.minecraft\.world\.effect\.MobEffect\s*;/m.test(migrated) ||
    !/\bextends\s+MobEffect\b/.test(migrated) || /\bjarhopServerLevel\b/.test(migrated)) return migrated;
  const tick=/^([ \t]*(?:public|protected) boolean applyEffectTick\()LivingEntity\s+(\w+),\s*int\s+(\w+)\)/m;
  const match=tick.exec(migrated);
  if(!match) return migrated;
  const [,prefix,entity,amplifier]=match;
  migrated=migrated.replace(tick,()=>prefix+'net.minecraft.server.level.ServerLevel jarhopServerLevel, LivingEntity '+entity+', int '+amplifier+')');
  const superCall=new RegExp('^([ \\t]*return super\\.applyEffectTick\\()'+entity+',\\s*'+amplifier+'\\);','m');
  return migrated.replace(superCall,(_,start)=>start+'jarhopServerLevel, '+entity+', '+amplifier+');');
}

async function archiveProject(project,directory) {
  const zip=new JSZip();
  async function add(folder,prefix) {
    for(const entry of await readdir(folder,{withFileTypes:true})) {
      if(['build','.gradle','run'].includes(entry.name)) continue;
      const name=prefix+entry.name, local=path.join(folder,entry.name);
      if(entry.isDirectory()) await add(local,name+'/');
      else if(entry.isFile()) zip.file(name,await readFile(local));
    }
  }
  await add(project,'');
  await writeFile(path.join(directory,'migration-project.zip'),await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
}

export async function runDynamic({files,directory,tools,signal,update}) {
  const inputs=await Promise.all(files.map(async file=>inspect(await readFile(file))));
  const [input,...dependencies]=inputs;
  if(!input || lower(input.minecraft)!=='1.21.1') throw Error('Select the NeoForge 1.21.1 source mod first.');
  const incompatible=dependencies.filter(dep=>!includesMinecraft(dep.minecraft,target));
  if(incompatible.length) throw Error('Dependency JARs do not declare Minecraft '+target+' compatibility: '+incompatible.map(dep=>dep.id+' ('+(dep.minecraft||'no Minecraft range')+')').join(', ')+'.');
  if(inputs.some(mod=>!/^[a-z][a-z0-9_]{1,63}$/.test(mod.id||'')) || new Set(inputs.map(mod=>mod.id)).size!==inputs.length) throw Error('Expected distinct NeoForge mod IDs.');
  for(const key of ['java','art','mappings','minecraft','vineflower']) if(!tools[key]) throw Error('Missing tool: '+key+'. Run setup-toolchain.bat or configure tools.local.json.');
  const project=path.join(directory,'project');
  const log=[];
  const run=(args,cwd)=>command(tools.java,args,{cwd,signal,env:{...process.env,...tools.env},log:chunk=>{log.push(chunk);update(null,chunk);}});
  await mkdir(project,{recursive:true});
  try {
    update('Generating Gradle project');
    await cp(tools.wrapperDir||path.join(tools.template,'gradle'),path.join(project,'gradle'),{recursive:true});
    await writeFile(path.join(project,'settings.gradle'),"pluginManagement { repositories { gradlePluginPortal(); maven { url = 'https://maven.neoforged.net/releases' } } }\nrootProject.name = '"+input.id+"'\n");
    await writeFile(path.join(project,'build.gradle'),`plugins { id 'java'; id 'net.neoforged.moddev' version '2.0.141' }
java.toolchain.languageVersion = JavaLanguageVersion.of(25)
neoForge { version = '${neo}'; mods { register('${input.id}') { sourceSet sourceSets.main } } }
dependencies { implementation fileTree('libs') { include '*.jar' } }
tasks.withType(JavaCompile).configureEach { options.encoding = 'UTF-8' }
`);
    const metadata=await input.zip.file(toml).async('string');
    const needed=[];
    const updated=metadata.split(/(?=^\[\[)/m).map(section=>{
      if(!section.startsWith('[[dependencies.')) return section;
      const id=section.match(/^\s*modId\s*=\s*"([^"]+)"/m)?.[1];
      if(id==='minecraft'||id==='neoforge') {
        return section.replace(/^(\s*versionRange\s*=\s*)"[^"]+"/m,(_,key)=>key+'"['+(id==='minecraft'?target+',26.1.3':neo+',26.2')+')"');
      }
      if(id && /^\s*(?:type\s*=\s*"required"|mandatory\s*=\s*true)/m.test(section)) needed.push(id);
      return section;
    }).join('');
    const resources=path.join(project,'src/main/resources');
    for(const entry of Object.values(input.zip.files)) {
      if(entry.dir||entry.name.endsWith('.class')||/^META-INF\/(?:MANIFEST\.MF|[^/]+\.(?:SF|RSA|DSA|EC))$/i.test(entry.name)) continue;
      await write(resources,entry.name,entry.name===toml?updated:await entry.async('nodebuffer'));
    }
    for(const [index,dep] of dependencies.entries()) await write(project,'libs/'+dep.id+'.jar',await readFile(files[index+1]));
    update('Remapping and decompiling uploaded JAR');
    const mapped=path.join(directory,'remapped.jar'), decompiled=path.join(directory,'decompiled');
    await mkdir(decompiled);
    await run(['-jar',tools.art,'--input',files[0],'--output',mapped,'--map',tools.mappings,'--reverse','--lib',tools.minecraft,'--threads','2'],directory);
    await run(['-jar',tools.vineflower,'--folder','--thread-count=2','-e='+tools.minecraft,mapped,decompiled],directory);
    const generated=(await readdir(decompiled,{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile()&&entry.name.endsWith('.java'));
    if(!generated.length) throw Error('Decompiler produced no Java sources.');
    for(const entry of generated) {
      const file=path.join(entry.parentPath,entry.name);
      await write(path.join(project,'src/main/java'),path.relative(decompiled,file).split(path.sep).join('/'),migrateGeneratedApis(migrateJava(await readFile(file,'utf8'))));
    }
    const missing=[...new Set(needed)].filter(id=>!dependencies.some(dep=>dep.id===id));
    if(missing.length) throw Error('Missing target-version dependency JARs: '+missing.join(', ')+'.');
    update('Compiling generated sources');
    try { await run(['-classpath',path.join(project,'gradle/wrapper/gradle-wrapper.jar'),'org.gradle.wrapper.GradleWrapperMain',...(tools.offline?['--offline']:[]),'--no-daemon','--console=plain','build'],project); }
    catch(error) {
      if(signal?.aborted) throw error;
      const first=log.join('').split(/\r?\n/).find(line=>/\.java:\d+: error:/.test(line));
      if(!first) throw error;
      const diagnostic=first.trim().replace(/^.*[\\/]([^\\/]+\.java:\d+: error:)/,'$1');
      throw Error('Generated sources failed to compile against NeoForge '+target+'. '+diagnostic+' See the full migration log.',{cause:error});
    }
    const filename=input.id+'-neoforge-'+target+'.jar';
    const bytes=await readFile(path.join(project,'build/libs',input.id+'.jar'));
    const built=await inspect(bytes);
    if(built.id!==input.id||built.version!==input.version||lower(built.minecraft)!==target) throw Error('Output mod metadata does not match the request.');
    const changedAssets=[];
    for(const name of new Set([...input.assets,...built.assets])) {
      const before=await input.zip.file(name)?.async('nodebuffer');
      const after=await built.zip.file(name)?.async('nodebuffer');
      if(!before||!after||!before.equals(after)) changedAssets.push(name);
    }
    update('Verifying packaged JAR on a clean NeoForge server');
    const runtimeMods=[{filename,bytes}];
    for(const [i,dep] of dependencies.entries()) runtimeMods.push({filename:dep.id+'.jar',bytes:await readFile(files[i+1])});
    await verifyServer({project,directory,id:input.id,neo,mods:runtimeMods,tools,signal,log:chunk=>update(null,chunk)});
    let clientStartup='pending', behaviorParity='pending', cases=[];
    if(tools.clientVerification) {
      update('Verifying packaged JAR in a clean NeoForge client');
      await verifyServer({side:'client',project,directory,id:input.id,neo,mods:runtimeMods,tools,signal,log:chunk=>update(null,chunk)});
      clientStartup='passed';
    }
    const suite=tools.verificationSuites?.[input.hash+':'+target];
    if(suite && clientStartup==='passed') {
      update('Running original and port behavior checks');
      const packaged=path.join(directory,'behavior-candidate.jar');
      await writeFile(packaged,bytes);
      const expected={target,source:'1.21.1',neoForge:neo,original:{file:files[0],sha256:input.hash},
        candidate:{file:packaged,sha256:built.hash},dependencies:dependencies.map((dep,i)=>({id:dep.id,file:files[i+1],sha256:dep.hash}))};
      cases=await runBehaviorSuite({script:suite,directory,expected,signal,log:chunk=>update(null,chunk)});
      behaviorParity='passed';
    }
    const status=behaviorParity==='passed'?'verified':'candidate';
    const bundleFilename='jarhop-'+status+'.zip';
    const result={status,bundleFilename,cases,target,inputs:inputs.map(({id,hash})=>({id,hash})),
      outputs:[{filename,hash:built.hash,changedAssets}],rules:['ResourceLocation → Identifier','MobEffects constant names','MinecartTNT package','MobEffect server-level tick signature','Generated attachments, potions, brewing and networking APIs'],tests:{archive:'passed',compile:'passed',serverStartup:'passed',clientStartup,behaviorParity}};
    const report=JSON.stringify(result,null,2);
    const zip=new JSZip();
    zip.file(filename,bytes);zip.file('manifest.json',report);
    await write(directory,'exports/'+filename,bytes);
    await write(directory,'exports/manifest.json',report);
    await write(directory,'exports/'+bundleFilename,await zip.generateAsync({type:'nodebuffer'}));
    return result;
  } finally {
    await writeFile(path.join(directory,'migration.log'),log.join(''));
    await archiveProject(project,directory);
  }
}
