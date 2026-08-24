import { readFile } from 'node:fs/promises';

interface EndpointCatalog {
  readonly generation: string;
  readonly endpoints: ReadonlyArray<{ purpose: string; endpoint: string }>;
}

export interface EndpointCatalogEntry {
  readonly endpoint: string;
  readonly generation: string;
}

export async function readEndpointCatalogEntryRecord(
  catalogPath: string,
  purpose: string,
): Promise<EndpointCatalogEntry | null> {
  try {
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as EndpointCatalog;
    const endpoint = catalog.endpoints.find((item) => item.purpose === purpose)?.endpoint;
    return endpoint && catalog.generation ? { endpoint, generation: catalog.generation } : null;
  } catch {
    return null;
  }
}

export async function readEndpointCatalogEntry(
  catalogPath: string,
  purpose: string,
): Promise<string | null> {
  return (await readEndpointCatalogEntryRecord(catalogPath, purpose))?.endpoint || null;
}
