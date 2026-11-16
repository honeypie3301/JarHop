import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dependencyRules,migrateDependencyTypes} from './dependency-migrations.mjs';
test('applies only known type moves present in target dependencies and preserves text',()=>{
 const context=dependencyRules([{zip:{files:{'com/geckolib/animation/RawAnimation.class':{}}}}]);
 const input='import software.bernie.geckolib.animation.RawAnimation;\nString s="software.bernie.geckolib.animation.RawAnimation";\n// software.bernie.geckolib.animation.RawAnimation';
 assert.equal(migrateDependencyTypes(input,context),'import com.geckolib.animation.RawAnimation;\nString s="software.bernie.geckolib.animation.RawAnimation";\n// software.bernie.geckolib.animation.RawAnimation');
 assert.equal(migrateDependencyTypes(input,dependencyRules([])),input);
});
