import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';
const source = readFileSync('tools/offline-worker.js', 'utf8');
class MemoryCache {
  values = new Map<string, Response>();
  key(input: string | Request) { return typeof input === 'string' ? input : input.url; }
  async match(input: string | Request) { return this.values.get(this.key(input))?.clone(); }
  async put(input: string | Request, response: Response) { this.values.set(this.key(input), response.clone()); }
  async delete(input: string | Request) { return this.values.delete(this.key(input)); }
}
function environment(release: string, stores = new Map<string, MemoryCache>(), fail = false) {
  const body = '<html>verified</html>'; const assets = [{ path: 'index.html', hash: createHash('sha256').update(body).digest('hex'), size: body.length }];
  const handlers = new Map<string, (e: any) => void>();
  const sandbox = { URL, Response, Request, Headers, crypto: webcrypto, caches: { async open(key: string) { let cache = stores.get(key); if (!cache) { cache = new MemoryCache(); stores.set(key, cache); } return cache; }, async keys() { return [...stores.keys()]; }, async delete(key: string) { return stores.delete(key); } }, fetch: async () => { if (fail) throw new Error('Network failed'); return new Response(body, { headers: { 'Content-Type': 'text/html' } }); }, self: { registration: { scope: 'https://example.test/tool/' }, clients: { claim: async () => {} }, skipWaiting: async () => {}, addEventListener: (type: string, callback: (e: any) => void) => handlers.set(type, callback) } };
  const context = vm.createContext(sandbox); vm.runInContext(source.replace('__RELEASE__', JSON.stringify(release)).replace('__ASSETS__', JSON.stringify(assets)), context);
  return { context, stores, handlers, prepare: (send: (data: any) => void) => vm.runInContext('prepare', context)(send), status: () => vm.runInContext('status()', context) };
}
describe('verified offline release cache', () => {
  it('never marks shell-only or partial installation ready', async () => { const env = environment('one'); expect(await env.status()).toBe(false); const result: any[] = []; await env.prepare(d => result.push(d)); expect(await env.status()).toBe(true); expect(result.at(-1).type).toBe('ready'); env.stores.get('cdda-release-one')!.values.delete('https://example.test/tool/index.html'); expect(await env.status()).toBe(false); });
  it('keeps a prior complete release after failed upgrade and can reopen its navigation offline', async () => { const old = environment('old'); await old.prepare(() => {}); const next = environment('new', old.stores, true); await expect(next.prepare(() => {})).rejects.toThrow('Network failed'); expect(old.stores.has('cdda-release-old')).toBe(true); expect(await next.status()).toBe(false); let response: Promise<Response> | undefined; next.handlers.get('fetch')!({ request: { method: 'GET', url: 'https://example.test/tool/', mode: 'navigate' }, respondWith: (r: Promise<Response>) => { response = r; } }); expect(await (await response!).text()).toContain('verified'); });
  it('isolates release caches and deletes the old release only after a verified replacement', async () => { const old = environment('old'); await old.prepare(() => {}); const next = environment('new', old.stores); await next.prepare(() => {}); expect(await next.status()).toBe(true); expect(next.stores.has('cdda-release-old')).toBe(false); });
  it('does not destroy an already-complete cache when repeating preparation offline', async () => { const original = environment('same'); await original.prepare(() => {}); const offline = environment('same', original.stores, true); await offline.prepare(() => {}); expect(await offline.status()).toBe(true); });
  it('does not retain Vary or transfer encodings on already-decoded static bodies', async () => {
    const env = environment('headers');
    env.context.fetch = async () => new Response('<html>verified</html>', { headers: { 'Content-Type': 'text/html', 'Vary': 'Origin', 'Content-Encoding': 'gzip', 'Content-Length': '999' } });
    await env.prepare(() => {});
    const hit = await env.stores.get('cdda-release-headers')!.match('https://example.test/tool/index.html');
    expect(hit!.headers.get('Content-Type')).toBe('text/html');
    for (const header of ['Vary', 'Content-Encoding', 'Content-Length']) expect(hit!.headers.has(header)).toBe(false);
    expect(await hit!.text()).toBe('<html>verified</html>');
  });
  it('rejects integrity mismatches without damaging a prior complete release', async () => {
    const old = environment('old'); await old.prepare(() => {});
    const next = environment('bad-hash', old.stores);
    next.context.fetch = async () => new Response('tampered');
    await expect(next.prepare(() => {})).rejects.toThrow('Integrity mismatch');
    expect(await next.status()).toBe(false); expect(await old.status()).toBe(true);
  });
  it('reports quota failures without claiming readiness', async () => {
    const env = environment('quota'); const cache = new MemoryCache();
    cache.put = async () => { throw new DOMException('Storage is full', 'QuotaExceededError'); };
    env.stores.set('cdda-release-quota', cache);
    await expect(env.prepare(() => {})).rejects.toThrow('Storage is full');
    expect(await env.status()).toBe(false);
  });
});
