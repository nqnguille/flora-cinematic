// Webhook de Mercado Pago (público). Nunca confía en el payload: con el id
// que llega, re-consulta a la API de MP con nuestro token — esa es la
// verificación de autenticidad. Idempotente: un pago se registra una sola vez.
//
// Al acreditarse un pago de suscripción:
//   1. entra el movimiento (ingreso membresía, confirmado, medio mp, ref=payment_id)
//   2. habilita los gramos del tier (el saldo del socio se mueve solo)
//   3. suma 1 a la racha del débito
//
// La suscripción es de 3 cuotas ÚNICAMENTE (decisión 31/07): al llegar el
// end_date se corta sola, y el panel ofrece mandar el link de renovación al
// precio vigente en ese momento. Acá no se extiende nada.
export interface EnvMp {
  DB: D1Database;
  MP_ACCESS_TOKEN?: string;
}

const MP = 'https://api.mercadopago.com';

async function mpGet(env: EnvMp, path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(MP + path, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
  if (!res.ok) return null;
  return res.json();
}

// Registra un pago APROBADO de MP: movimiento + gramos + racha. Idempotente
// por ref — la usan el webhook y el "Actualizar estados" del panel (que
// rescata pagos que el webhook se haya perdido). Devuelve si insertó.
export async function procesarPagoAprobado(env: EnvMp, pago: Record<string, unknown>): Promise<boolean> {
  if (pago.status !== 'approved') return false;
  const ref = `mp:${pago.id}`;
  const ya = await env.DB.prepare(`SELECT id FROM movimientos WHERE ref = ?`).bind(ref).first();
  if (ya) return false;

  // socio por external_reference ("socio:<id>") o por email del pagador
  let socioId: number | null = null;
  const ext = String(pago.external_reference || '');
  if (ext.startsWith('socio:')) socioId = Number(ext.slice(6)) || null;
  if (!socioId) {
    const email = String((pago.payer as Record<string, unknown> | undefined)?.email || '').toLowerCase();
    if (email) {
      const s = await env.DB.prepare(`SELECT id FROM socios WHERE email = ?`).bind(email).first<{ id: number }>();
      socioId = s?.id ?? null;
    }
  }
  const bruto = Math.round(Number(pago.transaction_amount) || 0);
  const detalles = pago.transaction_details as Record<string, unknown> | undefined;
  const neto = Math.round(Number(detalles?.net_received_amount) || bruto);
  const esRecurrente = pago.operation_type === 'recurring_payment';
  // gramos del tier vigente del socio (si lo conocemos)
  let gramos: number | null = null;
  let tier = '';
  if (socioId) {
    const m = await env.DB.prepare(
      `SELECT tier, gramos_mes FROM membresias WHERE socio_id = ? AND hasta IS NULL AND modalidad != 'plan'
        ORDER BY desde DESC LIMIT 1`,
    ).bind(socioId).first<{ tier: string; gramos_mes: number }>();
    gramos = m?.gramos_mes ?? null;
    tier = m?.tier ?? '';
  }
  // la fecha real del pago, no la de hoy: el rescate puede llegar días después
  const fecha = String(pago.date_approved || pago.date_created || '').slice(0, 10) || null;
  await env.DB.prepare(
    `INSERT INTO movimientos (fecha, tipo, categoria, concepto, socio_id, bruto, comision, neto, medio, estado, gramos, origen, ref, cargado_por)
     VALUES (COALESCE(?, date('now')), 'ingreso', 'membresia', ?, ?, ?, ?, ?, 'mp', 'confirmado', ?, 'mp_webhook', ?, 'mercadopago')`,
  ).bind(
    fecha,
    esRecurrente ? `Débito automático${tier ? ' ' + tier : ''}` : String(pago.description || 'Pago Mercado Pago').slice(0, 200),
    socioId, bruto, bruto - neto, neto, gramos, ref,
  ).run();

  if (esRecurrente && socioId) {
    // racha del 20%: un débito acreditado más — sobre UNA sola suscripción
    // (si conviven una vieja y una nueva, gana la activa más reciente)
    await env.DB.prepare(
      `UPDATE suscripciones SET racha_meses = racha_meses + 1, estado = 'activa', actualizado = datetime('now')
        WHERE id = (SELECT id FROM suscripciones WHERE socio_id = ? AND estado IN ('activa', 'pendiente')
                    ORDER BY CASE estado WHEN 'activa' THEN 0 ELSE 1 END, actualizado DESC, id DESC LIMIT 1)`,
    ).bind(socioId).run();
    // débito acumula: la modalidad del socio pasa a débito si no lo era
    await env.DB.prepare(
      `UPDATE membresias SET modalidad = 'debito' WHERE socio_id = ? AND hasta IS NULL AND modalidad = 'contado'`,
    ).bind(socioId).run();
  }
  return true;
}

// Actualiza el estado local de un preapproval ya consultado en MP. Compartido
// entre el webhook y el "Actualizar estados" del panel: un solo lugar para el
// mapeo de estados, el ajuste de fin y el reset de racha al cancelar.
export async function aplicarPreapproval(env: EnvMp, pre: Record<string, unknown>): Promise<string> {
  const ESTADO: Record<string, string> = { authorized: 'activa', paused: 'pausada', cancelled: 'cancelada', pending: 'pendiente' };
  const estado = ESTADO[String(pre.status)] || 'pendiente';
  const finMp = String((pre.auto_recurring as Record<string, unknown> | undefined)?.end_date || '').slice(0, 10) || null;
  const antes = await env.DB.prepare(`SELECT estado FROM suscripciones WHERE mp_preapproval_id = ?`)
    .bind(String(pre.id)).first<{ estado: string }>();
  await env.DB.prepare(
    `UPDATE suscripciones SET estado = ?, fin = COALESCE(?, fin), init_point = COALESCE(init_point, ?), actualizado = datetime('now')
      WHERE mp_preapproval_id = ?`,
  ).bind(estado, finMp, String(pre.init_point || '') || null, String(pre.id)).run();
  // Recién autorizada: ajustar el fin EXACTO a 3 cuotas desde la
  // autorización (cobros en el mes 0, 1 y 2 + 20 días de margen).
  if (estado === 'activa' && antes?.estado === 'pendiente') {
    const fin = new Date();
    fin.setMonth(fin.getMonth() + 2);
    fin.setDate(fin.getDate() + 20);
    await fetch(`${MP}/preapproval/${pre.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_recurring: { end_date: fin.toISOString() } }),
    }).catch(() => { /* si falla, queda el end_date de la creación (con margen) */ });
    await env.DB.prepare(`UPDATE suscripciones SET fin = ? WHERE mp_preapproval_id = ?`)
      .bind(fin.toISOString().slice(0, 10), String(pre.id)).run();
  }
  // si se cancela, la racha vuelve a cero: el 20% se pierde (decisión 30/07)
  if (estado === 'cancelada') {
    await env.DB.prepare(`UPDATE suscripciones SET racha_meses = 0 WHERE mp_preapproval_id = ?`)
      .bind(String(pre.id)).run();
  }
  return estado;
}

export const onRequestPost: PagesFunction<EnvMp> = async ({ request, env }) => {
  // MP espera un 200/201 rápido; cualquier otra cosa la reintenta.
  if (!env.MP_ACCESS_TOKEN) return new Response('sin configurar', { status: 200 });
  let body: { type?: string; topic?: string; data?: { id?: string }; resource?: string };
  try { body = await request.json(); } catch { return new Response('ok', { status: 200 }); }
  const tipo = body.type || body.topic || '';
  const id = body.data?.id || (body.resource ? String(body.resource).split('/').pop() : null);
  if (!id) return new Response('ok', { status: 200 });

  try {
    if (tipo === 'payment') {
      const pago = await mpGet(env, `/v1/payments/${id}`);
      if (!pago) return new Response('ok', { status: 200 });
      const inserto = await procesarPagoAprobado(env, pago);
      return new Response('ok', { status: inserto ? 201 : 200 });
    }

    if (tipo === 'subscription_preapproval') {
      const pre = await mpGet(env, `/preapproval/${id}`);
      if (!pre) return new Response('ok', { status: 200 });
      await aplicarPreapproval(env, pre);
      return new Response('ok', { status: 201 });
    }
  } catch {
    // nunca hacer fallar el webhook: MP reintenta solo y el panel tiene "Actualizar estados"
  }
  return new Response('ok', { status: 200 });
};
