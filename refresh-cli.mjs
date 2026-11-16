import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {command} from './engine.mjs';
import {refreshPort} from './refresh-port.mjs';
import {withRefreshSources} from './refresh-sources.mjs';
try {
  if(process.argv.length!==3) throw Error('Usage: refresh.bat path-to-refresh-config.json');
  const config=JSON.parse(await readFile(process.argv[2],'utf8'));
  const report=await withRefreshSources(config,refreshPort);
  console.log(report.status+' | '+report.changes.length+' changed paths | '+report.conflicts.length+' conflict(s)');
  if(report.conflicts.length) process.exitCode=2;
  else if(config.build) {
    const project=path.join(config.output,'project');
    const javaHome=config.build.javaHome||process.env.JAVA_HOME;
    if(!javaHome||!path.isAbsolute(javaHome)) throw Error('Set build.javaHome or JAVA_HOME to an absolute Java installation path.');
    const log=[];
    try {
      await command(path.join(javaHome,'bin',process.platform==='win32'?'java.exe':'java'),
        ['-classpath',path.join(project,'gradle','wrapper','gradle-wrapper.jar'),'org.gradle.wrapper.GradleWrapperMain',
          ...(config.build.offline?['--offline']:[]),'--no-daemon','--console=plain','build'],
        {cwd:project,env:{...process.env,JAVA_HOME:javaHome,...(config.build.gradleHome?{GRADLE_USER_HOME:config.build.gradleHome}:{})},
          log:chunk=>{log.push(chunk);process.stdout.write(chunk);}});
      report.build='passed';
    } catch(error) {
      report.build='failed';
      throw error;
    } finally {
      await writeFile(path.join(config.output,'refresh-build.log'),log.join(''));
      await writeFile(path.join(config.output,'refresh-report.json'),JSON.stringify(report,null,2));
    }
  }
} catch(error) { console.error(error.message);process.exitCode=1; }
