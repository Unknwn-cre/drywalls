// Commercial offers app (/prosfores/): data API for worker.js under /prosfores/api/*.
// All data (PIN, catalogue, prices, settings, saved offers, uploaded photos) lives in one
// SQLite-backed Durable Object, so nothing private is ever committed to the repo.
// Ported from the pool offers app (quant-develope/Pisines-commerce).
import { DurableObject } from 'cloudflare:workers';
import { SEED_CATEGORIES, SEED_MATERIALS, SEED_SETTINGS } from './seed.js';

export const BASE = '/prosfores';
const SEED_VERSION = 1;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const newId = (p) => p + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

export class Store extends DurableObject {
  async fetch(request) {
    try {
      return await this.route(request);
    } catch (e) {
      return json({ error: 'server', message: String(e && e.message || e) }, 500);
    }
  }

  async authed(request) {
    const h = request.headers.get('authorization') || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) return false;
    const tokens = (await this.ctx.storage.get('tokens')) || {};
    return Boolean(tokens[await sha256(token)]);
  }

  async issueToken() {
    const token = crypto.randomUUID() + crypto.randomUUID();
    const tokens = (await this.ctx.storage.get('tokens')) || {};
    tokens[await sha256(token)] = Date.now();
    await this.ctx.storage.put('tokens', tokens);
    return token;
  }

  async seed() {
    await this.ctx.storage.put('categories', SEED_CATEGORIES);
    await this.ctx.storage.put('settings', SEED_SETTINGS);
    const batch = {};
    SEED_MATERIALS.forEach((m, i) => { batch['mat:' + m.id] = { ...m, order: i }; });
    await this.ctx.storage.put(batch);
    await this.ctx.storage.put('seedVersion', SEED_VERSION);
  }

  // Brings a catalogue created by an older version up to date without touching the owner's edits.
  async migrate() {
    const S = this.ctx.storage;
    const v = (await S.get('seedVersion')) || 1;
    if (v >= SEED_VERSION || !(await S.get('categories'))) return;
    await S.put('seedVersion', SEED_VERSION);
  }

  async listPrefix(prefix) {
    const map = await this.ctx.storage.list({ prefix });
    return [...map.values()];
  }

  async route(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/prosfores\/api/, '');
    const method = request.method;
    const body = async () => { try { return await request.json(); } catch { return {}; } };
    const S = this.ctx.storage;

    // ---- public routes ----
    if (path === '/status' && method === 'GET') {
      return json({ setup: Boolean(await S.get('pin')) });
    }
    if (path === '/setup' && method === 'POST') {
      if (await S.get('pin')) return json({ error: 'already_setup' }, 409);
      const { pin } = await body();
      if (!pin || String(pin).length < 4) return json({ error: 'short_pin' }, 400);
      const salt = crypto.randomUUID();
      await S.put('pin', { salt, hash: await sha256(salt + pin) });
      if (!(await S.get('categories'))) await this.seed();
      return json({ token: await this.issueToken() });
    }
    if (path === '/login' && method === 'POST') {
      const rec = await S.get('pin');
      if (!rec) return json({ error: 'not_setup' }, 409);
      const fails = (await S.get('fails')) || { n: 0, t: 0 };
      if (fails.n >= 5 && Date.now() - fails.t < 5 * 60 * 1000) return json({ error: 'locked' }, 429);
      const { pin } = await body();
      if ((await sha256(rec.salt + pin)) !== rec.hash) {
        await S.put('fails', { n: fails.n + 1, t: Date.now() });
        return json({ error: 'wrong_pin' }, 401);
      }
      await S.delete('fails');
      return json({ token: await this.issueToken() });
    }
    // shared PDF (link sent through Viber from a computer); the long random id is the only key
    const shared = path.match(/^\/f\/([0-9a-f]{32})(?:\/[^/]*)?$/);
    if (shared && method === 'GET') {
      const meta = await S.get('file:' + shared[1]);
      if (!meta) return new Response('Not found', { status: 404 });
      const parts = await S.get([...Array(meta.n).keys()].map((i) => `filec:${shared[1]}:${i}`));
      const out = new Uint8Array(meta.size); let at = 0;
      for (let i = 0; i < meta.n; i++) { const c = parts.get(`filec:${shared[1]}:${i}`); out.set(c, at); at += c.length; }
      return new Response(out, { headers: {
        'content-type': 'application/pdf', 'cache-control': 'private, max-age=3600',
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      } });
    }
    const img = path.match(/^\/img\/([\w-]+)$/);
    if (img && method === 'GET') {
      const rec = await S.get('img:' + img[1]);
      if (!rec) return new Response('not found', { status: 404 });
      const bin = Uint8Array.from(atob(rec.data), (c) => c.charCodeAt(0));
      return new Response(bin, { headers: { 'content-type': rec.type || 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
    }

    // ---- everything else needs the PIN token ----
    if (!(await this.authed(request))) return json({ error: 'auth' }, 401);

    if (path === '/data' && method === 'GET') {
      await this.migrate();
      const offers = (await this.listPrefix('offer:')).map((o) => ({
        id: o.id, no: o.no, date: o.date, client: o.client, total: o.total, updated: o.updated,
      })).sort((a, b) => (b.updated || 0) - (a.updated || 0));
      const materials = (await this.listPrefix('mat:')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      return json({ categories: (await S.get('categories')) || [], materials, settings: (await S.get('settings')) || {}, offers });
    }
    if (path === '/categories' && method === 'PUT') {
      const { categories } = await body();
      if (!Array.isArray(categories)) return json({ error: 'bad' }, 400);
      await S.put('categories', categories);
      return json({ ok: true });
    }
    if (path === '/settings' && method === 'PUT') {
      const { settings } = await body();
      await S.put('settings', settings || {});
      return json({ ok: true });
    }
    if (path === '/materials' && method === 'POST') {
      const { material } = await body();
      if (!material || !material.category) return json({ error: 'bad' }, 400);
      const m = { ...material, id: material.id || newId('m'), updated: Date.now() };
      if (m.order == null) m.order = Date.now();
      await S.put('mat:' + m.id, m);
      return json({ material: m });
    }
    const mat = path.match(/^\/materials\/([\w-]+)$/);
    if (mat && method === 'DELETE') {
      const m = await S.get('mat:' + mat[1]);
      if (m && m.imageId) await S.delete('img:' + m.imageId);
      await S.delete('mat:' + mat[1]);
      return json({ ok: true });
    }
    if (path === '/files' && method === 'POST') {
      // raw PDF body; kept 60 days, split in 1 MB pieces (storage value size limit)
      const buf = new Uint8Array(await request.arrayBuffer());
      if (!buf.length || buf.length > 20_000_000) return json({ error: 'bad_file' }, 400);
      const name = String(url.searchParams.get('name') || 'offer.pdf').replace(/[\\/:*?"<>|]+/g, '').slice(0, 120) || 'offer.pdf';
      const old = await S.list({ prefix: 'file:' });
      for (const [k, f] of old) {
        if (Date.now() - f.created < 60 * 864e5) continue;
        const fid = k.slice(5);
        await S.delete([k, ...[...Array(f.n).keys()].map((i) => `filec:${fid}:${i}`)]);
      }
      const id = crypto.randomUUID().replace(/-/g, ''), CH = 1_000_000, batch = {};
      const n = Math.ceil(buf.length / CH);
      for (let i = 0; i < n; i++) batch[`filec:${id}:${i}`] = buf.slice(i * CH, (i + 1) * CH);
      await S.put(batch);
      await S.put('file:' + id, { name, n, size: buf.length, created: Date.now() });
      return json({ url: `${BASE}/api/f/${id}/${encodeURIComponent(name)}` });
    }
    if (path === '/images' && method === 'POST') {
      const { data } = await body(); // data:image/jpeg;base64,...
      const m = String(data || '').match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
      if (!m || m[2].length > 1_500_000) return json({ error: 'bad_image' }, 400);
      const id = newId('i');
      await S.put('img:' + id, { type: m[1], data: m[2] });
      return json({ id, url: BASE + '/api/img/' + id });
    }
    if (path === '/offers' && method === 'POST') {
      const { offer } = await body();
      if (!offer) return json({ error: 'bad' }, 400);
      const o = { ...offer, id: offer.id || newId('o'), updated: Date.now() };
      await S.put('offer:' + o.id, o);
      return json({ offer: o });
    }
    const off = path.match(/^\/offers\/([\w-]+)$/);
    if (off && method === 'GET') {
      const o = await S.get('offer:' + off[1]);
      return o ? json({ offer: o }) : json({ error: 'not_found' }, 404);
    }
    if (off && method === 'DELETE') {
      await S.delete('offer:' + off[1]);
      return json({ ok: true });
    }
    if (path === '/pin' && method === 'POST') {
      const { pin } = await body();
      if (!pin || String(pin).length < 4) return json({ error: 'short_pin' }, 400);
      const salt = crypto.randomUUID();
      await S.put('pin', { salt, hash: await sha256(salt + pin) });
      await S.put('tokens', {});
      return json({ token: await this.issueToken() });
    }
    return json({ error: 'not_found' }, 404);
  }
}
