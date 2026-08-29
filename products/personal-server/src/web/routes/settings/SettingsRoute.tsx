import { useEffect, useRef } from 'react';
import type { PersonalServerAppController } from '../../app/PersonalServerAppController';

export function SettingsRoute({ controller }: { readonly controller: PersonalServerAppController }): JSX.Element {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    return controller.mountSettings(root);
  }, [controller]);

  return <section ref={rootRef} className="route-view settings-view" data-role="view-settings" />;
}
