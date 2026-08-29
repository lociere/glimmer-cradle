import styles from './HealthBadge.module.css';

export type HealthBadgeTone = 'ready' | 'connecting' | 'degraded';

export function HealthBadge(props: {
  readonly label: string;
  readonly tone: HealthBadgeTone;
  readonly dataRole?: string;
}): JSX.Element {
  return (
    <span className={`${styles.badge} ${styles[props.tone]}`} role="status" data-role={props.dataRole}>
      <span className={styles.dot} aria-hidden="true" />
      {props.label}
    </span>
  );
}
