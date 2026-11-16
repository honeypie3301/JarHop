import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {readProfiles,validateProfileInputs} from './local-profiles.mjs';

const sha256='a'.repeat(64);
const input={id:'examplemod',version:'1.0.0',sha256,artifact:'build/libs/examplemod.jar'};
const profile={id:'example-26-2',title:'Example',target:'26.2',template:path.resolve('fixture'),inputs:[input]};

test('accepts a single non-Viltrumite mod with its exact original fingerprint',()=>{
  const [configured]=readProfiles([profile]);
  const original={id:input.id,version:input.version,hash:sha256};
  assert.doesNotThrow(()=>validateProfileInputs([original],configured));
  assert.throws(()=>validateProfileInputs([{...original,hash:'b'.repeat(64)}],configured),/original binaries/);
});
test('rejects traversing artifact paths and a reserved profile ID',()=>{
  assert.throws(()=>readProfiles([{...profile,inputs:[{...input,artifact:'../examplemod.jar'}]}]),/Invalid input/);
  assert.throws(()=>readProfiles([{...profile,id:'neoforge-1.21.1-to-26.1.2'}]),/Invalid local/);
});
