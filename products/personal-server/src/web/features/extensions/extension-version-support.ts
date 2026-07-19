import type { ExtensionRuntimeProjection } from '@glimmer-cradle/protocol';

export interface ExtensionInstallationView {
  readonly installedVersions: string[];
  readonly activeVersion?: string;
  readonly updatedAt: string;
}

export interface ExtensionVersionRow {
  readonly version: string;
  readonly isActive: boolean;
  readonly stateLabel: string;
  readonly actionLabel: string;
  readonly canActivate: boolean;
  readonly canUninstall: boolean;
}

export function buildExtensionVersionRows(
  installation: ExtensionInstallationView | undefined,
  projection: ExtensionRuntimeProjection | undefined,
): ExtensionVersionRow[] {
  const installedVersions = installation?.installedVersions ?? [];
  const activeVersion = installation?.activeVersion;
  const activeIndex = activeVersion ? installedVersions.indexOf(activeVersion) : -1;
  return installedVersions.map((version, index) => {
    const isActive = version === activeVersion;
    const newerThanActive = activeIndex >= 0 && index < activeIndex;
    const olderThanActive = activeIndex >= 0 && index > activeIndex;
    const lifecycle = projection?.lifecycle;
    const isRunningVersion = isActive && (lifecycle === 'running' || lifecycle === 'starting');
    return {
      version,
      isActive,
      stateLabel: isRunningVersion
        ? '当前运行'
        : isActive
          ? '当前激活'
          : newerThanActive
            ? '可升级'
            : olderThanActive
              ? '可回滚'
              : '已安装',
      actionLabel: isActive
        ? (lifecycle === 'running' || lifecycle === 'starting' ? '正在使用' : '启动此版本')
        : newerThanActive
          ? '升级到此版本'
          : olderThanActive
            ? '回滚到此版本'
            : '激活此版本',
      canActivate: !isRunningVersion,
      canUninstall: !isActive,
    };
  });
}
