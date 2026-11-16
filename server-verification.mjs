import {spawn} from 'node:child_process';
import {cp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';

export function startupEvidence(log,id,side='server') {
  const lines=log.split(/\r?\n/);
  const split=lines.findIndex(line=>line.includes('Mod List:'));
  const loaded=split>=0 && lines.slice(split+1).some(line=>line.trim().endsWith('('+id+')'));
  const ready=side==='client'?lines.some(line=>line.endsWith('JARHOP_CLIENT_TITLE_READY')):lines.some(line=>/\[minecraft\/DedicatedServer\]: Done \([\d.]+s\)!/.test(line));
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

export async function verifyServer({project,directory,id,neo,mods,tools,signal,log=()=>{},side='server'}) {
  signal?.throwIfAborted();
  const verifier=path.join(directory,side+'-verification'), instance=path.join(verifier,'instance');
  await mkdir(path.join(verifier,'mods'),{recursive:true});
  await mkdir(instance,{recursive:true});
  await cp(path.join(project,'gradle'),path.join(verifier,'gradle'),{recursive:true});
  await writeFile(path.join(verifier,'settings.gradle'),"pluginManagement { repositories { gradlePluginPortal(); maven { url = 'https://maven.neoforged.net/releases' } } }\nrootProject.name = 'jarhop-verification'\n");
  for(const [i,mod] of mods.entries()) await writeFile(path.join(verifier,'mods',i+'-'+mod.filename),mod.bytes);
  await writeFile(path.join(instance,'server.properties'),'server-ip=127.0.0.1\nserver-port=0\nview-distance=3\nsimulation-distance=3\n');
  if(side==='client') {
    const java=path.join(verifier,'src/main/java/jarhop/probe'),meta=path.join(verifier,'src/main/resources/META-INF');
    await mkdir(java,{recursive:true});await mkdir(meta,{recursive:true});
    await writeFile(path.join(instance,'options.txt'),'onboardAccessibility:false\n');
    await writeFile(path.join(meta,'neoforge.mods.toml'),'modLoader="javafml"\nloaderVersion="[4,)"\nlicense="MIT"\n[[mods]]\nmodId="jarhop_probe"\nversion="1"\n');
    await writeFile(path.join(java,'Probe.java'),`package jarhop.probe;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.TitleScreen;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
@Mod("jarhop_probe")
@EventBusSubscriber(modid="jarhop_probe")
public final class Probe {
    private static boolean ready;
    @SubscribeEvent public static void tick(ClientTickEvent.Post event) {
        if (!ready && Minecraft.getInstance().screen instanceof TitleScreen) {
            ready = true;
            System.out.println("JARHOP_CLIENT_TITLE_READY");
        }
    }
}
`);
  }
  await writeFile(path.join(verifier,'build.gradle'),`plugins { id 'java'; id 'net.neoforged.moddev' version '2.0.141' }
java.toolchain.languageVersion = JavaLanguageVersion.of(25)
neoForge {
    version = '${neo}'
    ${side==='client'?"mods { register('jarhop_probe') { sourceSet sourceSets.main } }":''}
    runs {
        ${side} {
            ${side}()
            gameDirectory = project.file('instance')
            ${side==='server'?"programArgument '--nogui'":''}
        }
    }
}
dependencies { runtimeOnly fileTree('mods') { include '*.jar' } }
`);
  signal?.throwIfAborted();
  const args=['-classpath',path.join(verifier,'gradle/wrapper/gradle-wrapper.jar'),'org.gradle.wrapper.GradleWrapperMain',
    ...(tools.offline?['--offline']:[]),'--no-daemon','--console=plain',side==='client'?'runClient':'runServer'];
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
          if(outcome||settleTimer||!output.includes(side==='client'?'JARHOP_CLIENT_TITLE_READY':'For help, type "help"')) return;
          const evidence=startupEvidence(output,id,side);
          if(!evidence.ready) return;
          settleTimer=setTimeout(()=>{
            const latest=startupEvidence(output,id,side);
            if(!latest.loaded) stop(Error('NeoForge booted without the packaged mod '+id+'.'));
            else if(latest.errors.length) stop(Error('NeoForge logged errors during startup. See the verification log.'));
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
        else reject(outcome||Error('NeoForge stopped before startup verification completed. See the verification log.'));
      });
    });
  } finally {
    await writeFile(path.join(directory,side+'-verification.log'),output);
  }
}
