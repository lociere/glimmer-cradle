import { randomUUID } from 'node:crypto';

const CANONICAL_BACKUP_ID = /^[0-9]{8}T[0-9]{6}Z(?:-[0-9]{2})?$/;

export function createOperationController(options) {
  let activeOperation = null;

  return {
    async prepare(body) {
      const operation = String(body.operation || '');
      if (!['backup.create', 'backup.restore', 'service.restart', 'service.stop', 'update.apply'].includes(operation)) {
        return result('error', '未知的运维操作。', await options.snapshot(), options.createOperationId?.() || opId());
      }
      if (activeOperation) {
        return result('conflict', '当前已有部署级运维事务在进行中，请等待前一项操作结束。', await options.snapshot(), activeOperation);
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

      const snapshot = await options.snapshot();
      const command = commandFor(operation, body);
      activeOperation = operationId;
      return {
        ...result('accepted', acceptedMessage(operation), snapshot, operationId),
        start: () => {
          let task;
          try {
            task = Promise.resolve(options.launch(command));
          } catch (error) {
            activeOperation = null;
            options.onError?.(operationId, error);
            return;
          }
          void task
            .catch((error) => options.onError?.(operationId, error))
            .finally(() => {
              if (activeOperation === operationId) activeOperation = null;
            });
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
