import { desktopCapturer, screen } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export async function captureScreen(outputRoot: string, requestedDisplayId?: unknown): Promise<unknown> {
  if (requestedDisplayId !== undefined && typeof requestedDisplayId !== 'string') throw new Error('无效显示器 ID');
  const displayId = requestedDisplayId ?? String(screen.getPrimaryDisplay().id);
  const display = screen.getAllDisplays().find((item) => String(item.id) === displayId);
  if (!display) throw new Error('指定显示器当前不可用');
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 }, fetchWindowIcons: false });
  const source = sources.find((item) => item.display_id === displayId);
  if (!source || source.thumbnail.isEmpty()) throw new Error('屏幕截图不可用，请检查系统屏幕录制权限');
  await mkdir(outputRoot, { recursive: true });
  const filename = path.join(outputRoot, `${randomUUID()}.png`);
  await writeFile(filename, source.thumbnail.toPNG(), { flag: 'wx', mode: 0o600 });
  return { ok: true, display_id: displayId, path: filename, mime_type: 'image/png', ...source.thumbnail.getSize() };
}

// 固定只读平台探针，没有用户拼接脚本、交互窗口或长驻子进程。
const foregroundProbe = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ForegroundWindowProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
}
'@
$windowHandle = [ForegroundWindowProbe]::GetForegroundWindow()
if ($windowHandle -eq [IntPtr]::Zero) { throw 'No foreground window' }
$windowTitle = [Text.StringBuilder]::new(1024)
$null = [ForegroundWindowProbe]::GetWindowText($windowHandle, $windowTitle, 1024)
[uint32]$windowProcessId = 0
$null = [ForegroundWindowProbe]::GetWindowThreadProcessId($windowHandle, [ref]$windowProcessId)
@{ title = $windowTitle.ToString(); process_id = $windowProcessId } | ConvertTo-Json -Compress
`;

export async function readActiveWindow(): Promise<unknown> {
  if (process.platform !== 'win32') throw new Error('当前发行物的前台窗口读取仅支持 Windows');
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(foregroundProbe, 'utf16le').toString('base64')], { windowsHide: true, timeout: 8000, maxBuffer: 32 * 1024, encoding: 'utf8' }));
  } catch { throw new Error('无法读取前台窗口，请检查 Windows 会话和 PowerShell 可用性'); }
  const value = JSON.parse(stdout.trim());
  if (typeof value.title !== 'string' || !Number.isInteger(value.process_id)) throw new Error('前台窗口探针返回无效结果');
  return { ok: true, title: value.title, process_id: value.process_id };
}
