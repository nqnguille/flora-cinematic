// Alta unificada de socio nuevo — la pieza que faltaba.
// Hasta hoy el club tenía dos caras del mismo socio sin puente: el acceso a
// la carta (KV SOCIOS) y la ficha financiera (D1 socios + membresias). Un
// alta desde el panel viejo creaba solo la primera, así que el Mostrador
// nunca encontraba al socio nuevo. Este endpoint crea LAS DOS de una vez.
//
//   GET  /api/panel/alta?email=…   → precarga desde la solicitud web (si existe)
//   POST /api/panel/alta           → crea acceso + ficha + membresía (+ cobro)
import { requireCap } from './_rol';

interface Env {
  DB: D1Database;
  SOCIOS: KVNamespace;
  SOLICITUDES: KVNamespace;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
  RESEND_API_KEY?: string;
}

// Los gramos de cada membresía salen de la lista de precios vigente, no de una
// constante: si acá quedaran fijos, editar un plan desde el panel asignaría los
// gramos viejos y el socio terminaría con un saldo que no es el que compró.
// El default sólo cubre el arranque en frío si la lista todavía no existe.
const GRAMOS_BASE: Record<string, number> = { SMALL: 10, MEDIUM: 20, LARGE: 30, 'EXTRA LARGE': 40 };

async function gramosVigentes(env: { DB: D1Database }): Promise<Record<string, number>> {
  try {
    const r = await env.DB.prepare(
      `SELECT p.item, p.gramos FROM precios p JOIN listas_precios l ON l.id = p.lista_id
        WHERE p.tipo = 'membresia' AND p.gramos IS NOT NULL AND l.vigente_desde <= date('now')
          AND l.id = (SELECT id FROM listas_precios WHERE vigente_desde <= date('now')
                       ORDER BY vigente_desde DESC, id DESC LIMIT 1)`,
    ).all<{ item: string; gramos: number }>();
    if (r.results.length) return Object.fromEntries(r.results.map((x) => [x.item, x.gramos]));
  } catch { /* sin lista, vale el default */ }
  return GRAMOS_BASE;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// Mail de bienvenida del socio PERMANENTE (el temporal tiene el suyo en
// admin/socios.ts). Paleta clara de marca (violeta+verde sobre blanco) y voz
// «verde cómplice» — gratitud primero (decisión 01/08). Nunca bloquea el
// alta, pero devolvemos si salió — el panel avisa si el mail no salió.
async function enviarBienvenida(
  env: Env,
  { email, nombre, tier, gramos }: { email: string; nombre: string; tier: string | null; gramos: number | null },
): Promise<{ enviado: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) return { enviado: false, error: 'RESEND_API_KEY no configurado' };
  const saludo = nombre ? nombre.split(/\s+/)[0] : '';
  const linea = tier && gramos
    ? `Tu membres&iacute;a <strong style="color:#381f56;">${tier}</strong> te da <strong style="color:#381f56;">${gramos} gramos por mes</strong>.`
    : 'En el club te contamos c&oacute;mo seguir.';
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flora</title></head>
<body style="margin:0;padding:0;background:#f4f1f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1f7;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#ffffff;border:1px solid #e6e0ee;border-radius:20px;">
        <tr><td style="padding:40px 36px 0;text-align:center;">
          <img src="https://floraong.ar/img/flora-logo.png" width="140" alt="Flora" style="display:block;margin:0 auto 22px;width:140px;height:auto;border:0;">
          <span style="display:inline-block;background:#f3eef9;border:1px solid #ddd2ec;border-radius:999px;padding:7px 16px;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#6e4fa0;">Son las 4:20 en alg&uacute;n lado</span>
        </td></tr>
        <tr><td style="padding:20px 36px 0;text-align:center;">
          <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:26px;line-height:1.3;color:#381f56;">${saludo ? `Bienvenido al club, ${saludo}` : 'Bienvenido al club'}</h1>
        </td></tr>
        <tr><td style="padding:16px 36px 0;text-align:center;">
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#4a4356;">Gracias por elegirnos &mdash; desde hoy, esta tambi&eacute;n es tu casa. ${linea} En la carta te esperan las gen&eacute;ticas de la casa: mir&aacute;, eleg&iacute; y dej&aacute; tu reserva. La retir&aacute;s en la sede o te la llevamos, como prefieras.</p>
        </td></tr>
        <tr><td style="padding:28px 36px 0;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr><td style="border-radius:999px;background:#0A503C;">
              <a href="https://floraong.ar/socios/" style="display:inline-block;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:999px;">Entrar a la carta &rarr;</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:14px 36px 0;text-align:center;">
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#8d8598;">Entr&aacute; con tu cuenta de Google: <strong style="color:#4a4356;">${email}</strong></p>
        </td></tr>
        <tr><td style="padding:32px 36px 0;"><div style="height:1px;line-height:1px;background:#eee7f4;">&nbsp;</div></td></tr>
        <tr><td style="padding:20px 36px 36px;text-align:center;">
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.9;color:#8d8598;">Contactanos por
            <a href="https://wa.me/5492996375723" style="color:#0A503C;text-decoration:none;font-weight:700;white-space:nowrap;"><img src="https://floraong.ar/img/ico-wa.png" width="15" height="15" alt="" style="vertical-align:-2px;border:0;margin-right:3px;">WhatsApp</a> o
            <a href="https://www.instagram.com/flora.cultivamosconciencia" style="color:#0A503C;text-decoration:none;font-weight:700;white-space:nowrap;"><img src="https://floraong.ar/img/ico-ig.png" width="15" height="15" alt="" style="vertical-align:-2px;border:0;margin-right:3px;">Instagram</a><br>&mdash; Equipo Flora</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Flora <hola@floraong.ar>', to: email, subject: 'Bienvenido a Flora 🌿 — llegaste a horario', html }),
    });
    if (!res.ok) return { enviado: false, error: `Resend ${res.status}` };
    return { enviado: true };
  } catch (err) {
    return { enviado: false, error: String((err as Error)?.message || err) };
  }
}

