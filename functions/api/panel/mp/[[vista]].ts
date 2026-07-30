// Mercado Pago — suscripciones del débito automático (20% renovable x3 meses).
//   POST /api/panel/mp/suscripcion   {socio_id} → crea el preapproval y devuelve el link
//   GET  /api/panel/mp/suscripciones           → estado de todas
//   POST /api/panel/mp/sincronizar   {id}      → re-consulta una suscripción en MP
//
// El precio sale de la lista vigente (columna débito del tier del socio).
// El token vive como secret MP_ACCESS_TOKEN en Cloudflare Pages — nunca en el repo.
import { requireRol, puede } from '../_rol';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
  MP_ACCESS_TOKEN?: string;
}

const MP = 'https://api.mercadopago.com';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function mpFetch(env: Env, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(MP + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireRol(request, env, ['dueno', 'socio_ong', 'socio_ong_carga']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;

  if (vista === 'suscripciones') {
    const rows = await env.DB.prepare(
      `SELECT su.*, s.nombre, s.email FROM suscripciones su JOIN socios s ON s.id = su.socio_id
        ORDER BY su.creado DESC`,
    ).all();
    return json({ ok: true, configurado: !!env.MP_ACCESS_TOKEN, suscripciones: rows.results });
  }

  return json({ error: 'Vista desconocida' }, 404);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireRol(request, env, ['dueno']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  if (!puede(auth.rol, 'finanzas_aprobar')) return json({ error: 'Sin permiso' }, 403);
  if (!env.MP_ACCESS_TOKEN) return json({ error: 'Falta configurar el token de Mercado Pago (secret MP_ACCESS_TOKEN)' }, 503);
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  if (vista === 'suscripcion') {
    const socioId = Number(body.socio_id);
    if (!Number.isFinite(socioId)) return json({ error: 'Falta socio_id' }, 400);
    const socio = await env.DB.prepare(
      `SELECT s.id, s.nombre, s.email,
              (SELECT tier FROM membresias m WHERE m.socio_id = s.id AND m.hasta IS NULL AND m.modalidad != 'plan'
                ORDER BY m.desde DESC LIMIT 1) AS tier
         FROM socios s WHERE s.id = ?`,
    ).bind(socioId).first<{ id: number; nombre: string; email: string | null; tier: string | null }>();
    if (!socio) return json({ error: 'El socio no existe' }, 404);
    if (!socio.email) return json({ error: 'El socio no tiene email vinculado — cargalo primero en su ficha' }, 400);
    if (!socio.tier) return json({ error: 'El socio no tiene membresía vigente — asignale una primero' }, 400);
    const precio = await env.DB.prepare(
      `SELECT p.debito FROM precios p JOIN listas_precios lp ON lp.id = p.lista_id
        WHERE p.item = ? AND p.tipo = 'membresia' AND p.debito IS NOT NULL
        ORDER BY lp.vigente_desde DESC LIMIT 1`,
    ).bind(socio.tier).first<{ debito: number }>();
    if (!precio) return json({ error: `No hay precio de débito para ${socio.tier} en la lista vigente` }, 400);

    // Preapproval sin plan: débito mensual por el precio con 20%.
    const r = await mpFetch(env, '/preapproval', {
      method: 'POST',
      body: JSON.stringify({
        reason: `Flora Club — membresía ${socio.tier} (débito automático)`,
        external_reference: `socio:${socio.id}`,
        payer_email: socio.email,
        back_url: 'https://floraong.ar/socios/cuenta/',
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: precio.debito,
          currency_id: 'ARS',
        },
        status: 'pending',
      }),
    });
    if (!r.ok) {
      return json({ error: `Mercado Pago respondió ${r.status}: ${String(r.data.message || JSON.stringify(r.data)).slice(0, 200)}` }, 502);
    }
    await env.DB.prepare(
      `INSERT INTO suscripciones (socio_id, mp_preapproval_id, estado, monto)
       VALUES (?, ?, 'pendiente', ?)
       ON CONFLICT (mp_preapproval_id) DO NOTHING`,
    ).bind(socio.id, String(r.data.id), precio.debito).run();
    return json({
      ok: true,
      link: r.data.init_point,               // el socio entra acá y autoriza el débito
      preapprovalId: r.data.id,
      monto: precio.debito,
      tier: socio.tier,
    });
  }

  if (vista === 'sincronizar') {
    const id = Number(body.id);
    const su = await env.DB.prepare(`SELECT * FROM suscripciones WHERE id = ?`).bind(id).first<{ id: number; mp_preapproval_id: string }>();
    if (!su) return json({ error: 'No existe' }, 404);
    const r = await mpFetch(env, `/preapproval/${su.mp_preapproval_id}`);
    if (!r.ok) return json({ error: `MP respondió ${r.status}` }, 502);
    const ESTADO: Record<string, string> = { authorized: 'activa', paused: 'pausada', cancelled: 'cancelada', pending: 'pendiente' };
    const estado = ESTADO[String(r.data.status)] || 'pendiente';
    await env.DB.prepare(`UPDATE suscripciones SET estado = ?, actualizado = datetime('now') WHERE id = ?`)
      .bind(estado, id).run();
    return json({ ok: true, estado });
  }

  return json({ error: 'Vista desconocida' }, 404);
};
