import { useSearchParams } from 'react-router-dom';
import type { PersonalServerAppController } from '../../app/PersonalServerAppController';
import { Configuration, configurationSections, type ConfigurationSection } from '../../features/configuration/Configuration';
import { useConfiguration } from '../../features/configuration/useConfiguration';
export function SettingsRoute({ controller }: { readonly controller: PersonalServerAppController }) {
  const [params, setParams] = useSearchParams();
  const section = configurationSections.some(([id]) => id === params.get('section')) ? params.get('section') as ConfigurationSection : 'models';
  return <Configuration {...useConfiguration(controller)} section={section} onSection={next => setParams({ section: next })} />;
}
