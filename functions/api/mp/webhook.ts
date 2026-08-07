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
//
// Con los links de PLAN el pago llega sin external_reference nuestro: la
// cadena de resolución es suscripción (por preapproval id o pagador) →
// socio del vínculo → email del pagador. Si nada matchea, el movimiento
// queda con socio NULL y suscripcion_id: la identificación manual del panel
// lo engancha retroactivo.
export async function procesarPagoAprobado(env: EnvMp, pago: Record<string, unknown>): Promise<boolean> {
  if (pago.status !== 'approved') return false;
  const ref = `mp:${pago.id}`;
  const ya = await env.DB.prepare(`SELECT id FROM movimientos WHERE ref = ?`).bind(ref).first();
  if (ya) return false;

  // 1) ¿de qué suscripción vino? (defensivo: MP lo expone en varios lados)
  const meta = pago.metadata as Record<string, unknown> | undefined;
  const poi = pago.point_of_interaction as Record<string, unknown> | undefined;
  const ext = String(pago.external_reference || '');
  const preId = String(meta?.preapproval_id
    || (poi?.transaction_data as Record<string, unknown> | undefined)?.subscription_id
    || (!ext.startsWith('socio:') && ext.length > 20 ? ext : '') || '');
  let susc: { id: number; socio_id: number | null; mp_plan_id: string | null } | null = null;
  if (preId) {
    susc = await env.DB.prepare(`SELECT id, socio_id, mp_plan_id FROM suscripciones WHERE mp_preapproval_id = ?`)
      .bind(preId).first();
  }
  const payerId = String((pago.payer as Record<string, unknown> | undefined)?.id || '') || null;
  if (!susc && payerId) {
    susc = await env.DB.prepare(
      `SELECT id, socio_id, mp_plan_id FROM suscripciones WHERE mp_payer_id = ? AND estado != 'cancelada'
        ORDER BY actualizado DESC, id DESC LIMIT 1`,
    ).bind(payerId).first();
  }

  // 2) ¿de qué socio? external_reference legado > vínculo de la suscripción > email
  let socioId: number | null = null;
  if (ext.startsWith('socio:')) socioId = Number(ext.slice(6)) || null;
  if (!socioId && susc?.socio_id) socioId = susc.socio_id;
  if (!socioId) {
    const email = String((pago.payer as Record<string, unknown> | undefined)?.email || '').toLowerCase();
    if (email) {
      const s = await env.DB.prepare(`SELECT id FROM socios WHERE email = ?`).bind(email).first<{ id: number }>();
      socioId = s?.id ?? null;
    }
  }

  // 3) ¿es la cuota social? Plan aparte: sin gramos, sin racha, otra categoría.
  let esCuotaSocial = false;
  if (susc?.mp_plan_id) {
    const cs = await env.DB.prepare(`SELECT 1 FROM precios WHERE tipo = 'cuota_ong' AND mp_plan_id = ?`)
      .bind(susc.mp_plan_id).first();
    esCuotaSocial = !!cs;
  }

  const bruto = Math.round(Number(pago.transaction_amount) || 0);
  const detalles = pago.transaction_details as Record<string, unknown> | undefined;
  const neto = Math.round(Number(detalles?.net_received_amount) || bruto);
  const esRecurrente = pago.operation_type === 'recurring_payment' || !!susc;
  // gramos y tier: el plan pagado manda — si difiere de la membresía vigente,
  // la membresía se actualiza sola (pagar MEDIUM es ser MEDIUM)
  let gramos: number | null = null;
  let tier = '';
  const tierSusc = await (async () => {
    if (!susc) return '';
    const t = await env.DB.prepare(`SELECT tier FROM suscripciones WHERE id = ?`).bind(susc.id).first<{ tier: string | null }>();
    return t?.tier && t.tier !== 'CUOTA SOCIAL' ? t.tier : '';
  })();
  let membresiaAsegurada = false;
  if (socioId && !esCuotaSocial) {
    if (tierSusc) {
      tier = tierSusc;
      gramos = await asegurarMembresiaDebito(env, socioId, tierSusc);
      membresiaAsegurada = true;
    } else {
      const m = await env.DB.prepare(
        `SELECT tier, gramos_mes FROM membresias WHERE socio_id = ? AND hasta IS NULL AND modalidad != 'plan'
          ORDER BY desde DESC LIMIT 1`,
      ).bind(socioId).first<{ tier: string; gramos_mes: number }>();
      gramos = m?.gramos_mes ?? null;
      tier = m?.tier ?? '';
    }
  }
  // la fecha real del pago, no la de hoy: el rescate puede llegar días después
  const fecha = String(pago.date_approved || pago.date_created || '').slice(0, 10) || null;
  const concepto = esCuotaSocial ? 'Cuota social ONG'
    : esRecurrente ? `Débito automático${tier ? ' ' + tier : ''}`
    : String(pago.description || 'Pago Mercado Pago').slice(0, 200);
  await env.DB.prepare(
    `INSERT INTO movimientos (fecha, tipo, categoria, concepto, socio_id, suscripcion_id, bruto, comision, neto, medio, estado, gramos, origen, ref, cargado_por)
     VALUES (COALESCE(?, date('now')), 'ingreso', ?, ?, ?, ?, ?, ?, ?, 'mp', 'confirmado', ?, 'mp_webhook', ?, 'mercadopago')`,
  ).bind(
    fecha, esCuotaSocial ? 'cuota_ong' : 'membresia', concepto,
    socioId, susc?.id ?? null, bruto, bruto - neto, neto, gramos, ref,
  ).run();

  if (esRecurrente && !esCuotaSocial) {
    // racha del 20%: un débito acreditado más. Directo a la suscripción del
    // pago si la conocemos; si no, a la viva más reciente del socio.
    if (susc) {
      await env.DB.prepare(
        `UPDATE suscripciones SET racha_meses = racha_meses + 1, estado = 'activa', actualizado = datetime('now') WHERE id = ?`,
      ).bind(susc.id).run();
    } else if (socioId) {
      await env.DB.prepare(
        `UPDATE suscripciones SET racha_meses = racha_meses + 1, estado = 'activa', actualizado = datetime('now')
          WHERE id = (SELECT id FROM suscripciones WHERE socio_id = ? AND estado IN ('activa', 'pendiente')
                      ORDER BY CASE estado WHEN 'activa' THEN 0 ELSE 1 END, actualizado DESC, id DESC LIMIT 1)`,
      ).bind(socioId).run();
    }
    // débito acumula: la modalidad del socio pasa a débito si no lo era
    // (si el tier vino del plan, asegurarMembresiaDebito ya lo resolvió)
    if (socioId && !membresiaAsegurada) {
      await env.DB.prepare(
        `UPDATE membresias SET modalidad = 'debito' WHERE socio_id = ? AND hasta IS NULL AND modalidad = 'contado'`,
      ).bind(socioId).run();
    }
  }
  return true;
}

