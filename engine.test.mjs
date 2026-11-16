import {test} from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {inspect,profiles,route,validate} from './engine.mjs';

test('extracts metadata and enumerates files',async()=>{
  const zip=new JSZip();
  zip.file('META-INF/neoforge.mods.toml','[[mods]]\nmodId="viltrumitecore"\nversion="1.12.1"\n[[dependencies.viltrumitecore]]\nmodId="minecraft"\nversionRange="[1.21.1,1.21.2)"\n[[mixins]]\nconfig="test.json"');
  zip.file('assets/mod/lang/en_us.json','{}');
  const result=await inspect(await zip.generateAsync({type:'nodebuffer'}));
  assert.equal(result.id,'viltrumitecore');
  assert.equal(result.minecraft,'[1.21.1,1.21.2)');
  assert.deepEqual(result.assets,['assets/mod/lang/en_us.json']);
  assert.deepEqual(result.mixins,['test.json']);
});

test('rejects invalid, empty, CRC-corrupted and path-traversing ZIPs',async()=>{
  await assert.rejects(inspect(Buffer.from('invalid')),/Invalid ZIP/);
  await assert.rejects(inspect(Buffer.alloc(0)),/empty/);
  const traversal=new JSZip();
  traversal.file('../outside','unsafe');
  await assert.rejects(inspect(await traversal.generateAsync({type:'nodebuffer'})),/Unsafe/);
  const zip=new JSZip();
  zip.file('valid.txt','original');
  const damaged=await zip.generateAsync({type:'nodebuffer',compression:'STORE'});
  damaged[damaged.indexOf('original')]=0;
  await assert.rejects(inspect(damaged),/CRC32/);
});

test('accepts only the pinned original trio and rejects older targets',()=>{
  const inputs=Object.entries(profiles).map(([id,[version,hash]])=>({id,version,hash,minecraft:'[1.21.1,1.21.2)'}));
  assert.doesNotThrow(()=>validate(inputs,route));
  assert.throws(()=>validate(inputs,'1.20.1'),/Unsupported/);
  assert.throws(()=>validate(inputs.slice(1),route),/one original/);
  assert.throws(()=>validate([{...inputs[0],hash:'different'},...inputs.slice(1)],route),/Patch conflict/);
});

test('local prepared mode accepts the original Core and Flight pair without Laser Eyes',()=>{
  const inputs=Object.entries(profiles).filter(([id])=>id!=='lasereyes').map(([id,[version,hash]])=>({id,version,hash,minecraft:'[1.21.1,1.21.2)'}));
  assert.doesNotThrow(()=>validate(inputs,route,true));
  assert.throws(()=>validate(inputs,route),/the three mods/);
  assert.throws(()=>validate(inputs.slice(0,1),route,true),/Core and Flight/);
});
