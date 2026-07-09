import { requireAdmin } from './_guard';

interface Env {
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
  SUPER_ADMIN_EMAILS?: string;
  PEDIDOS: KVNamespace;
  SOCIOS: KVNamespace;
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

// Cambiar estado (pendiente → listo → entregado/cancelado) y/o reasignar el
// pedido a otro socio. Se usa para el caso del living del club: varios
// socios reservan con la cuenta compartida floraclubdecultivo@gmail.com, y
// al entregar (o después, para corregir) el admin puede pasarle el pedido a
// la cuenta del socio que realmente se lo llevó.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }
  const id = String(body?.id || '');
  const estado = body?.estado != null ? String(body.estado) : null;
  const reasignarA = body?.reasignarA != null ? String(body.reasignarA).trim().toLowerCase() : null;
  if (estado !== null && !ESTADOS.includes(estado)) return Response.json({ ok: false, error: 'estado inválido' }, { status: 400 });
  if (!estado && !reasignarA) return Response.json({ ok: false, error: 'nada para actualizar' }, { status: 400 });

  const raw = id ? await env.PEDIDOS.get(`pedido:${id}`) : null;
  if (!raw) return Response.json({ ok: false, error: 'pedido inexistente' }, { status: 404 });

  const pedido = JSON.parse(raw);

  if (estado) {
    // Un pedido en 'entregado' o 'cancelado' es un estado final — sin este
    // chequeo, una pantalla de admin desactualizada podía "revivir" un pedido
    // que el socio ya había cancelado (o pisar un 'entregado' ya registrado)
    // sin ningún aviso de conflicto. La reasignación (más abajo) sí puede
    // tocar un pedido final: es justamente cómo se corrige después.
    if (pedido.estado === 'entregado' || pedido.estado === 'cancelado') {
      return Response.json({
        ok: false,
        conflict: true,
        error: `Este pedido ya está "${pedido.estado}" (puede haber cambiado desde otra pantalla) — recargá la lista antes de tocarlo de nuevo.`,
        pedido,
      }, { status: 409 });
    }
    pedido.estado = estado;
  }

  if (reasignarA) {
    const socioRaw = await env.SOCIOS.get(reasignarA);
    if (socioRaw === null) return Response.json({ ok: false, error: 'ese email no es un socio cargado' }, { status: 400 });
    let socioRec: any = {};
    try { socioRec = JSON.parse(socioRaw); } catch { /* valor legado "ok" */ }
    if (!pedido.reasignadoDe) pedido.reasignadoDe = pedido.email; // conserva el dueño original, solo la 1ª vez
    pedido.email = reasignarA;
    pedido.name = socioRec.name || reasignarA;
    pedido.reasignadoEn = new Date().toISOString();
  }

  pedido.actualizado = new Date().toISOString();
  await env.PEDIDOS.put(`pedido:${id}`, JSON.stringify(pedido), { expirationTtl: TTL_SECONDS });
  return Response.json({ ok: true, pedido });
};
