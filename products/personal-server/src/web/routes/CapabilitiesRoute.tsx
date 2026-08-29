import { useCallback } from 'react';
import type { PersonalServerAppController } from '../app/PersonalServerAppController';
import { LegacyRouteMount } from './LegacyRouteMount';

export function CapabilitiesRoute({ controller }: { readonly controller: PersonalServerAppController }): JSX.Element {
  const mount = useCallback((root: HTMLElement) => controller.mountCapabilities(root), [controller]);
  return <LegacyRouteMount className="extension-view" dataRole="view-capabilities" mount={mount} />;
}
