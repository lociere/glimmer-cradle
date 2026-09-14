import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SkillConfirmationController } from './SkillConfirmationController';
import type { SurfaceFrame } from '../../shared/api/personal-server-client';

function request(requestId: string): SurfaceFrame {
  return {
    kind: 'core_skill_confirmation_request', timestamp: 1, request_id: requestId,
    confirmation: { trace_id: 'trace', skill_id: 'test.skill', target_kind: 'tool', target_name: 'write', risk_level: 'high', side_effects: ['write'] },
  };
}

test('确认只回应一次，并发请求被拒绝而不替换正在审阅的动作', () => {
  const controller = new SkillConfirmationController();
  const replies: unknown[] = [];
  controller.receive(request('first'), (approved) => replies.push(['first', approved]));
  controller.receive(request('first'), () => assert.fail('duplicate'));
  controller.receive(request('second'), (approved) => replies.push(['second', approved]));
  assert.equal(controller.getSnapshot()?.requestId, 'first');
  controller.answer('second', true);
  controller.answer('first', true);
  controller.answer('first', true);
  assert.deepEqual(replies, [['second', false], ['first', true]]);
  assert.equal(controller.getSnapshot(), null);
});

test('断线清理撤销旧界面的确认资格，新会话不会收到旧回执', () => {
  const controller = new SkillConfirmationController();
  const replies: boolean[] = [];
  controller.receive(request('old'), () => assert.fail('old session'));
  controller.clear();
  controller.receive(request('new'), (approved) => replies.push(approved));
  controller.answer('old', true);
  assert.equal(controller.getSnapshot()?.requestId, 'new');
  controller.answer('new', false);
  assert.deepEqual(replies, [false]);
});

test('超时拒绝且释放请求，迟到允许不能重新执行', async () => {
  const controller = new SkillConfirmationController(10);
  const replies: boolean[] = [];
  await new Promise<void>((resolve) => {
    controller.receive(request('expired'), (approved) => { replies.push(approved); resolve(); });
  });
  controller.answer('expired', true);
  assert.deepEqual(replies, [false]);
  assert.equal(controller.getSnapshot(), null);
});
