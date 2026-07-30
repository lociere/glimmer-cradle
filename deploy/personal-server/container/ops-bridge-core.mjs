import { randomUUID } from 'node:crypto';

const CANONICAL_BACKUP_ID = /^[0-9]{8}T[0-9]{6}Z(?:-[0-9]{2})?$/;
const CANONICAL_OPERATION_ID = /^deployment_op_[A-Za-z0-9][A-Za-z0-9._-]{0,111}$/;
const SUPPORTED_OPERATIONS = new Set([
  'backup.create',
  'backup.restore',
  'service.restart',
  'service.stop',
  'update.apply',
]);
const TERMINAL_HANDOFF_STATES = new Set(['committed', 'failed', 'recovery_required']);

export function createOperationController(options) {
  return {
    async prepare(body) {
      const operation = String(body.operation || '');
      const requestedId = String(body.operation_id || '');
      const operationId = requestedId || options.createOperationId?.() || opId();
      const snapshot = await options.snapshot();

      if (!SUPPORTED_OPERATIONS.has(operation) || !CANONICAL_OPERATION_ID.test(operationId)) {
        return result('error', '未知运维操作或 operation_id 无效。', snapshot, operationId);
      }
      if (operation === 'update.apply') {
        return result(
          'unsupported',
          '更新应用已失败闭合：尚未建立可验证候选与 install-release 固定制品绑定。',
          snapshot,
          operationId,
        );
      }
      if (operation === 'backup.restore') {
        const backupId = String(body.backup_id || '');
        if (!CANONICAL_BACKUP_ID.test(backupId)) {
          return result('error', '指定备份不存在或标识无效，无法恢复。', snapshot, operationId);
        }
        if (!body.confirm) {
          return {
            ...result('preflight', `恢复 ${backupId} 将中断当前服务。`, snapshot, operationId),
            requires_confirmation: true,
          };
        }
      }
      if (['service.restart', 'service.stop'].includes(operation) && !body.confirm) {
        return {
          ...result('preflight', '服务控制会中断当前连接；确认后才交给外部事务 owner。', snapshot, operationId),
          requires_confirmation: true,
        };
      }

      let handoff;
      try {
        handoff = await options.handoff(commandFor(operation, body), operationId, operation);
      } catch (error) {
        options.onError?.(operationId, error);
        return result('error', '外部事务 owner 未能接管请求；未修改宿主状态。', snapshot, operationId);
      }
      if (handoff.status === 'conflict') {
        return result('conflict', '宿主已有事务持有全局锁。', snapshot, operationId);
      }
      if (TERMINAL_HANDOFF_STATES.has(handoff.status)) {
        return {
          ...result(handoff.status, terminalMessage(handoff.status), snapshot, operationId),
          exit_code: handoff.exit_code,
          recovery_action: handoff.recovery_action,
        };
      }
      if (handoff.status === 'started') {
        return result('accepted', acceptedMessage(operation), snapshot, operationId);
      }
      if (handoff.status !== 'ready') {
        return result('error', '外部事务 owner 未进入 ready；未返回 accepted。', snapshot, operationId);
      }

      try {
        const started = await options.acknowledge(handoff);
        if (started.status !== 'started') {
          return result('error', '外部事务 owner 未确认 started；未返回 accepted。', snapshot, operationId);
        }
      } catch (error) {
        options.onError?.(operationId, error);
        return result('error', 'handoff ack/started 失败；未返回 accepted。', snapshot, operationId);
      }
      return result('accepted', acceptedMessage(operation), snapshot, operationId);
    },
  };
}

function commandFor(operation, body) {
  if (operation === 'backup.create') return ['backup'];
  if (operation === 'backup.restore') return ['restore', String(body.backup_id)];
  if (operation === 'service.restart') return ['restart'];
  return ['stop'];
}

function acceptedMessage(operation) {
  if (operation === 'backup.create') return '外部事务 owner 已启动备份。';
  if (operation === 'backup.restore') return '外部事务 owner 已启动恢复，当前连接可能中断。';
  if (operation === 'service.restart') return '外部事务 owner 已启动重启，当前连接将重新建立。';
  return '外部事务 owner 已启动停机。';
}

function terminalMessage(status) {
  if (status === 'committed') return '该 operation 已提交。';
  if (status === 'recovery_required') return '该 operation 需要人工恢复。';
  return '该 operation 已失败。';
}

function result(status, message, snapshot, operationId) {
  return { status, message, snapshot, operation_id: operationId };
}

function opId() {
  return `deployment_op_${randomUUID()}`;
}
