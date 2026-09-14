import { useSyncExternalStore } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { SkillConfirmationController } from './SkillConfirmationController';
import styles from '../../shared/ui/ConfirmationDialog/ConfirmationDialog.module.css';

export function SkillConfirmation({ controller }: { readonly controller: SkillConfirmationController }): JSX.Element | null {
  const pending = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (!pending) return null;
  const answer = (approved: boolean) => controller.answer(pending.requestId, approved);
  return <ModalOverlay className={styles.overlay} isOpen isDismissable onOpenChange={(open) => { if (!open) answer(false); }}>
    <Modal className={styles.modal}>
      <Dialog className={styles.dialog}>
        <div className={styles.heading}><span>技能请求</span><Heading slot="title">允许执行此动作？</Heading></div>
        <div className={styles.content}>
          {pending.confirmation.title && <p>{pending.confirmation.title}</p>}
          {pending.confirmation.detail && <p>{pending.confirmation.detail}</p>}
          <p>技能：{pending.confirmation.skill_id}</p>
          <p>动作：{pending.confirmation.target_name}</p>
          <p>风险等级：{pending.confirmation.risk_level}</p>
          <p>影响：{pending.confirmation.side_effects.join('、') || '无已声明副作用'}</p>
          <p>关闭或未及时响应会拒绝本次请求。</p>
        </div>
        <div className={styles.actions}>
          <Button className={styles.secondary} autoFocus onPress={() => answer(false)}>拒绝</Button>
          <Button className={styles.primary} onPress={() => answer(true)}>允许本次</Button>
        </div>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
