import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';

export async function openLocalFile(
  value: unknown,
  openPath: (filePath: string) => Promise<string>,
): Promise<{ ok: true; path: string }> {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || !path.isAbsolute(value)) {
    throw new Error('desktop.open_file 需要有效的本地绝对路径');
  }
  // 网络共享与设备路径会触发额外平台访问，不属于本地文件打开契约。
  if (/^[\\/]{2}/u.test(value)) throw new Error('desktop.open_file 不接受网络或设备路径');
  const target = await realpath(value);
  if (/^[\\/]{2}/u.test(target)) throw new Error('desktop.open_file 不接受网络或设备路径');
  const info = await stat(target);
  if (!info.isFile() && !info.isDirectory()) throw new Error('目标不是普通文件或目录');
  const error = await openPath(target);
  if (error) throw new Error(`无法打开本地文件：${error}`);
  return { ok: true, path: target };
}
