// Mercado Pago — el centro de comando del débito automático.
//
// MODELO (orden de Guille 01/08): se usan los LINKS DE PLAN precargados del
// panel de MP — nunca preapprovals individuales por socio. El link es
// genérico: MP no nos dice qué socio lo pagó, así que el sistema DESCUBRE
// las suscripciones nuevas de cada plan, matchea por email del pagador y lo
// que no matchea va a una cola de identificación manual (patrón Unificar).
//
//   GET  /api/panel/mp/suscripciones     → todas, con último débito
//   GET  /api/panel/mp/cola              → socios activos con membresía SIN débito vivo
//   GET  /api/panel/mp/identificar       → suscripciones sin socio + candidatos
//   POST /api/panel/mp/enviar        {socio_id, via}   → manda el link del PLAN
//   POST /api/panel/mp/identificar   {suscripcion_id, socio_id | no_es_socio} → decisión humana
//   POST /api/panel/mp/sincronizar   {id?}             → descubre + refresca + rescata pagos
//   POST /api/panel/mp/no-insistir   {socio_id, valor}
//   POST /api/panel/mp/monto         {suscripcion_id}  → solo suscripciones individuales legadas
//
// El token vive como secret MP_ACCESS_TOKEN en Cloudflare Pages — nunca en el repo.
import { requireRol, puede } from '../_rol';
import { procesarPagoAprobado, aplicarPreapproval, descubrirPreapproval, asegurarMembresiaDebito } from '../../mp/webhook';
import { tokens } from '../reprocann/_unificar';

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
// cancelada, la más nueva.
const SUSC_RELEVANTE = `(
  SELECT id FROM suscripciones s2 WHERE s2.socio_id = s.id
   ORDER BY CASE s2.estado WHEN 'activa' THEN 0 WHEN 'pendiente' THEN 1
            WHEN 'pausada' THEN 2 ELSE 3 END, s2.actualizado DESC, s2.id DESC LIMIT 1)`;

interface PlanInfo { plan_id: string; link: string; monto: number; tipo: string; gramos: number | null }

