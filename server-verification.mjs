import {spawn} from 'node:child_process';
import {cp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';

export function startupEvidence(log,id) {
  const lines=log.split(/\r?\n/);
  const split=lines.findIndex(line=>line.includes('Mod List:'));
  const loaded=split>=0 && lines.slice(split+1).some(line=>line.trim().endsWith('('+id+')'));
  const ready=lines.some(line=>/\[minecraft\/DedicatedServer\]: Done \([\d.]+s\)!/.test(line));
  const errors=lines.filter(line=>/\/(?:ERROR|FATAL)\]|MixinApplyError|ModLoadingException/.test(line));
  return {loaded,ready,errors};
}

function terminate(child) {
  if(!child.pid) return;
  if(process.platform==='win32') {
    const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    killer.on('error',()=>child.kill());
  } else {
    try { process.kill(-child.pid,'SIGTERM'); } catch { child.kill(); }
  }
}

export async function verifyServer({project,directory,id,neo,mods,tools,signal,log=()=>{}}) {
  signal?.throwIfAborted();
  const verifier=path.join(directory,'server-verification'), instance=path.join(verifier,'instance');
  await mkdir(path.join(verifier,'mods'),{recursive:true});
  await mkdir(instance,{recursive:true});
  await cp(path.join(project,'gradle'),path.join(verifier,'gradle'),{recursive:true});
  await writeFile(path.join(verifier,'settings.gradle'),"pluginManagement { repositories { gradlePluginPortal(); maven { url = 'https://maven.neoforged.net/releases' } } }\nrootProject.name = 'jarhop-verification'\n");
  for(const [i,mod] of mods.entries()) await writeFile(path.join(verifier,'mods',i+'-'+mod.filename),mod.bytes);
  await writeFile(path.join(instance,'server.properties'),'server-ip=127.0.0.1\nserver-port=0\nview-distance=3\nsimulation-distance=3\n');
  await writeFile(path.join(verifier,'build.gradle'),`plugins { id 'java'; id 'net.neoforged.moddev' version '2.0.141' }
java.toolchain.languageVersion = JavaLanguageVersion.of(25)
neoForge {
    version = '${neo}'
    runs {
        server {
            server()
            gameDirectory = project.file('instance')
            programArgument '--nogui'
        }
    }
}
dependencies { runtimeOnly fileTree('mods') { include '*.jar' } }
`);
  signal?.throwIfAborted();
  const args=['-classpath',path.join(verifier,'gradle/wrapper/gradle-wrapper.jar'),'org.gradle.wrapper.GradleWrapperMain',
    ...(tools.offline?['--offline']:[]),'--no-daemon','--console=plain','runServer'];
  let output='';
  try {
    return await new Promise((resolve,reject)=>{
      const child=spawn(tools.java,args,{cwd:verifier,env:{...process.env,...tools.env},
        windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
      let outcome,settleTimer;
      const stop=error=>{
        if(outcome) return;
        outcome=error||'passed';
        terminate(child);
      };
      const timeout=setTimeout(()=>stop(Error('NeoForge startup verification timed out after 180 seconds.')),180000);
      const abort=()=>stop(signal.reason||Error('Verification cancelled.'));
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted) abort();
      for(const stream of [child.stdout,child.stderr]) {
        const decoder=new StringDecoder('utf8');
        stream.on('data',bytes=>{
          const chunk=decoder.write(bytes);
          output+=chunk;
          log(chunk);
          if(outcome||settleTimer||!output.includes('For help, type "help"')) return;
          const evidence=startupEvidence(output,id);
          if(!evidence.ready) return;
          settleTimer=setTimeout(()=>{
            const latest=startupEvidence(output,id);
            if(!latest.loaded) stop(Error('NeoForge booted without the packaged mod '+id+'.'));
            else if(latest.errors.length) stop(Error('NeoForge logged errors during startup. See server verification log.'));
            else stop();
          },3000);
        });
      }
      child.once('error',error=>{outcome=error;});
      child.once('close',()=>{
        clearTimeout(timeout);
        clearTimeout(settleTimer);
        signal?.removeEventListener('abort',abort);
        if(outcome==='passed') resolve('passed');
        else reject(outcome||Error('NeoForge stopped before startup verification completed. See server verification log.'));
      });
    });
  } finally {
    await writeFile(path.join(directory,'server-verification.log'),output);
  }
}
