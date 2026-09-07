import type { PersonalServerAppController } from '../app/PersonalServerAppController';
import { Extensions } from '../features/capabilities/Extensions';
import { useExtensions } from '../features/capabilities/useExtensions';

export function CapabilitiesRoute({ controller }: { readonly controller: PersonalServerAppController }): JSX.Element {
  return <Extensions {...useExtensions(controller)} />;
}