// Los planes del panel de MP, por tier (lista vigente gana). El link no se
// guarda: se construye del id — una sola verdad, cero drift.
async function planesDebito(env: Env): Promise<Record<string, PlanInfo>> {
  const rows = await env.DB.prepare(
    `SELECT p.item, p.tipo, p.debito, p.contado, p.gramos, p.mp_plan_id
       FROM precios p JOIN listas_precios lp ON lp.id = p.lista_id
      WHERE p.mp_plan_id IS NOT NULL
      ORDER BY lp.vigente_desde DESC`,
  ).all<{ item: string; tipo: string; debito: number | null; contado: number | null; gramos: number | null; mp_plan_id: string }>();
  const out: Record<string, PlanInfo> = {};
  for (const r of rows.results) {
    if (r.item in out) continue;
    out[r.item] = {
      plan_id: r.mp_plan_id,
      link: `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${r.mp_plan_id}`,
      monto: r.debito ?? r.contado ?? 0,
      tipo: r.tipo,
      gramos: r.gramos,
    };
  }
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
    const rows = await env.DB.prepare(
      `SELECT su.*, s.nombre, s.email, s.telefono,
              (SELECT MAX(fecha) FROM movimientos mv WHERE mv.suscripcion_id = su.id
                AND mv.origen = 'mp_webhook') AS ultimo_debito
         FROM suscripciones su LEFT JOIN socios s ON s.id = su.socio_id
        WHERE su.no_es_socio = 0
        ORDER BY CASE su.estado WHEN 'activa' THEN 0 WHEN 'pendiente' THEN 1 WHEN 'pausada' THEN 2 ELSE 3 END,
                 su.actualizado DESC`,
    ).all<Record<string, unknown>>();
    return json({ ok: true, configurado: !!env.MP_ACCESS_TOKEN, suscripciones: rows.results });
  }

  // La cola de "para mandar": socio activo + membresía vigente, sin débito
  // vivo. El link es el del PLAN de su tier; el último envío sale del
  // historial (el envío existe antes que la suscripción).
  if (vista === 'cola') {
    const [rows, planes] = await Promise.all([
      env.DB.prepare(
        `SELECT s.id, s.nombre, s.email, s.telefono, s.debito_no_insistir,
                m.tier, m.modalidad,
                su.id AS susc_id, su.estado AS susc_estado, su.fin AS susc_fin,
                (SELECT e.enviado FROM envios_debito e WHERE e.socio_id = s.id ORDER BY e.enviado DESC LIMIT 1) AS link_enviado,
                (SELECT e.via FROM envios_debito e WHERE e.socio_id = s.id ORDER BY e.enviado DESC LIMIT 1) AS link_via
           FROM socios s
           JOIN membresias m ON m.socio_id = s.id AND m.hasta IS NULL AND m.modalidad != 'plan'
           LEFT JOIN suscripciones su ON su.id = ${SUSC_RELEVANTE}
          WHERE s.estado = 'activo' AND (s.numero IS NULL OR s.numero != -1)
            AND (su.id IS NULL OR su.estado = 'cancelada'
                 OR (su.estado = 'pendiente' AND COALESCE(su.fin, date(su.creado, '+10 day')) < date('now')))
          GROUP BY s.id
          ORDER BY s.debito_no_insistir, s.nombre`,
      ).all<Record<string, unknown>>(),
      planesDebito(env),
    ]);
    const cola = rows.results.map((r) => {
      const p = planes[String(r.tier)];
      return { ...r, monto: p?.monto ?? null, plan_link: p?.link ?? null };
    });
    return json({ ok: true, configurado: !!env.MP_ACCESS_TOKEN, cola });
  }

  // El link de pago de UN socio, para mandárselo desde el padrón (módulo
  // Socios): resuelve la ficha por email y devuelve el link del plan de su
  // tier con el estado del débito — o qué le falta para poder mandárselo.
  if (vista === 'link') {
    const email = (new URL(request.url).searchParams.get('email') || '').trim().toLowerCase();
    if (!email) return json({ error: 'Falta email' }, 400);
    const socio = await env.DB.prepare(
      `SELECT s.id, s.nombre, s.telefono, s.email, s.debito_no_insistir,
              (SELECT tier FROM membresias m WHERE m.socio_id = s.id AND m.hasta IS NULL AND m.modalidad != 'plan'
                ORDER BY m.desde DESC LIMIT 1) AS tier,
              su.estado AS debito_estado, su.tier AS debito_tier, su.fin AS debito_fin,
              (SELECT e.enviado FROM envios_debito e WHERE e.socio_id = s.id ORDER BY e.enviado DESC LIMIT 1) AS link_enviado,
              (SELECT e.via FROM envios_debito e WHERE e.socio_id = s.id ORDER BY e.enviado DESC LIMIT 1) AS link_via
         FROM socios s
         LEFT JOIN suscripciones su ON su.id = ${SUSC_RELEVANTE}
        WHERE s.email = ? AND (s.numero IS NULL OR s.numero != -1)`,
    ).bind(email).first<Record<string, unknown>>();
    if (!socio) return json({ ok: true, sinFicha: true });
    const planes = await planesDebito(env);
    // todos los planes de membresía: el modal deja ELEGIR (el tier vigente es
    // solo la sugerencia — puede estar retirando 10 y querer pasarse a 20)
    const opciones = Object.entries(planes)
      .filter(([, p]) => p.tipo === 'membresia')
      .map(([tier, p]) => ({ tier, monto: p.monto, gramos: p.gramos, link: p.link }))
      .sort((a, b) => (a.gramos || 0) - (b.gramos || 0));
    const plan = socio.tier ? planes[String(socio.tier)] : null;
    return json({
      ok: true,
      socio_id: socio.id, nombre: socio.nombre, telefono: socio.telefono,
      tier: socio.tier || null, monto: plan?.monto ?? null, link: plan?.link ?? null,
      planes: opciones,
      debito_estado: socio.debito_estado, debito_fin: socio.debito_fin,
      link_enviado: socio.link_enviado, link_via: socio.link_via,
      no_insistir: !!socio.debito_no_insistir,
    });
  }

  // Suscripciones descubiertas sin socio: el pagador de MP no matcheó con el
  // padrón. Candidatos puntuados — la decisión es siempre del presidente.
  if (vista === 'identificar') {
    if (auth.rol !== 'dueno') return json({ error: 'Sin permiso' }, 403);
    const [sinDuenio, pool] = await Promise.all([
      env.DB.prepare(
        `SELECT su.*, (SELECT COUNT(*) FROM movimientos mv WHERE mv.suscripcion_id = su.id) AS pagos
           FROM suscripciones su
          WHERE su.socio_id IS NULL AND su.no_es_socio = 0 AND su.estado != 'cancelada'
          ORDER BY su.creado DESC`,
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        `SELECT s.id, s.nombre, s.email, m.tier,
                (SELECT e.enviado FROM envios_debito e WHERE e.socio_id = s.id ORDER BY e.enviado DESC LIMIT 1) AS link_enviado,
                (SELECT e.tier FROM envios_debito e WHERE e.socio_id = s.id ORDER BY e.enviado DESC LIMIT 1) AS enviado_tier
           FROM socios s
           JOIN membresias m ON m.socio_id = s.id AND m.hasta IS NULL AND m.modalidad != 'plan'
           LEFT JOIN suscripciones su ON su.id = ${SUSC_RELEVANTE}
          WHERE s.estado = 'activo' AND (s.numero IS NULL OR s.numero != -1)
            AND (su.id IS NULL OR su.estado = 'cancelada')
          GROUP BY s.id`,
      ).all<{ id: number; nombre: string; email: string | null; tier: string; link_enviado: string | null; enviado_tier: string | null }>(),
    ]);
    const hace30d = Date.now() - 30 * 86400000;
    const pendientes = sinDuenio.results.map((su) => {
      const localPart = String(su.mp_payer_email || '').split('@')[0];
      const tokensPagador = tokens(localPart.replace(/[._\-\d]+/g, ' '));
      const candidatos = pool.results
        .map((s) => {
          let puntaje = 0;
          const senales: string[] = [];
          if (su.tier && s.tier === su.tier) { puntaje += 40; senales.push('misma membresía'); }
          const tn = tokens(s.nombre);
          if (tokensPagador.length && tokensPagador.some((t) => tn.includes(t))) { puntaje += 30; senales.push('el email se parece'); }
          if (s.link_enviado && Date.parse(s.link_enviado.replace(' ', 'T') + 'Z') > hace30d
              && (!su.tier || s.enviado_tier === su.tier)) { puntaje += 20; senales.push('le mandamos el link hace poco'); }
          return { socio_id: s.id, nombre: s.nombre, email: s.email, tier: s.tier, puntaje, senales };
        })
        .filter((c) => c.puntaje > 0)
        .sort((a, b) => b.puntaje - a.puntaje)
        .slice(0, 3);
      return { ...su, candidatos };
    });
    return json({ ok: true, pendientes, pool: pool.results.map((s) => ({ socio_id: s.id, nombre: s.nombre, tier: s.tier })) });
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

  if (vista === 'no-insistir') {
    const socioId = Number(body.socio_id);
    if (!Number.isFinite(socioId)) return json({ error: 'Falta socio_id' }, 400);
    await env.DB.prepare(`UPDATE socios SET debito_no_insistir = ?, actualizado = datetime('now') WHERE id = ?`)
      .bind(body.valor ? 1 : 0, socioId).run();
    return json({ ok: true });
  }

  // Mandar el link del PLAN del tier del socio. WhatsApp lo abre el front
  // (esto registra); el email lo manda el server con Resend.
  if (vista === 'enviar') {
    const socioId = Number(body.socio_id);
    const via = String(body.via);
    if (!Number.isFinite(socioId)) return json({ error: 'Falta socio_id' }, 400);
    if (via !== 'whatsapp' && via !== 'email') return json({ error: 'via inválida' }, 400);
    const socio = await env.DB.prepare(
      `SELECT s.id, s.nombre, s.email,
              (SELECT tier FROM membresias m WHERE m.socio_id = s.id AND m.hasta IS NULL AND m.modalidad != 'plan'
                ORDER BY m.desde DESC LIMIT 1) AS tier
         FROM socios s WHERE s.id = ?`,
    ).bind(socioId).first<{ id: number; nombre: string; email: string | null; tier: string | null }>();
    if (!socio) return json({ error: 'El socio no existe' }, 404);
    const planes = await planesDebito(env);
    // el tier puede venir elegido a mano (upgrade/downgrade desde el modal);
    // si no viene, se usa el de la membresía vigente
    const tier = String(body.tier || socio.tier || '');
    if (!tier) return json({ error: 'Elegí una membresía para el link' }, 400);
    const plan = planes[tier];
    if (!plan || plan.tipo !== 'membresia') return json({ error: `No hay plan de Mercado Pago cargado para ${tier}` }, 400);

    if (via === 'email') {
      if (!socio.email) return json({ error: 'El socio no tiene email' }, 400);
      const mail = await enviarMailDebito(env, {
        email: socio.email, nombre: socio.nombre, tier, monto: plan.monto, link: plan.link,
      });
      if (!mail.enviado) return json({ error: `El mail no salió (${mail.error}) — mandáselo por WhatsApp` }, 502);
    }
    await env.DB.prepare(
      `INSERT INTO envios_debito (socio_id, tier, mp_plan_id, via, enviado_por) VALUES (?, ?, ?, ?, ?)`,
    ).bind(socioId, tier, plan.plan_id, via, auth.email).run();
    return json({ ok: true, via, link: plan.link, monto: plan.monto, tier });
  }

  // La decisión humana sobre una suscripción descubierta sin socio.
  if (vista === 'identificar') {
    const suscId = Number(body.suscripcion_id);
    if (!Number.isFinite(suscId)) return json({ error: 'Falta suscripcion_id' }, 400);
    const su = await env.DB.prepare(`SELECT * FROM suscripciones WHERE id = ?`).bind(suscId)
      .first<{ id: number; socio_id: number | null; mp_plan_id: string | null; tier: string | null }>();
    if (!su) return json({ error: 'No existe' }, 404);

    if (body.no_es_socio) {
      await env.DB.prepare(`UPDATE suscripciones SET no_es_socio = 1, actualizado = datetime('now') WHERE id = ?`).bind(suscId).run();
      return json({ ok: true, descartada: true });
    }

    const socioId = Number(body.socio_id);
    if (!Number.isFinite(socioId)) return json({ error: 'Falta socio_id' }, 400);
    const viva = await env.DB.prepare(
      `SELECT su2.id, s.nombre FROM suscripciones su2 JOIN socios s ON s.id = su2.socio_id
        WHERE su2.socio_id = ? AND su2.estado IN ('activa','pendiente','pausada') AND su2.id != ?`,
    ).bind(socioId, suscId).first<{ nombre: string }>();
    if (viva) return json({ error: `${viva.nombre} ya tiene otra suscripción viva — resolvelo en MP primero` }, 409);

    await env.DB.prepare(`UPDATE suscripciones SET socio_id = ?, no_es_socio = 0, actualizado = datetime('now') WHERE id = ?`)
      .bind(socioId, suscId).run();
    // el tier del plan pagado manda: si difiere de la membresía vigente, la
    // membresía se actualiza sola (pagar MEDIUM es ser MEDIUM)
    let gramos: number | null = null;
    if (su.tier && su.tier !== 'CUOTA SOCIAL') {
      gramos = await asegurarMembresiaDebito(env, socioId, su.tier);
    } else {
      const m = await env.DB.prepare(
        `SELECT gramos_mes FROM membresias WHERE socio_id = ? AND hasta IS NULL AND modalidad != 'plan'
          ORDER BY desde DESC LIMIT 1`,
      ).bind(socioId).first<{ gramos_mes: number }>();
      gramos = m?.gramos_mes ?? null;
    }
    // retro-enganche: los débitos que llegaron huérfanos pasan al socio, con
    // los gramos del tier pagado (habilita el saldo de esos meses)
    await env.DB.prepare(
      `UPDATE movimientos SET socio_id = ?, gramos = COALESCE(?, gramos)
        WHERE suscripcion_id = ? AND socio_id IS NULL AND categoria = 'membresia'`,
    ).bind(socioId, gramos, suscId).run();
    // la racha real = débitos acreditados de ESTA suscripción
    await env.DB.prepare(
      `UPDATE suscripciones SET racha_meses = (SELECT COUNT(*) FROM movimientos WHERE suscripcion_id = ? AND estado = 'confirmado') WHERE id = ?`,
    ).bind(suscId, suscId).run();
    return json({ ok: true, identificada: true });
  }

  if (!env.MP_ACCESS_TOKEN) return json({ error: 'Falta configurar el token de Mercado Pago (secret MP_ACCESS_TOKEN)' }, 503);

  if (vista === 'sincronizar') {
    // Con id: una sola. Sin id: descubrir + refrescar todas + rescatar pagos.
    if (body.id) {
      const su = await env.DB.prepare(`SELECT * FROM suscripciones WHERE id = ?`).bind(Number(body.id)).first<{ mp_preapproval_id: string }>();
      if (!su) return json({ error: 'No existe' }, 404);
      const r = await mpFetch(env, `/preapproval/${su.mp_preapproval_id}`);
      if (!r.ok) return json({ error: `MP respondió ${r.status}` }, 502);
      const estado = await aplicarPreapproval(env, r.data);
      return json({ ok: true, estado });
    }

    // 1) descubrimiento: por cada plan del panel, las suscripciones que MP
    //    creó desde el link — nuevas entran (con match por email), conocidas
    //    se refrescan. También averiguamos si el plan corta solo (repetitions).
    const planes = await planesDebito(env);
    let descubiertas = 0;
    const planesInactivos: string[] = [];
    for (const [tier, plan] of Object.entries(planes)) {
      const info = await mpFetch(env, `/preapproval_plan/${plan.plan_id}`);
      const repeticiones = info.ok ? Number((info.data.auto_recurring as Record<string, unknown> | undefined)?.repetitions) || null : null;
      if (info.ok && String(info.data.status) !== 'active') planesInactivos.push(tier);
      for (let offset = 0; offset < 500; offset += 50) {
        const r = await mpFetch(env, `/preapproval/search?preapproval_plan_id=${plan.plan_id}&limit=50&offset=${offset}`);
        if (!r.ok || !Array.isArray(r.data.results)) break;
        const lote = r.data.results as Record<string, unknown>[];
        for (const pre of lote) {
          const que = await descubrirPreapproval(env, pre);
          if (que === 'creada') descubiertas++;
          await aplicarPreapproval(env, pre);
          // el corte de 3 cuotas cuando el plan NO tiene repeticiones: se lo
          // ponemos nosotros, anclado a la fecha de creación del preapproval.
          // SOLO membresías — la cuota social es sin límite a propósito.
          const rec = pre.auto_recurring as Record<string, unknown> | undefined;
          if (!repeticiones && plan.tipo === 'membresia' && String(pre.status) === 'authorized' && !rec?.end_date) {
            const ancla = new Date(String(pre.date_created || Date.now()));
            ancla.setMonth(ancla.getMonth() + 2);
            ancla.setDate(ancla.getDate() + 20);
            await mpFetch(env, `/preapproval/${pre.id}`, {
              method: 'PUT', body: JSON.stringify({ auto_recurring: { end_date: ancla.toISOString() } }),
            });
            await env.DB.prepare(`UPDATE suscripciones SET fin = ? WHERE mp_preapproval_id = ?`)
              .bind(ancla.toISOString().slice(0, 10), String(pre.id)).run();
          }
        }
        if (lote.length < 50) break;
      }
    }

    // 2) refresco de las vivas que no son de estos planes (individuales legadas)
    const vivas = await env.DB.prepare(
      `SELECT id, mp_preapproval_id, estado FROM suscripciones
        WHERE estado IN ('pendiente', 'activa', 'pausada') AND origen = 'individual'`,
    ).all<{ id: number; mp_preapproval_id: string; estado: string }>();
    let revisadas = 0, cambiadas = 0;
    for (const su of vivas.results) {
      const r = await mpFetch(env, `/preapproval/${su.mp_preapproval_id}`);
      if (!r.ok) continue;
      revisadas++;
      const nuevo = await aplicarPreapproval(env, r.data);
      if (nuevo !== su.estado) cambiadas++;
    }

    // 3) débitos perdidos: pagos aprobados de 45 días sin movimiento
    let rescatados = 0;
    const desde = new Date(Date.now() - 45 * 86400000).toISOString();
    const pagos = await mpFetch(env, `/v1/payments/search?sort=date_created&criteria=desc&range=date_created&begin_date=${desde}&end_date=${new Date().toISOString()}&status=approved&limit=100`);
    if (pagos.ok && Array.isArray(pagos.data.results)) {
      for (const pago of pagos.data.results as Record<string, unknown>[]) {
        if (pago.operation_type !== 'recurring_payment') continue;
        if (await procesarPagoAprobado(env, pago)) rescatados++;
      }
    }

    const sinIdentificar = await env.DB.prepare(
      `SELECT COUNT(*) n FROM suscripciones WHERE socio_id IS NULL AND no_es_socio = 0 AND estado != 'cancelada'`,
    ).first<{ n: number }>();
    return json({
      ok: true, descubiertas, revisadas, cambiadas, rescatados,
      sinIdentificar: sinIdentificar?.n ?? 0, planesInactivos,
    });
  }

  // Solo para las suscripciones INDIVIDUALES legadas: el monto de las de plan
  // lo maneja el plan en el panel de MP.
  if (vista === 'monto') {
    const suscId = Number(body.suscripcion_id);
    const su = await env.DB.prepare(
      `SELECT su.*, (SELECT tier FROM membresias m WHERE m.socio_id = su.socio_id AND m.hasta IS NULL AND m.modalidad != 'plan'
                ORDER BY m.desde DESC LIMIT 1) AS tier_actual
         FROM suscripciones su WHERE su.id = ?`,
    ).bind(suscId).first<{ id: number; mp_preapproval_id: string; estado: string; origen: string; tier_actual: string | null }>();
    if (!su) return json({ error: 'No existe' }, 404);
    if (su.origen === 'plan') return json({ error: 'El monto lo maneja el plan en Mercado Pago — cambialo desde el panel de MP' }, 400);
    if (su.estado !== 'activa') return json({ error: 'Solo se ajusta el monto de un débito activo' }, 400);
    if (!su.tier_actual) return json({ error: 'El socio no tiene membresía vigente' }, 400);
    const precio = await env.DB.prepare(
      `SELECT p.debito FROM precios p JOIN listas_precios lp ON lp.id = p.lista_id
        WHERE p.item = ? AND p.tipo = 'membresia' AND p.debito IS NOT NULL
        ORDER BY lp.vigente_desde DESC LIMIT 1`,
    ).bind(su.tier_actual).first<{ debito: number }>();
    if (!precio) return json({ error: `No hay precio de débito para ${su.tier_actual}` }, 400);
    const r = await mpFetch(env, `/preapproval/${su.mp_preapproval_id}`, {
      method: 'PUT',
      body: JSON.stringify({ auto_recurring: { transaction_amount: precio.debito, currency_id: 'ARS' } }),
    });
    if (!r.ok) return json({ error: `MP respondió ${r.status}: ${String(r.data.message || '').slice(0, 150)}` }, 502);
    await env.DB.prepare(`UPDATE suscripciones SET monto = ?, tier = ?, actualizado = datetime('now') WHERE id = ?`)
      .bind(precio.debito, su.tier_actual, suscId).run();
    return json({ ok: true, monto: precio.debito, tier: su.tier_actual });
  }

  return json({ error: 'Vista desconocida' }, 404);
};
