import './shared/styles/tokens.css';
import './shared/styles/global.css';
import './shared/styles/layout.css';
import './features/conversation/conversation.css';
import './features/status/status.css';
import './features/extensions/extensions.css';
import './features/observability/observability.css';
import './features/configuration/configuration.css';
import { bootstrapPersonalServerWeb } from './app/bootstrap';

void bootstrapPersonalServerWeb(document.getElementById('app-root'));
