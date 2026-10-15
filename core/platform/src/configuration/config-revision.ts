import { createHash } from 'node:crypto';

/** 保留有序文档的 JSON 字节与换行分隔；owner 决定文档顺序和 revision 的公开投影。 */
export function configurationRevision(documents: readonly unknown[]): string {
  const digest = createHash('sha256');
  documents.forEach((document, index) => {
    if (index > 0) digest.update('\n');
    const serialized = JSON.stringify(document);
    if (serialized === undefined) throw new Error('配置文档不能序列化');
    digest.update(serialized);
  });
  return digest.digest('hex');
}
