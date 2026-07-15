// Últimas publicaciones reales de Instagram, servidas desde NUESTRO backend.
//
// - Usa la Graph API oficial de Instagram (Instagram Login): sin plugins de
//   terceros ni límites de proveedor.
// - Cachea en KV (namespace GENETICAS, prefijo instagram:) para no pegarle a
//   Meta en cada visita y para servir aunque Meta falle puntualmente.
// - Auto-renueva el token de larga duración (caduca ~60 días) de forma
//   oportunista, así queda efectivamente libre de mantenimiento.
//
// Config (secrets del proyecto Pages):
//   IG_TOKEN  = token de larga duración (Instagram Login) — semilla inicial.
//
// Si no hay token configurado, responde posts: [] y la web usa sus cards
// locales de respaldo (el módulo nunca se ve roto).

interface Env {
  GENETICAS: KVNamespace;
  IG_TOKEN?: string;
}

const POSTS_KEY = 'instagram:posts';
const POSTS_TS_KEY = 'instagram:posts_ts';
const TOKEN_KEY = 'instagram:token';
const TOKEN_TS_KEY = 'instagram:token_ts';

const CACHE_TTL_MS = 30 * 60 * 1000;               // refrescar posts cada 30 min
const REFRESH_EVERY_MS = 45 * 24 * 60 * 60 * 1000; // renovar token cada 45 días
const LIMIT = 9;

interface Card {
  caption: string;
  img: string;
  permalink: string;
  timestamp: string;
  type: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const kv = env.GENETICAS;
  const now = Date.now();

  const cached = await kv.get(POSTS_KEY);
  const cachedTs = Number((await kv.get(POSTS_TS_KEY)) || 0);

  // 1) Cache fresco → responder sin tocar Meta
  if (cached && now - cachedTs < CACHE_TTL_MS) {
    return json({ ok: true, source: 'cache', posts: JSON.parse(cached) });
  }

  // 2) Token (KV renovado > semilla en env)
  let token = (await kv.get(TOKEN_KEY)) || env.IG_TOKEN || '';
  if (!token) {
    return json({
      ok: false,
      error: 'sin_token',
      posts: cached ? JSON.parse(cached) : [],
    });
  }

  // 3) Renovación oportunista del token de larga duración
  const tokenTs = Number((await kv.get(TOKEN_TS_KEY)) || 0);
  if (!tokenTs) {
    await kv.put(TOKEN_TS_KEY, String(now));
  } else if (now - tokenTs > REFRESH_EVERY_MS) {
    try {
      const r = await fetch(
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`
      );
      if (r.ok) {
        const d = await r.json<{ access_token?: string }>();
        if (d.access_token) {
          token = d.access_token;
          await kv.put(TOKEN_KEY, token);
          await kv.put(TOKEN_TS_KEY, String(now));
        }
      }
    } catch {
      /* si falla, seguimos con el token actual */
    }
  }

  // 4) Traer las últimas publicaciones reales
  try {
    const fields = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp';
    const url = `https://graph.instagram.com/me/media?fields=${fields}&limit=${LIMIT}&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`graph_${res.status}`);
    const data = await res.json<{ data?: Array<Record<string, string>> }>();

    const posts: Card[] = (data.data || [])
      .filter((m) => m.permalink)
      .map((m) => ({
        caption: (m.caption || '').replace(/\s+/g, ' ').trim().slice(0, 170),
        img: m.media_type === 'VIDEO' ? m.thumbnail_url || m.media_url : m.media_url,
        permalink: m.permalink,
        timestamp: m.timestamp || '',
        type: m.media_type || 'IMAGE',
      }))
      .filter((c) => !!c.img);

    if (!posts.length) throw new Error('sin_posts');

    await kv.put(POSTS_KEY, JSON.stringify(posts));
    await kv.put(POSTS_TS_KEY, String(now));
    return json({ ok: true, source: 'live', posts });
  } catch (e) {
    // Meta falló → servir cache viejo si existe; si no, vacío (front usa fallback)
    if (cached) return json({ ok: true, source: 'stale', posts: JSON.parse(cached) });
    return json({ ok: false, error: String((e as Error).message || e), posts: [] });
  }
};
