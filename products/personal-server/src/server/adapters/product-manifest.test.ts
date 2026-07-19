import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPersonalServerProductManifest } from './product-manifest';

test('loads a valid personal server product manifest', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'personal-server-manifest-'));
  const filePath = path.join(dir, 'product.json');
  writeFileSync(filePath, JSON.stringify({
    schema_version: 1,
    id: 'personal-server',
    display_name: 'Personal Server',
    features: {
      control_surface_gateway: true,
      local_device_actions: false,
      avatar: false,
      audio: { tts: true, asr: false },
      extensions: true,
    },
  }));

  const manifest = loadPersonalServerProductManifest(filePath);
  assert.equal(manifest.id, 'personal-server');
  assert.equal(manifest.features.extensions, true);
});
