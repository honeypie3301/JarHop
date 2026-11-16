import {dependencyCompatibility} from './route.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {includesMinecraft,migrateJava} from './dynamic.mjs';

test('accepts a target inside a dependency range and respects exclusive bounds',()=>{
  assert.equal(includesMinecraft('[26.1,26.2)', '26.1.2'),true);
  assert.equal(includesMinecraft('[26.1,26.1.2)', '26.1.2'),false);
  assert.equal(includesMinecraft('[1.21.1,1.22)', '26.1.2'),false);
  assert.equal(includesMinecraft('[26.1.2]', '26.1.2'),true);
});

test('migrates scoped Minecraft type and constant names without changing strings',()=>{
  const source='import net.minecraft.world.effect.MobEffects;\nimport net.minecraft.world.entity.vehicle.MinecartTNT;\nMobEffects.JUMP;\n"MobEffects.JUMP";';
  const migrated=migrateJava(source);
  assert.match(migrated,/vehicle\.minecart\.MinecartTNT/);
  assert.match(migrated,/MobEffects\.JUMP_BOOST/);
  assert.match(migrated,/"MobEffects\.JUMP"/);
  assert.equal(migrateJava('MobEffects.JUMP'),'MobEffects.JUMP');
});

test('adapts legacy vanilla mob-effect tick overrides and forwards the server level',()=>{
  const source='import net.minecraft.world.effect.MobEffect;\nclass Test extends MobEffect {\n public boolean applyEffectTick(LivingEntity entity, int amplification) {\n return super.applyEffectTick(entity, amplification);\n }\n}';
  const migrated=migrateJava(source);
  assert.match(migrated,/applyEffectTick\(net\.minecraft\.server\.level\.ServerLevel jarhopServerLevel, LivingEntity entity, int amplification\)/);
  assert.match(migrated,/return super\.applyEffectTick\(jarhopServerLevel, entity, amplification\);/);
  assert.equal(migrateJava(migrated),migrated);
});

test('an explicit 1.21.1 filename is flagged even if its metadata range is open-ended',()=>{
  assert.match(dependencyCompatibility('[1.21.1,)', 'framework-neoforge-1.21.1-0.13.11.jar','26.1.2'),/identifies a Minecraft 1.21.1 build/);
  assert.equal(dependencyCompatibility('[26.1,26.2)', 'framework-neoforge-26.1.2-0.13.23.jar','26.1.2'),null);
});
