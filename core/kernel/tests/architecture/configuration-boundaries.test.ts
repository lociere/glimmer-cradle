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
});
