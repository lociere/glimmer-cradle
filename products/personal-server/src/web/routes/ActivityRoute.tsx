import type { PersonalServerAppController } from '../app/PersonalServerAppController';
import { Activity } from '../features/activity/Activity';
import { useActivity } from '../features/activity/useActivity';

export function ActivityRoute({ controller }: { readonly controller: PersonalServerAppController }): JSX.Element {
  return <Activity {...useActivity(controller)} />;
}
