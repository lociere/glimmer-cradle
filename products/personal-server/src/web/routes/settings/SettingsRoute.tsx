import { useCallback } from 'react';
import type { PersonalServerAppController } from '../../app/PersonalServerAppController';
import { LegacyRouteMount } from '../LegacyRouteMount';

export function SettingsRoute({ controller }: { readonly controller: PersonalServerAppController }): JSX.Element {
  const mount = useCallback((root: HTMLElement) => controller.mountSettings(root), [controller]);
  return <LegacyRouteMount className="settings-view" dataRole="view-settings" mount={mount} />;
}
