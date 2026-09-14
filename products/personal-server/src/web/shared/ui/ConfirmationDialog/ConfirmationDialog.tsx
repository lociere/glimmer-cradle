import type { ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';
import styles from './ConfirmationDialog.module.css';

export function ConfirmationDialog({ label, title = label, disabled, confirmLabel = `确认${label}`, tone = 'default', dataAction, onConfirm, children }: {
  readonly label: string;
  readonly title?: string;
  readonly disabled?: boolean;
  readonly confirmLabel?: string;
  readonly tone?: 'default' | 'danger';
  readonly dataAction?: string;
  readonly onConfirm: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  return <DialogTrigger>
    <Button className={tone === 'danger' ? styles.dangerTrigger : styles.trigger} data-action={dataAction} isDisabled={disabled}>{label}</Button>
    <ModalOverlay className={styles.overlay} isDismissable>
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog}>{({ close }) => <>
          <div className={styles.heading}><span>请确认</span><Heading slot="title">{title}</Heading></div>
          <div className={styles.content}>{children}</div>
          <div className={styles.actions}>
            <Button className={styles.secondary} onPress={close}>取消</Button>
            <Button className={tone === 'danger' ? styles.danger : styles.primary} onPress={() => { onConfirm(); close(); }}>{confirmLabel}</Button>
          </div>
        </>}</Dialog>
      </Modal>
    </ModalOverlay>
  </DialogTrigger>;
}
