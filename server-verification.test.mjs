import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startupEvidence} from './server-verification.mjs';

test('requires mod discovery and the vanilla dedicated-server readiness line',()=>{
  const ready='[00:00:00] [Server thread/INFO] [minecraft/DedicatedServer]: Done (1.159s)! For help, type "help"';
  const list='     Mod List:\n    Example 1.0.0 (examplemod)\n';
  assert.deepEqual(startupEvidence(list+ready,'examplemod'),{loaded:true,ready:true,errors:[]});
  assert.equal(startupEvidence(ready,'examplemod').loaded,false);
  assert.equal(startupEvidence(list+'Done (1.159s)!','examplemod').ready,false);
  assert.equal(startupEvidence(list+ready+'\n[Server thread/ERROR] [loader/]: Runtime failure','examplemod').errors.length,1);
});
