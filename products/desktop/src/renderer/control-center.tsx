import React from 'react';
import { createRoot } from 'react-dom/client';
import { ControlCenter } from './components/control-center/ControlCenter';
import { useDesktopHost } from './host/useDesktopHost';
import './styles/index.css';

document.body.dataset.surface = 'control-center';

function ControlCenterApp(): React.JSX.Element {
  useDesktopHost();
  return <ControlCenter />;
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <ControlCenterApp />
    </React.StrictMode>,
  );
}
