import type { ReactElement, ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';
import styles from './ContextDrawer.module.css';

export function ContextDrawer({ trigger, title, eyebrow, children, width = 'medium' }: {
  readonly trigger: ReactElement;
  readonly title: string;
  readonly eyebrow?: string;
  readonly children: ReactNode | ((close: () => void) => ReactNode);
  readonly width?: 'medium' | 'wide';
}): JSX.Element {
  return <DialogTrigger>
    {trigger}
    <ModalOverlay className={styles.scrim} isDismissable>
      <Modal className={`${styles.drawer} ${styles[width]}`}>
        <Dialog className={styles.dialog}>
          {({ close }) => <>
            <header className={styles.header}>
              <div>{eyebrow && <span>{eyebrow}</span>}<Heading slot="title">{title}</Heading></div>
              <Button className={styles.close} aria-label={`关闭${eyebrow || '详情'}`} onPress={close} autoFocus>
                <X aria-hidden="true" size={18} />
              </Button>
            </header>
            <div className={styles.content}>{typeof children === 'function' ? children(close) : children}</div>
          </>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  </DialogTrigger>;
}
