export function isLocalAvatarSurfaceScene(sceneId: string | undefined): boolean {
  const normalized = String(sceneId ?? '');
  return /^(?:(?:scene|conversation):)?(?:desktop-ui|avatar)(?::|$)/.test(normalized);
}
