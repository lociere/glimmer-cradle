import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { PersonalServerAppController } from '../../app/PersonalServerAppController';
import { ActivityController } from './ActivityController';

export function useActivity(app: PersonalServerAppController) {
  const controller = useMemo(() => new ActivityController(app.createActivityPort()), [app]);
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  return { snapshot: useSyncExternalStore(controller.subscribe, controller.getSnapshot), controller };
}
