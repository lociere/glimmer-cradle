import { Link, useLocation } from 'react-router-dom';

export function UnknownRoute(): JSX.Element {
  const location = useLocation();
  return (
    <section className="route-view unknown-route" data-role="view-unknown">
      <span className="page-eyebrow">未知路由</span>
      <h1>这里没有可打开的页面</h1>
      <p><code>{location.pathname}</code> 不属于 Personal Server 的一级域。</p>
      <Link className="primary-link" to="/conversation">返回对话</Link>
    </section>
  );
}
