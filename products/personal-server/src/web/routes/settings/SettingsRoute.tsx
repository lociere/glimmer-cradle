import { useSearchParams } from 'react-router-dom';
import type { PersonalServerAppController } from '../../app/PersonalServerAppController';
import { Configuration, configurationNavigationSections, type ConfigurationSection } from '../../features/configuration/Configuration';
import { useConfiguration } from '../../features/configuration/useConfiguration';
export function SettingsRoute({ controller, fixedSection, standalone = false, system = false }: { readonly controller: PersonalServerAppController; readonly fixedSection?: ConfigurationSection; readonly standalone?: boolean; readonly system?: boolean }) {
  const [params, setParams] = useSearchParams();
  const section = fixedSection ?? (configurationNavigationSections.some(([id]) => id === params.get('section')) ? params.get('section') as ConfigurationSection : 'models');
  return <Configuration {...useConfiguration(controller)} section={section} standalone={standalone} system={system} onSection={next => setParams({ section: next })} />;
}
