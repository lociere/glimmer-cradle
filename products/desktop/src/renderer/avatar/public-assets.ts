/**
 * Renderer public 资产路径解析。
 *
 * Vite dev 与 built Electron 的 public 目录形态不同：
 *   - dev：源码目录仍可通过 `/public/...` 被 Vite 服务
 *   - build：public 内容会复制到 dist 根，只能通过 `assets/...` 相对 HTML 访问
 *
 * 因此组件和 manifest 只写相对 public 资产路径，由这里统一解析。
 */
export function resolvePublicAssetUrl(path: string): string {
  if (/^(https?:|file:|data:|blob:)/i.test(path)) {
    return path;
  }

  const relativePath = path.replace(/^\/+/, '');
  return new URL(relativePath, document.baseURI).href;
}