// El débito manda sobre la membresía: si el socio autorizó (y paga) el plan
// de un tier DISTINTO al que tenía, su membresía pasa a ese tier — pagar
// MEDIUM es ser MEDIUM. Devuelve los gramos mensuales del tier.
export async function asegurarMembresiaDebito(env: EnvMp, socioId: number, tier: string): Promise<number | null> {
  // Backstop del gate de autocultivo: los links de plan de MP son públicos,
  // así que un pago puede llegar aunque los dos gates de arriba (el botón
  // del socio y el envío del panel) lo hayan bloqueado. Las modalidades son
  // excluyentes: sin la DDJJ de renuncia verificada, acá NO se crea la
  // membresía; la suscripción queda registrada igual y el panel la resuelve
  // a mano (verificar la DDJJ o cancelar en MP).
  const quien = await env.DB.prepare(`SELECT reprocann_estado FROM socios WHERE id = ?`)
    .bind(socioId).first<{ reprocann_estado: string | null }>();
  if (quien && ['autocultivo', 'ddjj_pendiente', 'ddjj_firmada'].includes(String(quien.reprocann_estado))) {
    return null;
  }
  const precio = await env.DB.prepare(
    `SELECT p.gramos FROM precios p JOIN listas_precios lp ON lp.id = p.lista_id
      WHERE p.item = ? AND p.tipo = 'membresia' ORDER BY lp.vigente_desde DESC LIMIT 1`,
  ).bind(tier).first<{ gramos: number | null }>();
  const gramos = precio?.gramos ? Math.round(precio.gramos) : null;
  const vigente = await env.DB.prepare(
    `SELECT id, tier, gramos_mes FROM membresias WHERE socio_id = ? AND hasta IS NULL AND modalidad != 'plan'
      ORDER BY desde DESC LIMIT 1`,
  ).bind(socioId).first<{ id: number; tier: string; gramos_mes: number | null }>();
  if (vigente && vigente.tier === tier) {
    await env.DB.prepare(
      `UPDATE membresias SET modalidad = 'debito' WHERE id = ? AND modalidad = 'contado'`,
    ).bind(vigente.id).run();
    return gramos ?? vigente.gramos_mes;
  }
  if (vigente) {
    await env.DB.prepare(`UPDATE membresias SET hasta = date('now') WHERE id = ?`).bind(vigente.id).run();
  }
  await env.DB.prepare(
    `INSERT INTO membresias (socio_id, tier, modalidad, gramos_mes, desde) VALUES (?, ?, 'debito', ?, date('now'))`,
  ).bind(socioId, tier, gramos).run();
  return gramos;
}

