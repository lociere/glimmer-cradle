import { randomUUID } from 'node:crypto';

const CANONICAL_BACKUP_ID = /^[0-9]{8}T[0-9]{6}Z(?:-[0-9]{2})?$/;

export function createOperationController(options) {
  return {
    async prepare(body) {
      const operation = String(body.operation || '');
      if (!['backup.create', 'backup.restore', 'service.restart', 'service.stop', 'update.apply'].includes(operation)) {
        return result('error', '未知的运维操作。', await options.snapshot(), options.createOperationId?.() || opId());
      }
      const operationId = options.createOperationId?.() || opId();
      if (operation === 'backup.restore') {
        const backupId = String(body.backup_id || '');
        if (!CANONICAL_BACKUP_ID.test(backupId)) {
          return result('error', '指定备份不存在，无法恢复。', await options.snapshot(), operationId);
        }
        if (!body.confirm) {
          return {
            ...result('preflight', `恢复 ${backupId} 将中断当前服务，并在失败时依赖部署事务回滚。`, await options.snapshot(), operationId),
            requires_confirmation: true,
          };
        }
      }
      if (operation === 'update.apply' && !body.confirm) {
        return {
          ...result('preflight', '更新将触发部署级事务、就绪门与失败回滚；确认后当前连接可能中断。', await options.snapshot(), operationId),
          requires_confirmation: true,
        };
      }
      if (['service.restart', 'service.stop'].includes(operation) && !body.confirm) {
        return {
          ...result('preflight', '服务控制会中断当前连接；确认后才会交给外部事务 owner。', await options.snapshot(), operationId),
          requires_confirmation: true,
        };
      }

      const snapshot = await options.snapshot();
      const command = commandFor(operation, body);
      let handoff;
      try {
        handoff = await options.handoff(command, operationId, operation);
      } catch (error) {
        options.onError?.(operationId, error);
        return result('error', '外部事务 owner 未能接管请求；未修改宿主状态。', snapshot, operationId);
      }
      if (handoff.status === 'conflict') {
        return result('conflict', '宿主已有安装或运维事务持有全局锁，请等待其完成。', snapshot, operationId);
      }
      if (handoff.status !== 'ready') {
        return result('error', '外部事务 owner 未能进入 handoff ready；未修改宿主状态。', snapshot, operationId);
      }
      return {
        ...result('accepted', acceptedMessage(operation), snapshot, operationId),
        acknowledge: async () => {
          try {
            await options.acknowledge(handoff.ackPath);
          } catch (error) {
            options.onError?.(operationId, error);
          }
        },
      };
    },
  };
}

function commandFor(operation, body) {
  if (operation === 'backup.create') return ['backup'];
  if (operation === 'backup.restore') return ['restore', String(body.backup_id)];
  if (operation === 'service.restart') return ['restart'];
  if (operation === 'service.stop') return ['stop'];
  return ['update'];
}

function acceptedMessage(operation) {
  if (operation === 'backup.create') return '已接受备份请求，服务恢复后可在备份列表查看结果。';
  if (operation === 'backup.restore') return '已接受恢复请求，当前控制面连接将中断并在服务恢复后重新建立。';
  if (operation === 'service.restart') return '已接受重启请求，当前控制面连接将重新建立。';
  if (operation === 'service.stop') return '已接受停机请求，当前控制面连接将被关闭。';
  return '已接受更新请求，当前控制面连接将根据部署事务状态中断或恢复。';
}

function result(status, message, snapshot, operationId) {
  return { status, message, snapshot, operation_id: operationId };
}

function opId() {
  return `deployment_op_${randomUUID()}`;
}
