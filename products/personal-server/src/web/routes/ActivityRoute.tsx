import { useEffect, useRef } from 'react';
import type { PersonalServerAppController } from '../app/PersonalServerAppController';

export function ActivityRoute({ controller }: { readonly controller: PersonalServerAppController }): JSX.Element {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    return controller.mountActivity(root);
  }, [controller]);

  return <section ref={rootRef} className="route-view observability-view" data-role="view-activity" />;
}
