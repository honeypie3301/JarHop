import {readFile} from 'node:fs/promises';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
try {
  const pid=Number((await readFile(new URL('.jarhop/server.pid',import.meta.url),'utf8')).trim());
  if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid runner PID.');
  if(process.platform==='win32') {
    const script="$proc=Get-CimInstance Win32_Process -Filter 'ProcessId="+pid+"'; $listener=Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 4789 -State Listen -ErrorAction SilentlyContinue; if($proc.Name -eq 'node.exe' -and $proc.CommandLine -match 'server\.mjs' -and $listener.OwningProcess -eq "+pid+"){Stop-Process -Id "+pid+"}";
    await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true});
  } else throw Error('Automatic process restart currently supports Windows.');
} catch(error) {if(error.code!=='ENOENT') throw error;}
for(let attempt=0;attempt<30;attempt++) {
  try {
    await fetch('http://127.0.0.1:4789/api/local',{signal:AbortSignal.timeout(300)});
    await new Promise(resolve=>setTimeout(resolve,100));
    if(attempt===29) throw Error('JarHop is still running. Finish the current session before retrying.');
  } catch(error) {
    if(error.message==='JarHop is still running. Finish the current session before retrying.') throw error;
    break;
  }
}
const child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,detached:true,stdio:'ignore'});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.unref();
console.log('JarHop restarting at http://127.0.0.1:4789');
