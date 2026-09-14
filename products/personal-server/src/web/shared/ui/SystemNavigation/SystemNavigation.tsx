import { NavLink } from 'react-router-dom';
import styles from './SystemNavigation.module.css';

const items = [
  ['/system', '运行'],
  ['/system/logs', '日志'],
  ['/system/security', '访问与安全'],
  ['/system/operations', '存储与维护'],
] as const;

export function SystemNavigation(): JSX.Element {
  return <nav className={styles.navigation} aria-label="系统分类">
    {items.map(([path, label]) => <NavLink key={path} to={path} end={path === '/system'}>{label}</NavLink>)}
  </nav>;
}
