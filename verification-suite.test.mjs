import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateBehaviorEvidence} from './verification-suite.mjs';

const expected={original:{sha256:'original'},candidate:{sha256:'candidate'}};
const report={originalSha256:'original',candidateSha256:'candidate',
  cases:['gameplay','save-reload','multiplayer','visuals'].map(category=>({category,name:category+' fixture',original:'passed',candidate:'passed'}))};

test('requires matching artifacts and passing evidence for all behavior categories',()=>{
  assert.equal(validateBehaviorEvidence(report,expected).length,4);
  assert.throws(()=>validateBehaviorEvidence({...report,candidateSha256:'other'},expected),/does not match/);
  assert.throws(()=>validateBehaviorEvidence({...report,cases:report.cases.slice(0,3)},expected),/must cover/);
  assert.throws(()=>validateBehaviorEvidence({...report,cases:[...report.cases,{...report.cases[0],candidate:'failed'}]},expected),/failed/);
});
