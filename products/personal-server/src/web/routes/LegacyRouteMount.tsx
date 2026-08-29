import { useEffect, useRef } from 'react';

export function LegacyRouteMount(props: {
  readonly className: string;
  readonly dataRole: string;
  readonly mount: (root: HTMLElement) => () => void;
}): JSX.Element {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    return props.mount(root);
  }, [props.mount]);

  return <section ref={rootRef} className={`route-view ${props.className}`} data-role={props.dataRole} />;
}
