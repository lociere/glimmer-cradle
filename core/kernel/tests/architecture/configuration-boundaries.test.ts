import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(__dirname, '..', '..', '..', '..');

describe('configuration architecture boundaries', () => {
  it('keeps optional Audio and Embedding capabilities disabled by default', () => {
    const audio = fs.readFileSync(path.join(repositoryRoot, 'configs/system/audio.yaml'), 'utf8');
    const embedding = fs.readFileSync(path.join(repositoryRoot, 'configs/system/embedding.yaml'), 'utf8');
    expect(audio).toMatch(/^tts:\s*\r?\n\s+enabled:\s+false\s*$/m);
    expect(audio).toMatch(/^asr:\s*\r?\n\s+enabled:\s+false\s*$/m);
    expect(embedding).toMatch(/^enabled:\s+false\s*$/m);
  });

  it('keeps system Embedding configuration out of the character inference profile', () => {
    const inference = fs.readFileSync(
      path.join(repositoryRoot, 'configs/characters/selrena/inference.yaml'),
      'utf8',
    );
    expect(inference).not.toMatch(/^embedding\s*:/m);
  });

  it('keeps extension activation on active id/version selections', () => {
    const activeExtensions = fs.readFileSync(
      path.join(repositoryRoot, 'configs/extensions/active.yaml'),
      'utf8',
    );
    expect(activeExtensions).not.toMatch(/^enabled\s*:/m);
  });

  it('keeps release version out of persisted configuration and owned by product artifacts', () => {
    const identity = fs.readFileSync(path.join(repositoryRoot, 'configs/system/identity.yaml'), 'utf8');
    const repositoryVersion = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
    ).version as string;
    expect(identity).not.toMatch(/^\s*app_version\s*:/m);
    for (const productId of ['desktop', 'personal-server']) {
      const product = JSON.parse(fs.readFileSync(
        path.join(repositoryRoot, 'products', productId, 'product.json'),
        'utf8',
      )) as { version?: string };
      expect(product.version).toBe(repositoryVersion);
    }
  });
});
