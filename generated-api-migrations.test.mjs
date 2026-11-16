import assert from 'node:assert/strict';
import {test} from 'node:test';
import {migrateAttachment,migrateGeneratedApis} from './generated-api-migrations.mjs';

const source=`import net.neoforged.neoforge.common.util.INBTSerializable;
class Data implements INBTSerializable<CompoundTag> {
  public CompoundTag serializeNBT(Provider provider) {
    CompoundTag nbt = new CompoundTag();
    nbt.putDouble("time", this.time);
    return nbt;
  }
  public void deserializeNBT(Provider provider, CompoundTag nbt) {
    this.time = nbt.getDouble("time");
  }
}`;

test('bridges generated attachments while retaining the original packet NBT methods and keys',()=>{
  const migrated=migrateAttachment(source);
  assert.match(migrated,/implements ValueIOSerializable/);
  assert.match(migrated,/output\.putDouble\("time", this\.time\)/);
  assert.match(migrated,/input\.getDoubleOr\("time", 0\)/);
  assert.match(migrated,/serializeNBT\(Provider provider\)/);
  assert.match(migrated,/nbt\.getDoubleOr\("time", 0\)/);
  assert.equal(migrateAttachment(migrated),migrated);
  const unmatched=source.replace('nbt.getDouble("time")','nbt.getDouble("different")');
  assert.equal(migrateAttachment(unmatched),unmatched);
});

test('keeps non-default ingredient stacks out of the simple vanilla migration',()=>{
  const header='import net.minecraft.world.item.crafting.Ingredient;\nimport net.minecraft.world.item.ItemStack;\n';
  assert.equal(migrateGeneratedApis(header+'Ingredient.of(new ItemStack[]{new ItemStack(Items.PAPER)});'),header+'Ingredient.of(Items.PAPER);');
  const custom=header+'Ingredient.of(new ItemStack[]{new ItemStack(Items.PAPER, 2)});';
  assert.equal(migrateGeneratedApis(custom),custom);
});
