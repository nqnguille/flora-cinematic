import { readSessionEmail } from './_session';

interface Env {
  SESSION_SECRET: string;
  SOCIOS: KVNamespace;
  GENETICAS: KVNamespace;
  PEDIDOS: KVNamespace;
  NOTIFY_TOKEN?: string;
}

// Un pedido vive 90 días en KV; después se purga solo.
const TTL_SECONDS = 90 * 24 * 60 * 60;
const ESTADOS_ACTIVOS = ['pendiente', 'listo'];
const MAX_ITEMS = 12;
const MAX_CANTIDAD = { flor: 50, preroll: 20 } as Record<string, number>;
const NOTIFY_URL = 'https://gates-analytics.nqnguille.workers.dev/api/notify';

function formatosDe(g: any): string[] {
  return Array.isArray(g.formatos) && g.formatos.length ? g.formatos : ['flor'];
}

// Socio autenticado Y todavía en la lista (una baja invalida la sesión para pedir).
async function requireSocio(request: Request, env: Env): Promise<{ email: string; rec: any } | null> {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return null;
  const raw = await env.SOCIOS.get(email);
  if (raw === null) return null;
  let rec: any = {};
  try { rec = JSON.parse(raw); } catch { rec = {}; }
  if (typeof rec !== 'object' || rec === null) rec = {};
  return { email, rec };
}

async function pedidosDe(env: Env, email?: string): Promise<any[]> {
  const list = await env.PEDIDOS.list({ prefix: 'pedido:' });
  const pedidos = (
    await Promise.all(list.keys.map(async (k) => {
      const raw = await env.PEDIDOS.get(k.name);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }))
  ).filter((p): p is any => !!p && (!email || p.email === email));
  pedidos.sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
  return pedidos;
}

// El pedido del socio (el activo si hay, si no el último).
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const socio = await requireSocio(request, env);
  if (!socio) return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });

  const pedidos = await pedidosDe(env, socio.email);
  const activo = pedidos.find((p) => ESTADOS_ACTIVOS.includes(p.estado)) || null;
  return Response.json({ ok: true, activo, pedidos: pedidos.slice(0, 10) });
};

// Crear pedido: valida ítems contra el catálogo y avisa por WhatsApp.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const socio = await requireSocio(request, env);
  if (!socio) return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }

  const rawItems = Array.isArray(body?.items) ? body.items : [];
  if (!rawItems.length || rawItems.length > MAX_ITEMS) {
    return Response.json({ ok: false, error: 'el pedido no tiene ítems válidos' }, { status: 400 });
  }

  const yaActivo = (await pedidosDe(env, socio.email)).find((p) => ESTADOS_ACTIVOS.includes(p.estado));
  if (yaActivo) {
    return Response.json({ ok: false, error: 'ya tenés un pedido en curso', activo: yaActivo }, { status: 409 });
  }

  const rawCat = await env.GENETICAS.get('catalogo');
  const catalogo: any[] = rawCat ? JSON.parse(rawCat) : [];
  const porId = new Map(catalogo.map((g) => [g.id, g]));

  const items: any[] = [];
  for (const it of rawItems) {
    const g = porId.get(String(it?.id || ''));
    const formato = String(it?.formato || '');
    const cantidad = Math.floor(Number(it?.cantidad));
    if (!g || !g.activo) return Response.json({ ok: false, error: `genética no disponible: ${it?.id}` }, { status: 400 });
    if (!['flor', 'preroll'].includes(formato) || !formatosDe(g).includes(formato)) {
      return Response.json({ ok: false, error: `formato inválido para ${g.nombre}` }, { status: 400 });
    }
    if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD[formato]) {
      return Response.json({ ok: false, error: `cantidad inválida para ${g.nombre}` }, { status: 400 });
    }
    items.push({ id: g.id, nombre: g.nombre, formato, cantidad });
  }

  const now = new Date().toISOString();
  const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const pedido = {
    id,
    email: socio.email,
    name: socio.rec.name || '',
    items,
    nota: String(body?.nota || '').slice(0, 400),
    estado: 'pendiente',
    creado: now,
    actualizado: now,
  };
  await env.PEDIDOS.put(`pedido:${id}`, JSON.stringify(pedido), { expirationTtl: TTL_SECONDS });

  context.waitUntil(notificar(env, pedido));
  return Response.json({ ok: true, pedido });
};

// Cancelar el propio pedido mientras siga pendiente.
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const socio = await requireSocio(request, env);
  if (!socio) return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }
  const id = String(body?.id || '');
  const raw = id ? await env.PEDIDOS.get(`pedido:${id}`) : null;
  if (!raw) return Response.json({ ok: false, error: 'pedido inexistente' }, { status: 404 });

  const pedido = JSON.parse(raw);
  if (pedido.email !== socio.email) return Response.json({ ok: false, error: 'pedido ajeno' }, { status: 403 });
  if (pedido.estado !== 'pendiente') {
    return Response.json({ ok: false, error: 'el pedido ya no se puede cancelar' }, { status: 409 });
  }
  pedido.estado = 'cancelado';
  pedido.actualizado = new Date().toISOString();
  await env.PEDIDOS.put(`pedido:${id}`, JSON.stringify(pedido), { expirationTtl: TTL_SECONDS });
  return Response.json({ ok: true, pedido });
};

// WhatsApp vía el hub de avisos (gates-analytics). Sin token configurado no avisa
// (así los entornos de prueba no disparan mensajes reales). Nunca rompe el pedido.
async function notificar(env: Env, pedido: any) {
  if (!env.NOTIFY_TOKEN) return;
  try {
    const lineas = pedido.items
      .map((i: any) => `· ${i.cantidad}${i.formato === 'flor' ? ' g' : ' u'} — ${i.nombre}${i.formato === 'preroll' ? ' (preroll)' : ''}`)
      .join('\n');
    const text =
      `🌿 PEDIDO NUEVO — Carta Flora\n` +
      `👤 ${pedido.name || pedido.email} (${pedido.email})\n` +
      lineas +
      (pedido.nota ? `\n📝 ${pedido.nota}` : '') +
      `\nPanel: https://floraong.ar/socios/admin/geneticas`;
    await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, token: env.NOTIFY_TOKEN }),
    });
  } catch {
    /* el aviso nunca bloquea el pedido */
  }
}
