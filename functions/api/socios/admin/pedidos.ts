import { requireAdmin } from './_guard';

interface Env {
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
  SUPER_ADMIN_EMAILS?: string;
  PEDIDOS: KVNamespace;
}

const TTL_SECONDS = 90 * 24 * 60 * 60;
const ESTADOS = ['pendiente', 'listo', 'entregado', 'cancelado'];

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

// Todos los pedidos, más nuevos primero.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  const list = await env.PEDIDOS.list({ prefix: 'pedido:' });
  const pedidos = (
    await Promise.all(list.keys.map(async (k) => {
      const raw = await env.PEDIDOS.get(k.name);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }))
  ).filter(Boolean) as any[];
  pedidos.sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
  return Response.json({ ok: true, pedidos });
};

// Cambiar estado: pendiente → listo → entregado (o cancelado).
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }
  const id = String(body?.id || '');
  const estado = String(body?.estado || '');
  if (!ESTADOS.includes(estado)) return Response.json({ ok: false, error: 'estado inválido' }, { status: 400 });

  const raw = id ? await env.PEDIDOS.get(`pedido:${id}`) : null;
  if (!raw) return Response.json({ ok: false, error: 'pedido inexistente' }, { status: 404 });

  const pedido = JSON.parse(raw);
  // Un pedido en 'entregado' o 'cancelado' es un estado final — sin este
  // chequeo, una pantalla de admin desactualizada podía "revivir" un pedido
  // que el socio ya había cancelado (o pisar un 'entregado' ya registrado)
  // sin ningún aviso de conflicto.
  if (pedido.estado === 'entregado' || pedido.estado === 'cancelado') {
    return Response.json({
      ok: false,
      conflict: true,
      error: `Este pedido ya está "${pedido.estado}" (puede haber cambiado desde otra pantalla) — recargá la lista antes de tocarlo de nuevo.`,
      pedido,
    }, { status: 409 });
  }
  pedido.estado = estado;
  pedido.actualizado = new Date().toISOString();
  await env.PEDIDOS.put(`pedido:${id}`, JSON.stringify(pedido), { expirationTtl: TTL_SECONDS });
  return Response.json({ ok: true, pedido });
};
