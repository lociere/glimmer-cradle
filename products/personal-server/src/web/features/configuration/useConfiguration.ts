import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { PersonalServerAppController } from '../../app/PersonalServerAppController';
import { ConfigurationController } from './ConfigurationController';
export function useConfiguration(app: PersonalServerAppController) {
  const controller = useMemo(() => new ConfigurationController(), [app]);
  useEffect(() => {
    let connected: boolean | undefined;
    const update = () => { const online = app.getSnapshot().connection === 'online' && app.getSnapshot().session === 'authenticated'; if (online === connected) return; connected = online; controller.connect(online ? app.createConfigurationPort() : null); };
    const unsubscribe = app.subscribe(update); update();
    return () => { unsubscribe(); controller.stop(); };
  }, [app, controller]);
  return { snapshot: useSyncExternalStore(controller.subscribe, controller.getSnapshot), controller };
}
