import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import { applySecurityHeaders } from './security-headers';
import { sendJson } from './json';

const CONTENT_TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.ico', 'image/x-icon'],
]);

export async function serveBuiltWebAsset(
  pathname: string,
  publicRoot: string,
  response: ServerResponse,
): Promise<boolean> {
  const assetPath = resolveSafeAssetPath(pathname, publicRoot);
  if (!assetPath) {
    sendJson(response, 404, { error: 'asset_not_found' });
    return true;
  }
  try {
    const body = await readFile(assetPath);
    sendAsset(response, body, assetPath, pathname === '/' || pathname === '/index.html');
    return true;
  } catch {
    if (!isBrowserNavigationPath(pathname)) return false;
    try {
      const indexPath = path.join(publicRoot, 'index.html');
      const body = await readFile(indexPath);
      sendAsset(response, body, indexPath, true);
      return true;
    } catch {
      return false;
    }
  }
}

function sendAsset(
  response: ServerResponse,
  body: Buffer,
  assetPath: string,
  noStore: boolean,
): void {
  applySecurityHeaders(response);
  response.writeHead(200, {
    'content-type': CONTENT_TYPES.get(path.extname(assetPath)) || 'application/octet-stream',
    'cache-control': noStore ? 'no-store' : 'public, max-age=3600',
  });
  response.end(body);
}

function isBrowserNavigationPath(pathname: string): boolean {
  if (!pathname.startsWith('/') || path.extname(pathname)) return false;
  return !pathname.startsWith('/api/')
    && pathname !== '/healthz'
    && pathname !== '/readyz';
}

function resolveSafeAssetPath(pathname: string, publicRoot: string): string | null {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(publicRoot, relativePath);
  if (target !== publicRoot && !target.startsWith(`${publicRoot}${path.sep}`)) return null;
  return target;
}
