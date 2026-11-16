// These type moves are checked against the selected target dependency before use.
const moves={
 'software.bernie.geckolib.animation.RawAnimation':'com.geckolib.animation.RawAnimation',
 'software.bernie.geckolib.animation.Animation.LoopType':'com.geckolib.animation.object.LoopType',
 'software.bernie.geckolib.cache.object.GeoBone':'com.geckolib.cache.model.GeoBone'
};
export function dependencyRules(dependencies) {
  const classes=new Set(dependencies.flatMap(dep=>Object.keys(dep.zip.files).filter(name=>name.endsWith('.class')).map(name=>name.slice(0,-6).replaceAll('/','.'))));
  const rules=Object.entries(moves).filter(([,target])=>classes.has(target));
  return {rules,classes};
}
export function migrateDependencyTypes(source,{rules}) {
  const codeTokens=/"{3}[\s\S]*?"{3}|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\b(?:[A-Za-z_$][\w$]*\.)+[A-Za-z_$][\w$]*\b/g;
  return source.replace(codeTokens,token=>{
    for(const [before,after] of rules) {
      if(token===before || token.startsWith(before+'.')) return after+token.slice(before.length);
    }
    return token;
  });
}
