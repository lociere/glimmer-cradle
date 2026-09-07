import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './shared/styles/tokens.css';
import './shared/styles/global.css';
import './shared/styles/layout.css';
import './shared/styles/motion.css';
import './shared/styles/responsive.css';
import { PersonalServerApplication } from './app/bootstrap';

const rootElement = document.getElementById('app-root');
if (!rootElement) throw new Error('缺少 app-root');

createRoot(rootElement).render(
  <StrictMode>
    <PersonalServerApplication />
  </StrictMode>,
);
