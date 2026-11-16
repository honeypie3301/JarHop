import {get,del} from '@vercel/blob';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {createWriteStream} from 'node:fs';
import {mkdir} from 'node:fs/promises';

const [operation,operator,job]=process.argv.slice(2);
if(!/^[a-z\d-]+$/i.test(operator)||!/^[a-f\d-]{36}$/.test(job)) throw Error('Invalid job inputs.');
const names=[0,1,2].map(i=>`jobs/${operator}/${job}/${i}.jar`);
if(operation==='delete') await Promise.all(names.map(name=>del(name)));
else if(operation==='download') {
  await mkdir('submitted',{recursive:true});
  for(const [i,name] of names.entries()) {
    const blob=await get(name,{access:'private'});
    if(!blob || blob.statusCode!==200) throw Error('Missing uploaded JAR '+i);
    await pipeline(Readable.fromWeb(blob.stream),createWriteStream('submitted/'+i+'.jar'));
  }
} else throw Error('Invalid operation.');
