import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
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
  request: Pick<IncomingMessage, 'headers' | 'method'>,
  response: ServerResponse,
): Promise<boolean> {
  const method = request.method?.toUpperCase() || 'GET';
  if (method !== 'GET' && method !== 'HEAD') return false;

  const normalizedPathname = normalizePathname(pathname);
  if (!normalizedPathname) {
    sendJson(response, 404, { error: 'asset_not_found' });
    return true;
  }
  if (isApplicationReservedPath(normalizedPathname)) return false;

  const assetPath = resolveSafeAssetPath(normalizedPathname, publicRoot);
  if (!assetPath) {
    sendJson(response, 404, { error: 'asset_not_found' });
    return true;
  }
  try {
    const body = await readFile(assetPath);
    sendAsset(response, body, assetPath, normalizedPathname === '/' || normalizedPathname === '/index.html', method);
    return true;
  } catch {
    if (!isBrowserNavigationRequest(normalizedPathname, method, request.headers.accept)) return false;
    try {
      const indexPath = path.join(publicRoot, 'index.html');
      const body = await readFile(indexPath);
      sendAsset(response, body, indexPath, true, method);
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
  method: string,
): void {
  applySecurityHeaders(response);
  response.writeHead(200, {
    'content-type': CONTENT_TYPES.get(path.extname(assetPath)) || 'application/octet-stream',
    'cache-control': noStore ? 'no-store' : 'public, max-age=3600',
    'content-length': body.byteLength,
  });
  response.end(method === 'HEAD' ? undefined : body);
}

function isBrowserNavigationRequest(
  pathname: string,
  method: string,
  accept: string | string[] | undefined,
): boolean {
  return method === 'GET'
    && !path.extname(pathname)
    && acceptsHtml(accept)
    && !isNavigationReservedPath(pathname);
}

function resolveSafeAssetPath(pathname: string, publicRoot: string): string | null {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolvedRoot = path.resolve(publicRoot);
  const target = path.resolve(resolvedRoot, relativePath);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  return target;
}

function normalizePathname(pathname: string): string | null {
  if (!pathname.startsWith('/')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\\') || decoded.includes('\0') || /%[0-9A-Fa-f]{2}/.test(decoded)) return null;
  if (decoded.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  return decoded;
}

function isApplicationReservedPath(pathname: string): boolean {
  return ['/api', '/healthz', '/readyz']
    .some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isNavigationReservedPath(pathname: string): boolean {
  return pathname === '/assets'
    || pathname.startsWith('/assets/')
    || isApplicationReservedPath(pathname);
}

function acceptsHtml(value: string | string[] | undefined): boolean {
  if (typeof value !== 'string') return false;
  return value.split(',').some((entry) => {
    const [mediaType, ...parameters] = entry.trim().toLowerCase().split(';').map((part) => part.trim());
    if (mediaType !== 'text/html') return false;
    return !parameters.some((parameter) => /^q=0(?:\.0*)?$/.test(parameter));
  });
}
