import path from 'node:path';
import {route} from './route.mjs';

const modId=/^[a-z][a-z0-9_]{1,63}$/;
const filename=/^[a-z0-9][a-z0-9._-]*\.jar$/;

export function readProfiles(value) {
  if(!Array.isArray(value)) throw Error('Expected an array of local build profiles.');
  const ids=new Set([route]);
  for(const profile of value) {
    if(!profile || !/^[a-z0-9-]+$/.test(profile.id||'') || ids.has(profile.id) ||
      typeof profile.title!=='string' || !profile.title.trim() || !/^\d+\.\d+(\.\d+)?$/.test(profile.target||'') ||
      typeof profile.template!=='string' || !path.isAbsolute(profile.template) ||
      !Array.isArray(profile.inputs) || profile.inputs.length<1 || profile.inputs.length>3) {
      throw Error('Invalid local build profile.');
    }
    ids.add(profile.id);
    const mods=new Set(), outputs=new Set(), hashes=new Set();
    for(const input of profile.inputs) {
      if(!input || !modId.test(input.id||'') || mods.has(input.id) ||
        typeof input.version!=='string' || !input.version ||
        !/^[0-9a-f]{64}$/.test(input.sha256||'') || hashes.has(input.sha256) ||
        typeof input.artifact!=='string' || input.artifact.split('/').some(part=>!part || part==='.' || part==='..' || !/^[A-Za-z0-9._-]+$/.test(part))) {
        throw Error('Invalid input in profile '+profile.id+'.');
      }
      const output=path.posix.basename(input.artifact);
      if(!filename.test(output) || outputs.has(output)) throw Error('Expected a unique lowercase JAR filename in '+profile.id+'.');
      mods.add(input.id); outputs.add(output); hashes.add(input.sha256);
    }
  }
  return value;
}

export function validateProfileInputs(inputs,profile) {
  if(inputs.length!==profile.inputs.length || !profile.inputs.every(expected=>inputs.some(input=>
    input.id===expected.id && input.version===expected.version && input.hash===expected.sha256))) {
    throw Error('The selected files do not match the original binaries for '+profile.title+'.');
  }
}
