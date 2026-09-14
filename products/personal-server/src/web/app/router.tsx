import { Navigate, Route, Routes } from 'react-router-dom';
import { ActivityRoute } from '../routes/ActivityRoute';
import { CapabilitiesRoute } from '../routes/CapabilitiesRoute';
import { ConversationRoute } from '../routes/ConversationRoute';
import { OverviewRoute } from '../routes/OverviewRoute';
import { SettingsRoute } from '../routes/settings/SettingsRoute';
import { UnknownRoute } from '../routes/UnknownRoute';
import { PersonalServerShell } from '../shell/PersonalServerShell';
import { PersonalServerAppController, type PersonalServerAppSnapshot } from './PersonalServerAppController';

export function PersonalServerRouter(props: {
  readonly controller: PersonalServerAppController;
  readonly snapshot: PersonalServerAppSnapshot;
}): JSX.Element {
  return (
    <Routes>
      <Route element={<PersonalServerShell controller={props.controller} snapshot={props.snapshot} />}>
        <Route index element={<Navigate to="/config" replace />} />
        <Route path="data" element={<ConversationRoute controller={props.controller} />} />
        <Route path="system" element={<OverviewRoute controller={props.controller} />} />
        <Route path="extensions" element={<CapabilitiesRoute controller={props.controller} />} />
        <Route path="capabilities" element={<SettingsRoute controller={props.controller} fixedSection="skills" standalone />} />
        <Route path="system/logs" element={<ActivityRoute controller={props.controller} />} />
        <Route path="system/security" element={<SettingsRoute controller={props.controller} fixedSection="security" standalone system />} />
        <Route path="system/operations" element={<SettingsRoute controller={props.controller} fixedSection="operations" standalone system />} />
        <Route path="config" element={<SettingsRoute controller={props.controller} />} />
        <Route path="*" element={<UnknownRoute />} />
      </Route>
    </Routes>
  );
}
