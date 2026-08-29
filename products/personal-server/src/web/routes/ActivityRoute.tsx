import { useCallback } from 'react';
import type { PersonalServerAppController } from '../app/PersonalServerAppController';
import { LegacyRouteMount } from './LegacyRouteMount';

export function ActivityRoute({ controller }: { readonly controller: PersonalServerAppController }): JSX.Element {
  const mount = useCallback((root: HTMLElement) => controller.mountActivity(root), [controller]);
  return <LegacyRouteMount className="observability-view" dataRole="view-activity" mount={mount} />;
}