// Descubre un preapproval que nació de un LINK DE PLAN (sin aviso previo
// nuestro): crea la fila si el plan es de Flora. Matchea socio por email del
// pagador — salvo que ese socio ya tenga otra suscripción viva (caso "pareja
// que paga las dos desde una cuenta"): ahí queda sin identificar y decide el
// presidente en el panel. Devuelve qué pasó.
export async function descubrirPreapproval(env: EnvMp, pre: Record<string, unknown>): Promise<'existente' | 'creada' | 'ajena'> {
  const planId = String(pre.preapproval_plan_id || '');
  if (!planId) return 'ajena';
  const plan = await env.DB.prepare(
    `SELECT item, tipo, debito, contado FROM precios WHERE mp_plan_id = ? ORDER BY lista_id DESC LIMIT 1`,
  ).bind(planId).first<{ item: string; tipo: string; debito: number | null; contado: number | null }>();
  if (!plan) return 'ajena';
  const ya = await env.DB.prepare(`SELECT id FROM suscripciones WHERE mp_preapproval_id = ?`).bind(String(pre.id)).first();
  if (ya) return 'existente';

  const payerEmail = String(pre.payer_email || '').toLowerCase() || null;
  const payerId = pre.payer_id !== undefined && pre.payer_id !== null ? String(pre.payer_id) : null;
  let socioId: number | null = null;
  if (payerEmail) {
    const s = await env.DB.prepare(
      `SELECT s.id,
              (SELECT COUNT(*) FROM suscripciones su WHERE su.socio_id = s.id AND su.estado IN ('activa','pendiente','pausada')) AS vivas
         FROM socios s WHERE s.email = ?`,
    ).bind(payerEmail).first<{ id: number; vivas: number }>();
    if (s && !s.vivas) socioId = s.id;
  }
  const ESTADO: Record<string, string> = { authorized: 'activa', paused: 'pausada', cancelled: 'cancelada', pending: 'pendiente' };
  const rec = pre.auto_recurring as Record<string, unknown> | undefined;
  const monto = Math.round(Number(rec?.transaction_amount) || plan.debito || plan.contado || 0);
  await env.DB.prepare(
    `INSERT INTO suscripciones (socio_id, mp_preapproval_id, estado, monto, tier, origen, mp_plan_id, mp_payer_email, mp_payer_id, fin, actualizado)
     VALUES (?, ?, ?, ?, ?, 'plan', ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (mp_preapproval_id) DO NOTHING`,
  ).bind(
    socioId, String(pre.id), ESTADO[String(pre.status)] || 'pendiente', monto,
    plan.tipo === 'cuota_ong' ? 'CUOTA SOCIAL' : plan.item, planId, payerEmail, payerId,
    String(rec?.end_date || '').slice(0, 10) || null,
  ).run();
  return 'creada';
}

// Actualiza el estado local de un preapproval ya consultado en MP. Compartido
// entre el webhook y el "Actualizar estados" del panel: un solo lugar para el
// mapeo de estados, el ajuste de fin y el reset de racha al cancelar.
export async function aplicarPreapproval(env: EnvMp, pre: Record<string, unknown>): Promise<string> {
  const ESTADO: Record<string, string> = { authorized: 'activa', paused: 'pausada', cancelled: 'cancelada', pending: 'pendiente' };
  const estado = ESTADO[String(pre.status)] || 'pendiente';
  const rec = pre.auto_recurring as Record<string, unknown> | undefined;
  const finMp = String(rec?.end_date || '').slice(0, 10) || null;
  const montoMp = Math.round(Number(rec?.transaction_amount) || 0) || null;
  const antes = await env.DB.prepare(`SELECT estado, origen FROM suscripciones WHERE mp_preapproval_id = ?`)
    .bind(String(pre.id)).first<{ estado: string; origen: string | null }>();
  await env.DB.prepare(
    `UPDATE suscripciones SET estado = ?, fin = COALESCE(?, fin), init_point = COALESCE(init_point, ?),
            monto = COALESCE(?, monto), mp_payer_id = COALESCE(mp_payer_id, ?),
            mp_payer_email = COALESCE(mp_payer_email, ?), actualizado = datetime('now')
      WHERE mp_preapproval_id = ?`,
  ).bind(estado, finMp, String(pre.init_point || '') || null, montoMp,
         pre.payer_id !== undefined && pre.payer_id !== null ? String(pre.payer_id) : null,
         String(pre.payer_email || '').toLowerCase() || null, String(pre.id)).run();
  // Recién autorizada (solo las INDIVIDUALES legadas): ajustar el fin EXACTO
  // a 3 cuotas desde la autorización. Las de plan cortan por las repeticiones
  // del plan, o por el end_date que les pone el descubrimiento del panel.
  if (estado === 'activa' && antes?.estado === 'pendiente' && (antes.origen || 'individual') === 'individual') {
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
      // si nació de un link de plan, esta es la primera noticia que tenemos
      await descubrirPreapproval(env, pre);
      await aplicarPreapproval(env, pre);
      return new Response('ok', { status: 201 });
    }
  } catch {
    // nunca hacer fallar el webhook: MP reintenta solo y el panel tiene "Actualizar estados"
  }
  return new Response('ok', { status: 200 });
};
