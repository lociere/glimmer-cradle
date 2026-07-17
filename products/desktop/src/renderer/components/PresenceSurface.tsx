import React, { useEffect } from 'react';

export const PresenceSurface: React.FC = () => {
  useEffect(() => {
    // Unity Avatar 是正式身体；Electron Presence 仅保留透明协调面，不再建立第二套模型生命周期。
    void window.desktopHost.setPresenceInteractionPolicy('transparent');
  }, []);

  return <main className="presence-surface" aria-hidden="true" />;
};
