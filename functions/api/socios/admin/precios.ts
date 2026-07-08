import { requireAdmin } from './_guard';

interface Env {
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
  SUPER_ADMIN_EMAILS?: string;
  GENETICAS: KVNamespace;
}

const PRECIOS_KEY = 'precios';
// Categorías que la tienda pública ya sabe leer — el panel edita dentro de estas.
const CATEGORIAS = ['aceites', 'cremas', 'extracciones'];
const MAX_ITEMS_POR_CATEGORIA = 40;

async function guard(request: Request, env: Env) {
  const check = await requireAdmin(request, env);
  if (check.status !== 200) {
    return Response.json(
      { ok: false, error: check.status === 401 ? 'no autenticado' : 'sin permisos de administrador' },
      { status: check.status }
    );
  }
  return null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  const raw = await env.GENETICAS.get(PRECIOS_KEY);
  const precios = raw ? JSON.parse(raw) : {};
  for (const c of CATEGORIAS) if (!Array.isArray(precios[c])) precios[c] = [];
  return Response.json({ ok: true, precios });
};

// Guarda el documento completo de precios. Valida ítem por ítem para que un
// error de tipeo no rompa la tienda ni la reserva de productos.
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }

  const entrada = body?.precios;
  if (typeof entrada !== 'object' || entrada === null) {
    return Response.json({ ok: false, error: 'falta el objeto precios' }, { status: 400 });
  }

  const limpio: Record<string, any[]> = {};
  const idsVistos = new Set<string>();
  for (const cat of CATEGORIAS) {
    const items = Array.isArray(entrada[cat]) ? entrada[cat] : [];
    if (items.length > MAX_ITEMS_POR_CATEGORIA) {
      return Response.json({ ok: false, error: `demasiados ítems en ${cat}` }, { status: 400 });
    }
    limpio[cat] = [];
    for (const it of items) {
      const id = String(it?.id || '').trim().toLowerCase();
      const label = String(it?.label || '').trim();
      const precio = Math.round(Number(it?.precio));
      if (!/^[a-z0-9-]{2,60}$/.test(id)) {
        return Response.json({ ok: false, error: `id inválido en ${cat}: "${it?.id}" (solo minúsculas, números y guiones)` }, { status: 400 });
      }
      if (idsVistos.has(id)) {
        return Response.json({ ok: false, error: `id repetido: ${id}` }, { status: 400 });
      }
      idsVistos.add(id);
      if (!label) return Response.json({ ok: false, error: `falta el nombre del producto ${id}` }, { status: 400 });
      // precio <= 0 (no solo < 0): un precio en 0 no es un caso legítimo acá
      // — casi siempre es un campo que quedó vacío por error — y sin este
      // chequeo el producto queda reservable gratis en el sitio público.
      if (!Number.isFinite(precio) || precio <= 0 || precio > 100_000_000) {
        return Response.json({ ok: false, error: `precio inválido para ${label} (tiene que ser mayor a $0)` }, { status: 400 });
      }
      const item: any = { id, label, detalle: String(it?.detalle || '').trim(), precio };
      const foto = String(it?.foto || '').trim();
      if (foto) {
        // Solo fotos servidas por nosotros (subidas desde el panel) o assets propios
        if (!foto.startsWith('/foto/') && !foto.startsWith('/img/')) {
          return Response.json({ ok: false, error: `foto inválida para ${label}` }, { status: 400 });
        }
        item.foto = foto;
      }
      limpio[cat].push(item);
    }
  }

  await env.GENETICAS.put(PRECIOS_KEY, JSON.stringify(limpio));
  return Response.json({ ok: true, precios: limpio });
};
