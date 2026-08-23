import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCoreSkillResponseFrame,
  manualRecoveryProjection,
} from '../src/main/core-skill-response.ts';

test('manual recovery is projected as stable fields instead of inferred from message', () => {
  const frame = buildCoreSkillResponseFrame(
    'core_skill_action_response',
    'action:unsafe:tool:0',
    'error',
    undefined,
    'localized diagnostic text may change',
    manualRecoveryProjection('action:unsafe:tool:0'),
  );

  assert.equal(frame.error_code, 'recovery_required');
  assert.equal(frame.operation_id, 'action:unsafe:tool:0');
  assert.deepEqual(frame.recovery_actions, ['confirm_side_effect_state']);
});
