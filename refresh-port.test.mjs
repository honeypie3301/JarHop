import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {refreshPort} from './refresh-port.mjs';

test('refresh preserves the port, applies upstream changes, and reports overlaps without modifying inputs',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'jarhop-refresh-'));
  const template=path.join(dir,'port'), baseline=path.join(dir,'base'), upstream=path.join(dir,'new'), output=path.join(dir,'job');
  const port=path.join(template,'src');
  try {
    for(const folder of [baseline,upstream,port]) await mkdir(folder,{recursive:true});
    for(const [folder,first,last,overlap] of [[baseline,'old','old','base'],[upstream,'old','upstream','incoming'],[port,'port','old','local']]) {
      await writeFile(path.join(folder,'Example.java'),first+'\na\nb\nc\nd\ne\n'+last+'\n');
      await writeFile(path.join(folder,'conflict.txt'),overlap+'\n');
    }
    await writeFile(path.join(upstream,'new.txt'),'fresh\n');
    for(const folder of [baseline,port]) await writeFile(path.join(folder,'deleted.txt'),'gone\n');
    const report=await refreshPort({template,output,roots:[{baseline,upstream,portPath:'src'}]});
    assert.equal(report.status,'conflicted');
    assert.deepEqual(report.conflicts.map(item=>item.file),['src/conflict.txt']);
    assert.equal(await readFile(path.join(output,'project','src','Example.java'),'utf8'),'port\na\nb\nc\nd\ne\nupstream\n');
    assert.equal(await readFile(path.join(output,'project','src','new.txt'),'utf8'),'fresh\n');
    await assert.rejects(readFile(path.join(output,'project','src','deleted.txt')), {code:'ENOENT'});
    assert.match(await readFile(path.join(output,'project','src','conflict.txt'),'utf8'),/<<<<<<< Existing port/);
    assert.equal(await readFile(path.join(port,'conflict.txt'),'utf8'),'local\n');
  } finally {await rm(dir,{recursive:true,force:true});}
});