// Precarga: si esa persona ya dejó una solicitud web, sus datos vienen solos
// (se termina la triple carga nombre/email/teléfono).
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'padron_editar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const email = (new URL(request.url).searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return json({ error: 'Falta email' }, 400);

  const [solicitud, yaEnKv, ficha, precios] = await Promise.all([
    env.SOLICITUDES.get(email, 'json') as Promise<{ name?: string; phone?: string; dni?: string; intent?: string; tieneAdjunto?: boolean } | null>,
    env.SOCIOS.get(email),
    env.DB.prepare(`SELECT id, nombre, telefono, documento FROM socios WHERE email = ?`).bind(email).first(),
    env.DB.prepare(
      `SELECT p.item, p.gramos, p.contado, p.debito, p.mp_plan_id FROM precios p
         JOIN listas_precios lp ON lp.id = p.lista_id
        WHERE p.tipo = 'membresia' ORDER BY lp.vigente_desde DESC, p.gramos`,
    ).all(),
  ]);
  // una entrada por tier (la lista más reciente gana); el link del débito es
  // el del PLAN precargado en el panel de MP (nunca links personalizados)
  const vistos = new Set<string>();
  const tarifas = (precios.results as { item: string; gramos: number; contado: number; debito: number; mp_plan_id: string | null }[])
    .filter((p) => (vistos.has(p.item) ? false : vistos.add(p.item)))
    .map((p) => ({
      ...p,
      debito_link: p.mp_plan_id ? `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${p.mp_plan_id}` : null,
    }));

  return json({
    ok: true,
    solicitud: solicitud ? { nombre: solicitud.name, telefono: solicitud.phone, dni: solicitud.dni || null, intent: solicitud.intent, adjunto: !!solicitud.tieneAdjunto } : null,
    yaTieneAcceso: !!yaEnKv,
    yaTieneFicha: ficha || null,
    tarifas,
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'padron_editar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);

  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const GRAMOS = await gramosVigentes(env);
  const email = String(b.email || '').trim().toLowerCase();
  const nombre = String(b.nombre || '').trim().slice(0, 120);
  const telefono = String(b.telefono || '').trim().slice(0, 30) || null;
  // El DNI es la llave común con el consultorio (ver migración 0010): solo
  // dígitos, sin puntos. No es obligatorio (el padrón viejo no lo tiene),
  // pero si viene tiene que ser único — dos socios con el mismo DNI son la
  // misma persona duplicada.
  const documento = String(b.documento || '').replace(/\D/g, '') || null;
  // El estado del trámite entra al embudo (ver migración 0008), no como texto
  // libre: es lo que después dice de quién depende cada socio.
  const PASOS_ALTA = ['esperando_codigo', 'codigo_listo', 'cargado', 'en_evaluacion', 'aprobado', 'autocultivo'];
  const rcEstado = PASOS_ALTA.includes(String(b.reprocann_estado)) ? String(b.reprocann_estado) : 'esperando_codigo';
  // sensible a mayúsculas: los códigos reales son mixtos (KK9Gwzv454839)
  const rcCodigo = String(b.reprocann_codigo || '').trim().replace(/\s/g, '') || null;
  const rcVence = String(b.reprocann_vence || '').slice(0, 10) || null;
  const nota = String(b.nota || '').trim().slice(0, 400) || null;
  const tier = String(b.tier || 'NINGUNA');
  const cobro = String(b.cobro || 'ninguno');           // efectivo | ninguno
  const monto = Math.round(Number(b.monto) || 0);
  const medio = ['efectivo', 'transferencia', 'mp'].includes(String(b.medio)) ? String(b.medio) : 'efectivo';

  if (!EMAIL_RE.test(email)) return json({ error: 'El email no parece válido' }, 400);
  if (!nombre) return json({ error: 'Falta el nombre' }, 400);
  if (tier !== 'NINGUNA' && !(tier in GRAMOS)) return json({ error: 'Membresía inválida' }, 400);
  if (rcCodigo && rcCodigo.length !== 13) return json({ error: 'El código de vinculación tiene 13 caracteres' }, 400);
  if (rcCodigo) {
    const otro = await env.DB.prepare(`SELECT nombre FROM socios WHERE reprocann_codigo = ?`).bind(rcCodigo).first<{ nombre: string }>();
    if (otro) return json({ error: `Ese código de vinculación ya es de ${otro.nombre}` }, 409);
  }
  if (documento && (documento.length < 7 || documento.length > 8)) return json({ error: 'El DNI tiene 7 u 8 números' }, 400);
  // Si el DNI ya está en el padrón hay dos casos: es de otro socio con su
  // propio email (error real: dos personas no comparten DNI) o es una ficha
  // sin email — la misma persona, cargada antes por otro camino. Esa se
  // reusa: el DNI es mejor prueba de identidad que la coincidencia de nombre.
  let fichaPorDni: { id: number } | null = null;
  if (documento) {
    const otro = await env.DB.prepare(`SELECT id, nombre, email FROM socios WHERE documento = ?`)
      .bind(documento).first<{ id: number; nombre: string; email: string | null }>();
    if (otro && otro.email && otro.email !== email) return json({ error: `Ese DNI ya es de ${otro.nombre}` }, 409);
    if (otro && !otro.email) fichaPorDni = { id: otro.id };
  }

  // 1) Ficha financiera (D1) — la que faltaba siempre
  let socioId: number;
  const existente = await env.DB.prepare(`SELECT id FROM socios WHERE email = ?`).bind(email).first<{ id: number }>();
  if (existente) {
    socioId = existente.id;
    await env.DB.prepare(
      `UPDATE socios SET nombre = ?, telefono = COALESCE(?, telefono), documento = COALESCE(?, documento),
              reprocann_estado = ?, reprocann_codigo = COALESCE(?, reprocann_codigo),
              reprocann_vence = COALESCE(?, reprocann_vence), reprocann_actualizado = datetime('now'),
              nota = COALESCE(?, nota), estado = 'activo', papelera = NULL, actualizado = datetime('now') WHERE id = ?`,
    ).bind(nombre, telefono, documento, rcEstado, rcCodigo, rcVence, nota, socioId).run();
  } else {
    // ¿hay una ficha previa de la misma persona sin email? Primero por DNI
    // (prueba de identidad), después por nombre (el caso de los 121 socios
    // del Excel sin email). La reusamos en vez de duplicar a la persona.
    const porNombre = fichaPorDni || await env.DB.prepare(
      `SELECT id FROM socios WHERE email IS NULL AND lower(nombre) = lower(?) AND (numero IS NULL OR numero != -1) LIMIT 1`,
    ).bind(nombre).first<{ id: number }>();
    if (porNombre) {
      socioId = porNombre.id;
      await env.DB.prepare(
        `UPDATE socios SET email = ?, nombre = ?, telefono = COALESCE(?, telefono), documento = COALESCE(?, documento),
                reprocann_estado = ?, reprocann_codigo = COALESCE(?, reprocann_codigo),
                reprocann_vence = COALESCE(?, reprocann_vence), reprocann_actualizado = datetime('now'),
                nota = COALESCE(?, nota), estado = 'activo', papelera = NULL, actualizado = datetime('now') WHERE id = ?`,
      ).bind(email, nombre, telefono, documento, rcEstado, rcCodigo, rcVence, nota, socioId).run();
    } else {
      const r = await env.DB.prepare(
        `INSERT INTO socios (nombre, email, telefono, documento, nota, estado, alta,
                 reprocann_estado, reprocann_codigo, reprocann_vence, reprocann_actualizado)
         VALUES (?, ?, ?, ?, ?, 'activo', date('now'), ?, ?, ?, datetime('now'))`,
      ).bind(nombre, email, telefono, documento, nota, rcEstado, rcCodigo, rcVence).run();
      socioId = Number(r.meta.last_row_id);
    }
  }

  // 2) Membresía vigente
  if (tier !== 'NINGUNA') {
    await env.DB.prepare(
      `UPDATE membresias SET hasta = date('now') WHERE socio_id = ? AND hasta IS NULL AND modalidad != 'plan'`,
    ).bind(socioId).run();
    await env.DB.prepare(
      `INSERT INTO membresias (socio_id, tier, modalidad, gramos_mes, desde) VALUES (?, ?, 'contado', ?, date('now'))`,
    ).bind(socioId, tier, GRAMOS[tier]).run();
  }

  // 3) Acceso a la carta (KV) — conserva el perfil de Google si ya existía
  let previo: Record<string, unknown> = {};
  try {
    const crudo = await env.SOCIOS.get(email);
    if (crudo && crudo !== 'ok') previo = JSON.parse(crudo);
  } catch { /* valor legado "ok": ficha nueva */ }
  await env.SOCIOS.put(email, JSON.stringify({
    ...previo,
    nota: nota || previo.nota || null,
    telefono: telefono || previo.telefono || null,
    name: previo.name || nombre,
    alta: previo.alta || new Date().toISOString(),
    temporal: false,
    tempExpiraEn: null,
  }));

  // 4) Cobro del momento (si lo hubo) — habilita los gramos del mes
  let movimientoId: number | null = null;
  if (cobro === 'efectivo' && monto > 0) {
    const r = await env.DB.prepare(
      `INSERT INTO movimientos (fecha, tipo, categoria, concepto, socio_id, neto, medio, estado, gramos, origen, cargado_por)
       VALUES (date('now'), 'ingreso', 'membresia', ?, ?, ?, ?, 'confirmado', ?, 'manual', ?)`,
    ).bind(
      tier !== 'NINGUNA' ? `${tier} — alta` : 'Alta de paciente',
      socioId, monto, medio, tier !== 'NINGUNA' ? GRAMOS[tier] : null, auth.email,
    ).run();
    movimientoId = Number(r.meta.last_row_id);
  }

  // 5) La solicitud web ya cumplió su función — y si venía del embudo de
  // leads, el lead se convierte solo
  await env.SOLICITUDES.delete(email).catch(() => { /* puede no existir */ });
  await env.DB.prepare(
    `UPDATE leads SET etapa = 'convertido', socio_id = ?, etapa_desde = datetime('now'), actualizado = datetime('now')
      WHERE email = ? AND etapa NOT IN ('convertido')`,
  ).bind(socioId, email).run().catch(() => { /* sin lead no pasa nada */ });

  // 6) Bienvenida (nunca bloquea el alta)
  const mail = await enviarBienvenida(env, {
    email, nombre, tier: tier !== 'NINGUNA' ? tier : null, gramos: tier !== 'NINGUNA' ? GRAMOS[tier] : null,
  });

  return json({
    ok: true, socioId, movimientoId,
    gramos: tier !== 'NINGUNA' ? GRAMOS[tier] : null,
    mailEnviado: mail.enviado, mailError: mail.error || null,
    faltaCodigo: !rcCodigo && rcEstado !== 'aprobado' && rcEstado !== 'autocultivo',
  });
};
