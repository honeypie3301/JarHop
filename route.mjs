export const limit = 24 * 1024 * 1024;
export const route = 'neoforge-1.21.1-to-26.1.2';
export const profiles = {
  viltrumitecore: ['1.12.1','8d1b59c775595fe71d67c80973a4ef5a1d48cc81fbe93e7ad921389ceffcd490'],
  viltrumiteflight: ['1.6.9','203b0ed927e81bb6f19b7bbf19440fac64a2e168f94e5e8f72f61faf26aad7e4'],
  lasereyes: ['1.3.3','2815bf7be1e355142387308ed9cffe3b4ecc9fb3c3f5a4d5cc5535a955001fbb']
};

function compareVersion(left,right) {
  const a=left.split('.').map(Number),b=right.split('.').map(Number);
  for(let i=0;i<Math.max(a.length,b.length);i++) {
    const delta=(a[i]||0)-(b[i]||0);
    if(delta) return Math.sign(delta);
  }
  return 0;
}

export function includesMinecraft(range,version) {
  if(!range) return false;
  const text=range.trim();
  if(text===version||text==='['+version+']') return true;
  const intervals=text.match(/(?:\[|\()\s*(\d+(?:\.\d+)*)?\s*,\s*(\d+(?:\.\d+)*)?\s*(?:\]|\))/g)||[];
  return intervals.some(interval=>{
    const [min,max]=interval.slice(1,-1).split(',').map(value=>value.trim());
    const from=min?compareVersion(version,min):1,to=max?compareVersion(version,max):-1;
    return (from>0||from===0&&interval.startsWith('['))&&(to<0||to===0&&interval.endsWith(']'));
  });
}


export function supportsPreparedSelection(ids,local) {
  const selected=new Set(ids);
  if(selected.size!==ids.length || ids.some(id=>!Object.hasOwn(profiles,id))) return false;
  return selected.has('viltrumitecore') && selected.has('viltrumiteflight') && (local || selected.has('lasereyes'));
}
