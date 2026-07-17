import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import fs from 'fs-extra';
import path from 'path';
import type {
  ExternalDependencySource,
  ManagedResourceContribution,
} from '@glimmer-cradle/protocol';
import type { ExtensionLogger } from '../foundation/ports';
import { resolveConfiguredProjectPath } from '../foundation/utils/path-utils';

export class ExtensionDependencyInstaller {
  public constructor(
    private readonly repoRoot: string,
    private readonly logger: ExtensionLogger,
  ) {}

  public async prepare(extensionId: string, resources: ManagedResourceContribution[]): Promise<void> {
    for (const resource of resources) {
      await this.prepareOne(extensionId, resource);
    }
  }

  private async prepareOne(extensionId: string, resource: ManagedResourceContribution): Promise<void> {
    const installDir = resource.package?.installDir
      ? resolveConfiguredProjectPath(resource.package.installDir, { repoRoot: this.repoRoot })
      : undefined;

    if (!installDir) {
      this.logger.info('扩展受管资源已声明', {
        extension_id: extensionId,
        resource_id: resource.id,
        kind: resource.kind,
      });
      return;
    }

    if (await fs.pathExists(installDir)) {
      this.logger.info('扩展受管资源包已就绪', {
        extension_id: extensionId,
        resource_id: resource.id,
        install_dir: installDir,
      });
      return;
    }

    const source = resource.package?.source;
    const downloadUrl = this.resolveDownloadUrl(source);
    if (!downloadUrl) {
      const message = `扩展受管资源包缺失且没有可自动安装来源: ${resource.displayName || resource.title || resource.id}`;
      if (resource.required !== false) {
        throw new Error(message);
      }
      this.logger.warn(message, {
        extension_id: extensionId,
        resource_id: resource.id,
        install_dir: installDir,
      });
      return;
    }

    const archivePath = await this.download(extensionId, resource, downloadUrl);
    await this.extractArchive(archivePath, path.dirname(installDir));

    if (!(await fs.pathExists(installDir))) {
      throw new Error(`扩展受管资源包安装后仍未找到目录: ${installDir}`);
    }

    this.logger.info('扩展受管资源包安装完成', {
      extension_id: extensionId,
      resource_id: resource.id,
      install_dir: installDir,
    });
  }

  private resolveDownloadUrl(source: ExternalDependencySource | undefined): string | null {
    if (!source) return null;
    if (source.type === 'downloadUrl' && source.url) {
      return source.url;
    }
    if (source.type === 'githubRelease' && source.repository && source.assetName) {
      return `https://github.com/${source.repository}/releases/latest/download/${source.assetName}`;
    }
    return null;
  }

  private async download(
    extensionId: string,
    resource: ManagedResourceContribution,
    downloadUrl: string,
  ): Promise<string> {
    const cacheDir = resolveConfiguredProjectPath(
      path.join('data', 'cache', 'extension-dependencies', extensionId),
      { repoRoot: this.repoRoot },
    );
    await fs.ensureDir(cacheDir);

    const fileName = resource.package?.source.assetName
      ?? path.basename(new URL(downloadUrl).pathname)
      ?? `${resource.id}.zip`;
    const archivePath = path.join(cacheDir, fileName);

    if (await fs.pathExists(archivePath)) {
      this.logger.info('复用已下载的扩展受管资源包', {
        extension_id: extensionId,
        resource_id: resource.id,
        archive: archivePath,
      });
      return archivePath;
    }

    this.logger.info('开始下载扩展受管资源包', {
      extension_id: extensionId,
      resource_id: resource.id,
      url: downloadUrl,
    });

    const response = await fetch(downloadUrl);
    if (!response.ok || !response.body) {
      throw new Error(`扩展受管资源包下载失败: ${resource.id}; status=${response.status}`);
    }

    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(archivePath),
    );
    return archivePath;
  }

  private async extractArchive(archivePath: string, targetDir: string): Promise<void> {
    await fs.ensureDir(targetDir);
    try {
      await this.runCommand('tar', ['-xf', archivePath, '-C', targetDir]);
    } catch (tarError) {
      if (process.platform !== 'win32') {
        throw tarError;
      }
      await this.runCommand('powershell', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath ${this.quotePowerShell(archivePath)} -DestinationPath ${this.quotePowerShell(targetDir)} -Force`,
      ]);
    }
  }

  private runCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        windowsHide: true,
        stdio: 'ignore',
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
        }
      });
    });
  }

  private quotePowerShell(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }
}
