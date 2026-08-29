import { useEffect, useRef } from 'react';
import type { PersonalServerAppController } from '../app/PersonalServerAppController';

export function CapabilitiesRoute({ controller }: { readonly controller: PersonalServerAppController }): JSX.Element {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    return controller.mountCapabilities(root);
  }, [controller]);

  return <section ref={rootRef} className="route-view extension-view" data-role="view-capabilities" />;
}
