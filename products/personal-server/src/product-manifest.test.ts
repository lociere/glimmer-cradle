import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPersonalServerProductManifest } from './product-manifest';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('loads the Personal Server feature projection', () => {
  const manifestPath = writeManifest({
    schema_version: 1,
    id: 'personal-server',
    display_name: 'Glimmer Cradle Personal Server',
    features: {
      control_surface_gateway: true,
      local_device_actions: false,
      avatar: false,
      audio: { tts: true, asr: false },
      extensions: true,
    },
  });

  const manifest = loadPersonalServerProductManifest(manifestPath);

  assert.equal(manifest.id, 'personal-server');
  assert.deepEqual(manifest.features.audio, { tts: true, asr: false });
});

test('rejects a Desktop manifest at the Personal Server boundary', () => {
  const manifestPath = writeManifest({
    schema_version: 1,
    id: 'desktop',
    display_name: 'Glimmer Cradle Desktop',
    features: {
      control_surface_gateway: true,
      local_device_actions: true,
      avatar: true,
      audio: { tts: true, asr: true },
      extensions: true,
    },
  });

  assert.throws(
    () => loadPersonalServerProductManifest(manifestPath),
    /Personal Server 产品组合清单使用了错误产品 ID/,
  );
});

test('rejects fields outside the Protocol product contract', () => {
  const manifestPath = writeManifest({
    schema_version: 1,
    id: 'personal-server',
    display_name: 'Glimmer Cradle Personal Server',
    features: {
      control_surface_gateway: true,
      local_device_actions: false,
      avatar: false,
      audio: { tts: true, asr: false },
      extensions: true,
      implicit_desktop_bridge: true,
    },
  });

  assert.throws(
    () => loadPersonalServerProductManifest(manifestPath),
    /Personal Server 产品组合清单不符合 Protocol/,
  );
});

function writeManifest(value: unknown): string {
  const root = mkdtempSync(path.join(tmpdir(), 'glimmer-product-'));
  temporaryRoots.push(root);
  const manifestPath = path.join(root, 'product.json');
  writeFileSync(manifestPath, JSON.stringify(value), 'utf8');
  return manifestPath;
}
