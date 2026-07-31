// Mercado Pago — el centro de comando del débito automático.
//   GET  /api/panel/mp/suscripciones      → todas, con último débito y monto vigente
//   GET  /api/panel/mp/cola               → socios activos con membresía SIN débito vivo
//   POST /api/panel/mp/suscripcion  {socio_id}          → crea o REUSA el preapproval
//   POST /api/panel/mp/enviar       {suscripcion_id, via} → registra envío / manda el mail
//   POST /api/panel/mp/sincronizar  {id?}               → una o TODAS + rescate de pagos
//   POST /api/panel/mp/no-insistir  {socio_id, valor}   → silencia a quien no quiere débito
//   POST /api/panel/mp/monto        {suscripcion_id}    → ajusta el monto al precio vigente
//
// Modelo (decisión 31/07): suscripción de 3 cuotas ÚNICAMENTE con 20% off.
// Al completarse se corta sola (end_date); la renovación es un link NUEVO al
// precio vigente de ese momento — la manda el presidente desde la cola.
// El token vive como secret MP_ACCESS_TOKEN en Cloudflare Pages — nunca en el repo.
import { requireRol, puede } from '../_rol';
import { procesarPagoAprobado, aplicarPreapproval } from '../../mp/webhook';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
  MP_ACCESS_TOKEN?: string;
  RESEND_API_KEY?: string;
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

// "La suscripción relevante" de un socio: activa > pendiente > pausada >
// cancelada, la más nueva. Es la única forma sana de responder "¿cómo está el
// débito de este socio?" cuando conviven una vieja cancelada y una nueva.
const SUSC_RELEVANTE = `(
  SELECT id FROM suscripciones s2 WHERE s2.socio_id = s.id
   ORDER BY CASE s2.estado WHEN 'activa' THEN 0 WHEN 'pendiente' THEN 1
            WHEN 'pausada' THEN 2 ELSE 3 END, s2.actualizado DESC, s2.id DESC LIMIT 1)`;

// El precio de débito vigente por tier, una sola vez por request.
async function preciosDebito(env: Env): Promise<Record<string, number>> {
  const rows = await env.DB.prepare(
    `SELECT p.item, p.debito FROM precios p JOIN listas_precios lp ON lp.id = p.lista_id
      WHERE p.tipo = 'membresia' AND p.debito IS NOT NULL
      ORDER BY lp.vigente_desde DESC`,
  ).all<{ item: string; debito: number }>();
  const out: Record<string, number> = {};
  for (const r of rows.results) if (!(r.item in out)) out[r.item] = r.debito;
  return out;
}

