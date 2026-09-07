import type { PersonalServerAppController } from '../app/PersonalServerAppController';
import { Overview } from '../features/overview/Overview';
import { useOverview } from '../features/overview/useOverview';

export function OverviewRoute({ controller }: { readonly controller: PersonalServerAppController }): JSX.Element {
  return <Overview {...useOverview(controller)} />;
}
