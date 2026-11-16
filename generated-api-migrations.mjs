const imported=(source,name)=>new RegExp('^\\s*import\\s+'+name.replaceAll('.','\\.')+'\\s*;','m').test(source);
const defaults={Boolean:'false',Double:'0',Float:'0',Int:'0',Long:'0',String:'""'};

// Match only generated attachments with flat, paired primitive reads and writes.
export function migrateAttachment(source) {
  const old='net.neoforged.neoforge.common.util.INBTSerializable';
  if(!imported(source,old) || (source.match(/implements\s+INBTSerializable<CompoundTag>/g)||[]).length!==1) return source;
  const writer=/public CompoundTag serializeNBT\([^)]*\)\s*\{\s*CompoundTag (\w+) = new CompoundTag\(\);([^{}]+?)return \1;\s*\}/.exec(source);
  const reader=/public void deserializeNBT\([^)]*\bCompoundTag\s+(\w+)\)\s*\{([^{}]+)\}/.exec(source);
  if(!writer||!reader) return source;
  const writes=writer[2].trim().split(/;\s*/).filter(Boolean).map(line=>/^(\w+)\.put(Boolean|Double|Float|Int|Long|String)\(("[^"\\]*"),\s*((?:this\.)?\w+)\)$/.exec(line));
  const reads=reader[2].trim().split(/;\s*/).filter(Boolean).map(line=>/^((?:this\.)?\w+)\s*=\s*(\w+)\.get(Boolean|Double|Float|Int|Long|String)\(("[^"\\]*")\)$/.exec(line));
  if(!writes.length||reads.length!==writes.length||writes.some(entry=>!entry||entry[1]!==writer[1])||reads.some(entry=>!entry||entry[2]!==reader[1])) return source;
  if(reads.some((entry,i)=>entry[1].replace(/^this\./,'')!==writes[i][4].replace(/^this\./,'')||entry[3]!==writes[i][2]||entry[4]!==writes[i][3])) return source;
  const save=writes.map(([, ,type,key,field])=>'         output.put'+type+'('+key+', '+field+');').join('\n');
  const load=reads.map(([,field,,type,key])=>'         '+field+' = input.get'+type+'Or('+key+', '+defaults[type]+');').join('\n');
  const packetReader=reader[0].replace(reader[2],reads.map(([,field,tag,type,key])=>'\n         '+field+' = '+tag+'.get'+type+'Or('+key+', '+defaults[type]+');').join('')+'\n      ');
  return source.replace(old,'net.neoforged.neoforge.common.util.ValueIOSerializable')
    .replace('implements INBTSerializable<CompoundTag>','implements ValueIOSerializable')
    .replace(/@Override\s*(?=public (?:CompoundTag serializeNBT|void deserializeNBT)\()/g,'')
    .replace(reader[0],()=>packetReader+'\n\n      @Override\n      public void serialize(net.minecraft.world.level.storage.ValueOutput output) {\n'+save+'\n      }\n\n      @Override\n      public void deserialize(net.minecraft.world.level.storage.ValueInput input) {\n'+load+'\n      }');
}

export function migrateGeneratedApis(source) {
  let result=migrateAttachment(source);
  if(imported(result,'net.minecraft.world.item.alchemy.Potion')&&imported(result,'net.neoforged.neoforge.registries.DeferredRegister')) {
    result=result.replace(/(\.register\(\s*)("[a-z0-9_./-]+")(\s*,\s*\(\)\s*->\s*new Potion\()(?=new MobEffectInstance)/g,(_,prefix,id,start)=>prefix+id+start+id+', ');
  }
  if(imported(result,'net.minecraft.world.item.crafting.Ingredient')&&imported(result,'net.minecraft.world.item.ItemStack')) {
    result=result.replace(/Ingredient\.of\(new ItemStack\[\]\s*\{\s*new ItemStack\(((?:Items|\w+ModItems)\.\w+(?:\.get\(\))?)\)\s*\}\)/g,'Ingredient.of($1)');
  }
  if(imported(result,'net.minecraft.world.entity.player.Player')) {
    result=result.replace(/(instanceof\s+Player\s+(\w+)[^{}]*\{\s*\2)\.displayClientMessage\(([^;\r\n]+),\s*(true|false)\);/g,
      (_,prefix,variable,message,overlay)=>prefix+'.'+(overlay==='true'?'sendOverlayMessage':'sendSystemMessage')+'('+message+');');
  }
  if(imported(result,'net.neoforged.neoforge.network.registration.PayloadRegistrar')) {
    result=result.replace(/MESSAGES\.forEach\(\(id, networkMessage\) -> registrar\.playBidirectional\(id, networkMessage\.reader\(\), networkMessage\.handler\(\)\)\);/g,
      'MESSAGES.forEach((id, networkMessage) -> registrar.playBidirectional((Type) id, (StreamCodec) networkMessage.reader(), (IPayloadHandler) networkMessage.handler(), (IPayloadHandler) networkMessage.handler()));');
  }
  return result;
}
