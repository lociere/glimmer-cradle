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
        <Route index element={<Navigate to="/conversation" replace />} />
        <Route path="conversation" element={<ConversationRoute controller={props.controller} />} />
        <Route path="overview" element={<OverviewRoute controller={props.controller} />} />
        <Route path="capabilities" element={<CapabilitiesRoute controller={props.controller} />} />
        <Route path="activity" element={<ActivityRoute controller={props.controller} />} />
        <Route path="settings" element={<SettingsRoute controller={props.controller} />} />
        <Route path="*" element={<UnknownRoute />} />
      </Route>
    </Routes>
  );
}
