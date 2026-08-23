import { createHash } from 'node:crypto';
import dns from 'node:dns/promises';
import { BlockList } from 'node:net';
import { open } from 'node:fs/promises';
import fs from 'fs-extra';
import path from 'node:path';

const DENY_LIST = buildDenyList();

export interface PolicyResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: AsyncIterable<Uint8Array>;
}

interface ResolvedTarget {
  readonly url: URL;
  readonly address: string;
  readonly servername: string;
  readonly hostHeader: string;
}

interface RequestOptions {
  readonly headers?: Record<string, string>;
}

type LookupAll = (hostname: string) => Promise<string[]>;
type Requester = (target: ResolvedTarget, options: RequestOptions) => Promise<PolicyResponse>;

export class OutboundUrlPolicy {
  private readonly lookupAll: LookupAll;
  private readonly requester: Requester;

  public constructor(options: {
    readonly lookupAll?: LookupAll;
    readonly requester?: Requester;
  } = {}) {
    this.lookupAll = options.lookupAll ?? defaultLookupAll;
    this.requester = options.requester ?? defaultRequester;
  }

  public async fetchJson(
    url: string,
    options: {
      readonly headers?: Record<string, string>;
      readonly maxBytes: number;
      readonly maxRedirects: number;
    },
  ): Promise<{ statusCode: number; payload: unknown; finalUrl: string }> {
    const response = await this.requestWithRedirects(url, {
      headers: options.headers,
      maxRedirects: options.maxRedirects,
    });
    const bytes = await readAllBytes(response.body, options.maxBytes, '远程清单超过大小上限');
    return {
      statusCode: response.statusCode,
      payload: JSON.parse(new TextDecoder().decode(bytes)),
      finalUrl: response.finalUrl,
    };
  }

  public async fetchText(
    url: string,
    options: {
      readonly headers?: Record<string, string>;
      readonly maxBytes: number;
      readonly maxRedirects: number;
    },
  ): Promise<{ statusCode: number; text: string; finalUrl: string }> {
    const response = await this.requestWithRedirects(url, {
      headers: options.headers,
      maxRedirects: options.maxRedirects,
    });
    const bytes = await readAllBytes(response.body, options.maxBytes, '远程响应超过大小上限');
    return {
      statusCode: response.statusCode,
      text: new TextDecoder().decode(bytes),
      finalUrl: response.finalUrl,
    };
  }

  public async downloadFile(
    url: string,
    destination: string,
    options: {
      readonly maxBytes: number;
      readonly maxRedirects: number;
    },
  ): Promise<{ statusCode: number; size: number; sha256: string; finalUrl: string }> {
    const response = await this.requestWithRedirects(url, { maxRedirects: options.maxRedirects });
    await fs.ensureDir(path.dirname(destination));
    const output = await open(destination, 'w');
    const hash = createHash('sha256');
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > options.maxBytes) throw new Error('扩展包超过下载大小上限');
        hash.update(chunk);
        await output.write(chunk);
      }
    } finally {
      await output.close();
    }
    return {
      statusCode: response.statusCode,
      size,
      sha256: hash.digest('hex'),
      finalUrl: response.finalUrl,
    };
  }

  private async requestWithRedirects(
    url: string,
    options: {
      readonly headers?: Record<string, string>;
      readonly maxRedirects: number;
    },
  ): Promise<PolicyResponse & { finalUrl: string }> {
    let currentUrl = new URL(url);
    for (let redirectCount = 0; redirectCount <= options.maxRedirects; redirectCount += 1) {
      const target = await this.resolveTarget(currentUrl);
      const response = await this.requester(target, { headers: options.headers });
      if (!isRedirectStatus(response.statusCode)) {
        return { ...response, finalUrl: currentUrl.toString() };
      }
      const location = firstHeader(response.headers.location);
      if (!location) throw new Error(`远程扩展来源返回了无 Location 的重定向: ${currentUrl}`);
      if (redirectCount === options.maxRedirects) {
        throw new Error(`远程扩展来源重定向超过 ${options.maxRedirects} 次`);
      }
      await drainBody(response.body);
      currentUrl = new URL(location, currentUrl);
    }
    throw new Error(`远程扩展来源重定向超过 ${options.maxRedirects} 次`);
  }

  private async resolveTarget(url: URL): Promise<ResolvedTarget> {
    if (url.protocol !== 'https:') throw new Error(`远程扩展来源必须使用 HTTPS: ${url}`);
    const hostname = url.hostname;
    const addresses = isIpLiteral(hostname)
      ? [hostname]
      : await this.lookupAll(hostname);
    if (addresses.length === 0) {
      throw new Error(`远程扩展来源无法解析公网地址: ${hostname}`);
    }
    for (const address of addresses) {
      if (!isPublicAddress(address)) {
        throw new Error(`远程扩展来源不得指向非公网地址: ${hostname}`);
      }
    }
    return {
      url,
      address: addresses[0],
      servername: hostname,
      hostHeader: url.host,
    };
  }
}

async function defaultLookupAll(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function defaultRequester(target: ResolvedTarget, options: RequestOptions): Promise<PolicyResponse> {
  const response = await fetch(target.url, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      host: target.hostHeader,
      connection: 'close',
      ...options.headers,
    },
  });
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: responseBody(response),
  };
}

async function* responseBody(response: Response): AsyncIterable<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function readAllBytes(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
  overflowMessage: string,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error(overflowMessage);
    chunks.push(chunk);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

async function drainBody(body: AsyncIterable<Uint8Array>): Promise<void> {
  for await (const _chunk of body) {
    // Drain redirect bodies so sockets can close cleanly.
  }
}

function isRedirectStatus(statusCode: number): boolean {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isIpLiteral(value: string): boolean {
  return value.includes(':') || /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
}

function isPublicAddress(address: string): boolean {
  const family = address.includes(':') ? 'ipv6' : 'ipv4';
  return !DENY_LIST.check(address, family);
}

function buildDenyList(): BlockList {
  const denyList = new BlockList();
  for (const [address, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ] as const) {
    denyList.addSubnet(address, prefix, 'ipv4');
  }
  for (const [address, prefix] of [
    ['::', 128],
    ['::1', 128],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
    ['2001:db8::', 32],
  ] as const) {
    denyList.addSubnet(address, prefix, 'ipv6');
  }
  return denyList;
}
