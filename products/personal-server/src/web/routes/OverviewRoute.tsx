import { useCallback } from 'react';
import type { PersonalServerAppController } from '../app/PersonalServerAppController';
import { LegacyRouteMount } from './LegacyRouteMount';

export function OverviewRoute({ controller }: { readonly controller: PersonalServerAppController }): JSX.Element {
  const mount = useCallback((root: HTMLElement) => controller.mountOverview(root), [controller]);
  return <LegacyRouteMount className="overview-view" dataRole="view-overview" mount={mount} />;
}