// Mail "Activá tu débito" — mismo esqueleto nocturno del mail de bienvenida.
async function enviarMailDebito(
  env: Env,
  d: { email: string; nombre: string; tier: string; monto: number; link: string },
): Promise<{ enviado: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) return { enviado: false, error: 'RESEND_API_KEY no configurado' };
  const saludo = d.nombre ? d.nombre.split(/\s+/)[0] : '';
  const montoFmt = '$' + d.monto.toLocaleString('es-AR');
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Flora</title></head>
<body style="margin:0;padding:0;background:#130d1c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#130d1c;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#1b1326;border:1px solid #2b2140;border-radius:20px;">
        <tr><td style="padding:40px 36px 0;text-align:center;">
          <img src="https://floraong.ar/img/flora-logo-white.png" width="140" alt="Flora" style="display:block;margin:0 auto 22px;width:140px;height:auto;border:0;">
          <span style="display:inline-block;background:#221c2c;border:1px solid rgba(255,255,255,0.14);border-radius:999px;padding:7px 16px;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#d8d2e0;">Débito automático −20%</span>
        </td></tr>
        <tr><td style="padding:20px 36px 0;text-align:center;">
          <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:26px;line-height:1.3;color:#f4f1f7;">${saludo ? `${saludo}, tu membresía con descuento` : 'Tu membresía con descuento'}</h1>
        </td></tr>
        <tr><td style="padding:16px 36px 0;text-align:center;">
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#c9c3d4;">Activando el débito automático, tu membresía <strong style="color:#f4f1f7;">${d.tier}</strong> queda en <strong style="color:#f4f1f7;">${montoFmt} por mes</strong> — el 20% menos que de contado, por 3 meses. Se autoriza una sola vez desde Mercado Pago y podés darlo de baja cuando quieras.</p>
        </td></tr>
        <tr><td style="padding:28px 36px 0;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr><td style="border-radius:999px;background:#0A503C;">
              <a href="${d.link}" style="display:inline-block;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:999px;">Autorizar el débito →</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:32px 36px 0;"><div style="height:1px;line-height:1px;background:#2b2140;">&nbsp;</div></td></tr>
        <tr><td style="padding:20px 36px 36px;text-align:center;">
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:#8d859b;">¿Dudas? Escribinos por <a href="https://wa.me/5492996375723" style="color:#3cb492;text-decoration:none;font-weight:600;">WhatsApp</a><br>— Equipo Flora</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Flora <hola@floraong.ar>', to: d.email, subject: 'Activá tu débito automático 🌿 (−20%)', html }),
    });
    if (!res.ok) return { enviado: false, error: `Resend ${res.status}` };
    return { enviado: true };
  } catch (err) {
    return { enviado: false, error: String((err as Error)?.message || err) };
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireRol(request, env, ['dueno', 'socio_ong', 'socio_ong_carga']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;

  if (vista === 'suscripciones') {
    const [rows, precios] = await Promise.all([
      env.DB.prepare(
        `SELECT su.*, s.nombre, s.email, s.telefono,
                (SELECT tier FROM membresias m WHERE m.socio_id = s.id AND m.hasta IS NULL AND m.modalidad != 'plan'
                  ORDER BY m.desde DESC LIMIT 1) AS tier_actual,
                (SELECT MAX(fecha) FROM movimientos mv WHERE mv.socio_id = su.socio_id
                  AND mv.origen = 'mp_webhook' AND mv.concepto LIKE 'Débito automático%') AS ultimo_debito
           FROM suscripciones su JOIN socios s ON s.id = su.socio_id
          ORDER BY CASE su.estado WHEN 'activa' THEN 0 WHEN 'pendiente' THEN 1 WHEN 'pausada' THEN 2 ELSE 3 END,
                   su.actualizado DESC`,
      ).all<Record<string, unknown>>(),
      preciosDebito(env),
    ]);
    const suscripciones = rows.results.map((su) => ({
      ...su,
      monto_vigente: precios[String(su.tier_actual || su.tier || '')] ?? null,
    }));
    return json({ ok: true, configurado: !!env.MP_ACCESS_TOKEN, suscripciones });
  }

  // La cola de "para mandar": socio activo + membresía vigente, sin débito
  // vivo (nunca tuvo, canceló, o el link pendiente venció). Los "no insistir"
  // viajan con su flag para que la UI los muestre plegados, no invisibles.
  if (vista === 'cola') {
    const [rows, precios] = await Promise.all([
      env.DB.prepare(
        `SELECT s.id, s.nombre, s.email, s.telefono, s.debito_no_insistir,
                m.tier, m.modalidad,
                su.id AS susc_id, su.estado AS susc_estado, su.fin AS susc_fin,
                su.init_point, su.link_enviado, su.link_via, su.racha_meses
           FROM socios s
           JOIN membresias m ON m.socio_id = s.id AND m.hasta IS NULL AND m.modalidad != 'plan'
           LEFT JOIN suscripciones su ON su.id = ${SUSC_RELEVANTE}
          WHERE s.estado = 'activo' AND (s.numero IS NULL OR s.numero != -1)
            AND (su.id IS NULL OR su.estado = 'cancelada'
                 OR (su.estado = 'pendiente' AND su.fin < date('now')))
          GROUP BY s.id
          ORDER BY s.debito_no_insistir, s.nombre`,
      ).all<Record<string, unknown>>(),
      preciosDebito(env),
    ]);
    const cola = rows.results.map((r) => ({ ...r, monto: precios[String(r.tier)] ?? null }));
    return json({ ok: true, configurado: !!env.MP_ACCESS_TOKEN, cola });
  }

  return json({ error: 'Vista desconocida' }, 404);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireRol(request, env, ['dueno']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  if (!puede(auth.rol, 'finanzas_aprobar')) return json({ error: 'Sin permiso' }, 403);
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // no-insistir y enviar-whatsapp no le pegan a MP: no exigen token
  if (vista === 'no-insistir') {
    const socioId = Number(body.socio_id);
    if (!Number.isFinite(socioId)) return json({ error: 'Falta socio_id' }, 400);
    await env.DB.prepare(`UPDATE socios SET debito_no_insistir = ?, actualizado = datetime('now') WHERE id = ?`)
      .bind(body.valor ? 1 : 0, socioId).run();
    return json({ ok: true });
  }

  if (vista === 'enviar') {
    const suscId = Number(body.suscripcion_id);
    const via = String(body.via);
    if (!Number.isFinite(suscId)) return json({ error: 'Falta suscripcion_id' }, 400);
    if (via !== 'whatsapp' && via !== 'email') return json({ error: 'via inválida' }, 400);
    const su = await env.DB.prepare(
      `SELECT su.*, s.nombre, s.email FROM suscripciones su JOIN socios s ON s.id = su.socio_id WHERE su.id = ?`,
    ).bind(suscId).first<{ id: number; init_point: string | null; monto: number; tier: string | null; nombre: string; email: string | null }>();
    if (!su) return json({ error: 'No existe' }, 404);
    if (!su.init_point) return json({ error: 'Esta suscripción no tiene link guardado — creale una nueva' }, 400);

    if (via === 'email') {
      if (!su.email) return json({ error: 'El socio no tiene email' }, 400);
      const mail = await enviarMailDebito(env, {
        email: su.email, nombre: su.nombre, tier: su.tier || 'membresía', monto: su.monto, link: su.init_point,
      });
      if (!mail.enviado) return json({ error: `El mail no salió (${mail.error}) — mandáselo por WhatsApp` }, 502);
    }
    await env.DB.prepare(`UPDATE suscripciones SET link_enviado = datetime('now'), link_via = ?, actualizado = datetime('now') WHERE id = ?`)
      .bind(via, suscId).run();
    return json({ ok: true, via });
  }

  if (!env.MP_ACCESS_TOKEN) return json({ error: 'Falta configurar el token de Mercado Pago (secret MP_ACCESS_TOKEN)' }, 503);

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
    const precios = await preciosDebito(env);
    const monto = precios[socio.tier];
    if (!monto) return json({ error: `No hay precio de débito para ${socio.tier} en la lista vigente` }, 400);

    // Idempotencia: nunca dos suscripciones vivas del mismo socio.
    const viva = await env.DB.prepare(
      `SELECT * FROM suscripciones WHERE socio_id = ? AND estado IN ('activa', 'pausada', 'pendiente')
        ORDER BY CASE estado WHEN 'activa' THEN 0 WHEN 'pendiente' THEN 1 ELSE 2 END, actualizado DESC LIMIT 1`,
    ).bind(socioId).first<{ id: number; estado: string; fin: string | null; monto: number; init_point: string | null; mp_preapproval_id: string }>();
    if (viva?.estado === 'activa') return json({ error: 'Ya tiene el débito activo' }, 409);
    if (viva?.estado === 'pausada') return json({ error: 'Tiene el débito pausado en Mercado Pago — que lo reactive desde su cuenta, o cancelalo antes de crear otro' }, 409);
    if (viva?.estado === 'pendiente') {
      const vigente = !viva.fin || viva.fin >= new Date().toISOString().slice(0, 10);
      if (vigente && viva.monto === monto) {
        // el link pendiente sigue sano: reusarlo (recuperándolo de MP si es
        // de antes de la migración 0012 y no quedó guardado)
        let link = viva.init_point;
        if (!link) {
          const r = await mpFetch(env, `/preapproval/${viva.mp_preapproval_id}`);
          link = String(r.data.init_point || '') || null;
          if (link) await env.DB.prepare(`UPDATE suscripciones SET init_point = ? WHERE id = ?`).bind(link, viva.id).run();
        }
        if (link) return json({ ok: true, reusado: true, suscripcionId: viva.id, link, monto: viva.monto, tier: socio.tier });
      }
      // venció o quedó con monto viejo: se cancela en MP y se crea una nueva
      await mpFetch(env, `/preapproval/${viva.mp_preapproval_id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
      await env.DB.prepare(`UPDATE suscripciones SET estado = 'cancelada', actualizado = datetime('now') WHERE id = ?`).bind(viva.id).run();
    }

    // El fin inicial deja margen para autorizar; al autorizarse, el webhook lo
    // ajusta EXACTO a 3 cuotas. No hay extensión automática: la renovación es
    // un link nuevo al precio vigente, mandado desde la cola.
    const fin = new Date();
    fin.setMonth(fin.getMonth() + 3);
    fin.setDate(fin.getDate() + 10);
    const r = await mpFetch(env, '/preapproval', {
      method: 'POST',
      body: JSON.stringify({
        reason: `Flora Club - Membresia ${socio.tier} debito automatico (3 cuotas, 20% off)`,
        external_reference: `socio:${socio.id}`,
        payer_email: socio.email,
        back_url: 'https://floraong.ar/socios/cuenta/',
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: monto,
          currency_id: 'ARS',
          end_date: fin.toISOString(),
        },
        status: 'pending',
      }),
    });
    if (!r.ok) {
      return json({ error: `Mercado Pago respondió ${r.status}: ${String(r.data.message || JSON.stringify(r.data)).slice(0, 200)}` }, 502);
    }
    const ins = await env.DB.prepare(
      `INSERT INTO suscripciones (socio_id, mp_preapproval_id, estado, monto, fin, init_point, tier)
       VALUES (?, ?, 'pendiente', ?, ?, ?, ?)
       ON CONFLICT (mp_preapproval_id) DO NOTHING`,
    ).bind(socio.id, String(r.data.id), monto, fin.toISOString().slice(0, 10), String(r.data.init_point || '') || null, socio.tier).run();
    return json({
      ok: true,
      suscripcionId: Number(ins.meta.last_row_id),
      link: r.data.init_point,               // el socio entra acá y autoriza el débito
      preapprovalId: r.data.id,
      monto,
      tier: socio.tier,
    });
  }

  if (vista === 'sincronizar') {
    // Con id: una sola. Sin id: TODAS las vivas + rescate de débitos que el
    // webhook se haya perdido (idempotente por ref, así que repetir es gratis).
    if (body.id) {
      const su = await env.DB.prepare(`SELECT * FROM suscripciones WHERE id = ?`).bind(Number(body.id)).first<{ mp_preapproval_id: string }>();
      if (!su) return json({ error: 'No existe' }, 404);
      const r = await mpFetch(env, `/preapproval/${su.mp_preapproval_id}`);
      if (!r.ok) return json({ error: `MP respondió ${r.status}` }, 502);
      const estado = await aplicarPreapproval(env, r.data);
      return json({ ok: true, estado });
    }

    const vivas = await env.DB.prepare(
      `SELECT id, mp_preapproval_id, estado FROM suscripciones WHERE estado IN ('pendiente', 'activa', 'pausada')`,
    ).all<{ id: number; mp_preapproval_id: string; estado: string }>();
    let revisadas = 0, cambiadas = 0;
    for (const su of vivas.results) {
      const r = await mpFetch(env, `/preapproval/${su.mp_preapproval_id}`);
      if (!r.ok) continue;
      revisadas++;
      const nuevo = await aplicarPreapproval(env, r.data);
      if (nuevo !== su.estado) cambiadas++;
    }

    // débitos perdidos: pagos aprobados de los últimos 45 días que no tengan
    // movimiento (webhook caído, deploy en el medio, etc.)
    let rescatados = 0;
    const desde = new Date(Date.now() - 45 * 86400000).toISOString();
    const pagos = await mpFetch(env, `/v1/payments/search?sort=date_created&criteria=desc&range=date_created&begin_date=${desde}&end_date=${new Date().toISOString()}&status=approved&limit=100`);
    if (pagos.ok && Array.isArray(pagos.data.results)) {
      for (const pago of pagos.data.results as Record<string, unknown>[]) {
        if (pago.operation_type !== 'recurring_payment') continue;
        if (await procesarPagoAprobado(env, pago)) rescatados++;
      }
    }
    return json({ ok: true, revisadas, cambiadas, rescatados });
  }

  // El tier o la lista cambiaron con el débito activo: ajustar el monto del
  // preapproval al precio vigente SIN cortar la racha (MP lo permite en vivo).
  if (vista === 'monto') {
    const suscId = Number(body.suscripcion_id);
    const su = await env.DB.prepare(
      `SELECT su.*, s.id AS sid,
              (SELECT tier FROM membresias m WHERE m.socio_id = s.id AND m.hasta IS NULL AND m.modalidad != 'plan'
                ORDER BY m.desde DESC LIMIT 1) AS tier_actual
         FROM suscripciones su JOIN socios s ON s.id = su.socio_id WHERE su.id = ?`,
    ).bind(suscId).first<{ id: number; mp_preapproval_id: string; estado: string; tier_actual: string | null }>();
    if (!su) return json({ error: 'No existe' }, 404);
    if (su.estado !== 'activa') return json({ error: 'Solo se ajusta el monto de un débito activo' }, 400);
    if (!su.tier_actual) return json({ error: 'El socio no tiene membresía vigente' }, 400);
    const precios = await preciosDebito(env);
    const monto = precios[su.tier_actual];
    if (!monto) return json({ error: `No hay precio de débito para ${su.tier_actual}` }, 400);
    const r = await mpFetch(env, `/preapproval/${su.mp_preapproval_id}`, {
      method: 'PUT',
      body: JSON.stringify({ auto_recurring: { transaction_amount: monto, currency_id: 'ARS' } }),
    });
    if (!r.ok) return json({ error: `MP respondió ${r.status}: ${String(r.data.message || '').slice(0, 150)}` }, 502);
    await env.DB.prepare(`UPDATE suscripciones SET monto = ?, tier = ?, actualizado = datetime('now') WHERE id = ?`)
      .bind(monto, su.tier_actual, suscId).run();
    return json({ ok: true, monto, tier: su.tier_actual });
  }

  return json({ error: 'Vista desconocida' }, 404);
};
