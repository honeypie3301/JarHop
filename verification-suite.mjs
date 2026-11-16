import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {command} from './engine.mjs';

const categories=['gameplay','save-reload','multiplayer','visuals'];

export function validateBehaviorEvidence(report,expected) {
  if(report?.originalSha256!==expected.original.sha256||report?.candidateSha256!==expected.candidate.sha256||
    !Array.isArray(report.cases)) throw Error('Behavior report does not match the original and candidate JARs.');
  const seen=new Set();
  for(const item of report.cases) {
    if(!item||!categories.includes(item.category)||typeof item.name!=='string'||!item.name.trim()||
      item.original!=='passed'||item.candidate!=='passed') throw Error('A behavior scenario failed or lacks a result.');
    seen.add(item.category);
  }
  if(categories.some(name=>!seen.has(name))) throw Error('Behavior report must cover gameplay, save/reload, multiplayer and visuals.');
  return report.cases.map(({category,name,original,candidate})=>({category,name,original,candidate}));
}

export async function runBehaviorSuite({script,directory,expected,signal,log}) {
  if(typeof script!=='string'||!path.isAbsolute(script)) throw Error('Configured behavior suite must be an absolute Node script path.');
  const request=path.join(directory,'behavior-input.json'),report=path.join(directory,'behavior-result.json');
  await writeFile(request,JSON.stringify(expected,null,2));
  const timeout=AbortSignal.timeout(600000);
  await command(process.execPath,[script,request,report],{cwd:directory,signal:signal?AbortSignal.any([signal,timeout]):timeout,log});
  return validateBehaviorEvidence(JSON.parse(await readFile(report,'utf8')),expected);
}
