import path from 'node:path';
import {runPort,route} from './engine.mjs';
import {cp,mkdir} from 'node:fs/promises';
const env=process.env;
const directory=path.resolve('result');
await mkdir(directory,{recursive:true});
if (!env.JARHOP_GRADLE_CACHE) throw Error('Set JARHOP_GRADLE_CACHE to the warmed Gradle cache in the worker image.');
const gradleCache=path.join(directory,'gradle-cache');
await cp(env.JARHOP_GRADLE_CACHE,gradleCache,{recursive:true});
const tools={java:env.JARHOP_JAVA||'java',art:env.JARHOP_ART,vineflower:env.JARHOP_VINEFLOWER,mappings:env.JARHOP_MAPPINGS,
  minecraft:env.JARHOP_MINECRAFT,template:env.JARHOP_TEMPLATE,offline:true,env:{GRADLE_USER_HOME:gradleCache}};
await runPort({files:process.argv.slice(2).map(file=>path.resolve(file)),target:route,directory,tools,
  update(stage,line){if(stage) console.log(stage);if(line) process.stdout.write(line);}});
