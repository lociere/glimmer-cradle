import { describe, expect, it, vi } from 'vitest';
import { OutboundUrlPolicy, type PolicyResponse } from './outbound-url-policy';

describe('OutboundUrlPolicy', () => {
  it('rejects localhost and RFC1918/private targets before sending requests', async () => {
    const requester = vi.fn(async (): Promise<PolicyResponse> => ({
      statusCode: 200,
      headers: {},
      body: bytesFromText('{}'),
    }));
    const policy = new OutboundUrlPolicy({
      lookupAll: async () => ['127.0.0.1'],
      requester,
    });

    await expect(policy.fetchJson('https://localhost/catalog.json', {
      maxBytes: 1024,
      maxRedirects: 2,
    })).rejects.toThrow('非公网地址');
    expect(requester).not.toHaveBeenCalled();
  });

  it('rejects metadata and IPv6 link-local addresses', async () => {
    const metadataPolicy = new OutboundUrlPolicy({
      lookupAll: async () => ['169.254.169.254'],
      requester: async () => ({ statusCode: 200, headers: {}, body: bytesFromText('{}') }),
    });
    await expect(metadataPolicy.fetchJson('https://metadata.example/catalog.json', {
      maxBytes: 1024,
      maxRedirects: 2,
    })).rejects.toThrow('非公网地址');

    const ipv6Policy = new OutboundUrlPolicy({
      lookupAll: async () => ['fe80::1'],
      requester: async () => ({ statusCode: 200, headers: {}, body: bytesFromText('{}') }),
    });
    await expect(ipv6Policy.fetchJson('https://ipv6.example/catalog.json', {
      maxBytes: 1024,
      maxRedirects: 2,
    })).rejects.toThrow('非公网地址');
  });

  it('revalidates every redirect hop and rejects redirects into private space', async () => {
    const requester = vi.fn(async (target): Promise<PolicyResponse> => {
      if (target.url.hostname === 'public.example') {
        return {
          statusCode: 302,
          headers: { location: 'https://internal.example/pkg.json' },
          body: bytesFromText('redirect'),
        };
      }
      return {
        statusCode: 200,
        headers: {},
        body: bytesFromText('{}'),
      };
    });
    const policy = new OutboundUrlPolicy({
      lookupAll: async (hostname) => hostname === 'public.example'
        ? ['93.184.216.34']
        : ['10.0.0.8'],
      requester,
    });

    await expect(policy.fetchJson('https://public.example/catalog.json', {
      maxBytes: 1024,
      maxRedirects: 2,
    })).rejects.toThrow('非公网地址');
    expect(requester).toHaveBeenCalledTimes(1);
  });

  it('allows public HTTPS targets and returns parsed payload', async () => {
    const requester = vi.fn(async (): Promise<PolicyResponse> => ({
      statusCode: 200,
      headers: {},
      body: bytesFromText(JSON.stringify({ ok: true })),
    }));
    const policy = new OutboundUrlPolicy({
      lookupAll: async () => ['93.184.216.34'],
      requester,
    });

    await expect(policy.fetchJson('https://public.example/catalog.json', {
      maxBytes: 1024,
      maxRedirects: 2,
    })).resolves.toMatchObject({
      statusCode: 200,
      payload: { ok: true },
      finalUrl: 'https://public.example/catalog.json',
    });
    expect(requester).toHaveBeenCalledTimes(1);
  });
});

async function* bytesFromText(value: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(value);
}
