import { ChevronRight, X } from 'lucide-react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Link } from 'react-router-dom';
import type { RuntimeProjection } from '../../../shared/control-center-models';
import styles from './Overview.module.css';

export function RuntimeDetails({ runtime, catalogUpdatedAt, stale }: {
  readonly runtime: RuntimeProjection;
  readonly catalogUpdatedAt: number;
  readonly stale: boolean;
}): JSX.Element {
  const tone = runtime.state === 'ready' ? 'ready' : runtime.state === 'failed' ? 'danger' : 'waiting';
  return (
    <DialogTrigger>
      <Button className={styles.runtimeRow} aria-label={`查看 ${runtime.runtime_id} 详情`}>
        <span className={styles.runtimeMain}><strong>{runtime.runtime_id}</strong><span>{runtime.summary || `${runtime.owner} / ${runtime.phase}`}</span></span>
        <span className={styles.runtimeMeta}>{runtime.owner}<small>{runtime.phase}</small></span>
        <span className={styles[tone]}>{runtime.state}</span><ChevronRight aria-hidden="true" size={16} />
      </Button>
      <ModalOverlay className={styles.scrim} isDismissable>
        <Modal className={styles.drawer}>
          <Dialog className={styles.dialog}>
            {({ close }) => <>
              <div className={styles.drawerHead}>
                <div><span className={styles.eyebrow}>运行体详情</span><Heading slot="title">{runtime.runtime_id}</Heading></div>
                <Button className={styles.close} aria-label="关闭运行体详情" onPress={close} autoFocus><X aria-hidden="true" size={18} /></Button>
              </div>
              {stale && <p role="status" className={styles.waiting}>尚未收到当前连接的目录，以下为上次投影。</p>}
              <p className={styles[tone]}>{runtime.state}</p><p>{runtime.summary || '暂无状态说明。'}</p>
              <dl className={styles.details}>
                <dt>所属模块</dt><dd>{runtime.owner}</dd>
                <dt>启动阶段</dt><dd>{runtime.phase || '未提供'}</dd>
                <dt>阻塞就绪</dt><dd>{runtime.blocking ? '是' : '否'}</dd>
                <dt>目录更新时间</dt><dd>{new Date(catalogUpdatedAt).toLocaleString('zh-CN', { hour12: false })}</dd>
                {runtime.duration_ms != null && <><dt>阶段耗时</dt><dd>{Math.round(runtime.duration_ms)} ms</dd></>}
                {runtime.details_ref && <><dt>诊断引用</dt><dd>{runtime.details_ref}</dd></>}
                {runtime.reconciler && <>
                  <dt>期望状态</dt><dd>{runtime.reconciler.desired}</dd>
                  <dt>实际状态</dt><dd>{runtime.reconciler.actual}</dd>
                  <dt>资源就绪</dt><dd>{runtime.reconciler.readiness}</dd>
                  <dt>资源数量</dt><dd>{runtime.reconciler.resources.length}</dd>
                </>}
              </dl>
              <Link className={styles.action} to="/activity" onClick={close}>查看诊断活动</Link>
            </>}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
