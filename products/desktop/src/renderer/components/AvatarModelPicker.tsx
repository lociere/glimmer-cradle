import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';

type AvatarPackageCatalog = Awaited<ReturnType<Window['desktopHost']['getAvatarPackageCatalog']>>;

/**
 * Avatar Package选择器。
 *
 * renderer 不再直接读取仓库文件；只消费 Electron main 提供的Avatar Package投影。
 */
export const AvatarModelPicker: React.FC = () => {
  const currentAvatarModel = useAppStore((s) => s.currentAvatarModel);
  const displayScale = useAppStore((s) => s.avatarAppearance.displayScale);
  const placementId = useAppStore((s) => s.avatarAppearance.placementId);
  const setAvatarAppearance = useAppStore((s) => s.setAvatarAppearance);
  const [catalog, setCatalog] = useState<AvatarPackageCatalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.desktopHost.getAvatarPackageCatalog().then((snapshot) => {
      if (!cancelled) setCatalog(snapshot);
    }).catch(() => {
      if (!cancelled) setCatalog(null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!catalog || catalog.packages.length <= 1) return null;

  return (
    <select
      className="shell-model-picker"
      value={currentAvatarModel || catalog.defaultModelId}
      onChange={(e) => {
        const next = { modelId: e.target.value, displayScale, placementId };
        setAvatarAppearance(next);
        void window.desktopHost.setAvatarAppearance(next);
      }}
      title="切换Avatar Package"
    >
      {catalog.packages.map((avatarPackage) => (
        <option key={avatarPackage.id} value={avatarPackage.modelId}>
          {avatarPackage.displayName}
        </option>
      ))}
    </select>
  );
};
