import React from 'react';
import { createRoot } from 'react-dom/client';
import { PresenceSurface } from './components/PresenceSurface';
import { useDesktopHost } from './host/useDesktopHost';
import './styles/index.css';

document.body.dataset.surface = 'presence';

function PresenceApp(): React.JSX.Element {
  useDesktopHost();
  return <PresenceSurface />;
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <PresenceApp />
    </React.StrictMode>,
  );
}
