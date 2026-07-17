import { describe, expect, it } from 'vitest';
import { isLocalAvatarSurfaceScene } from './surface-scene-scope';

describe('isLocalAvatarSurfaceScene', () => {
  it.each([
    'desktop-ui:user',
    'avatar:selrena',
    'scene:desktop-ui:local-space',
    'conversation:desktop-ui:local-space:thread',
    'scene:avatar:selrena',
  ])('识别本地 surface scene: %s', (sceneId) => {
    expect(isLocalAvatarSurfaceScene(sceneId)).toBe(true);
  });

  it.each([
    'napcat:private:123',
    'scene:napcat:private:123',
    'conversation:wechat:group:456',
    '',
  ])('拒绝远端或空 scene: %s', (sceneId) => {
    expect(isLocalAvatarSurfaceScene(sceneId)).toBe(false);
  });
});
