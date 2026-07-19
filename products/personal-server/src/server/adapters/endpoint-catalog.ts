import { readFile } from 'node:fs/promises';

interface EndpointCatalog {
  readonly generation: string;
  readonly endpoints: ReadonlyArray<{ purpose: string; endpoint: string }>;
}

export async function readEndpointCatalogEntry(
  catalogPath: string,
  purpose: string,
): Promise<string | null> {
  try {
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as EndpointCatalog;
    return catalog.endpoints.find((item) => item.purpose === purpose)?.endpoint || null;
  } catch {
    return null;
  }
}
