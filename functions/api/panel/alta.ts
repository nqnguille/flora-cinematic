// Alta unificada de socio nuevo — la pieza que faltaba.
// Hasta hoy el club tenía dos caras del mismo socio sin puente: el acceso a
// la carta (KV SOCIOS) y la ficha financiera (D1 socios + membresias). Un
// alta desde el panel viejo creaba solo la primera, así que el Mostrador
// nunca encontraba al socio nuevo. Este endpoint crea LAS DOS de una vez.
//
//   GET  /api/panel/alta?email=…   → precarga desde la solicitud web (si existe)
//   POST /api/panel/alta           → crea acceso + ficha + membresía (+ cobro)
import { requireRol, puede } from './_rol';

interface Env {
  DB: D1Database;
  SOCIOS: KVNamespace;
  SOLICITUDES: KVNamespace;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
  RESEND_API_KEY?: string;
}

const GRAMOS: Record<string, number> = { SMALL: 10, MEDIUM: 20, LARGE: 30, 'EXTRA LARGE': 40 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// Mail de bienvenida del socio PERMANENTE (el temporal tiene el suyo en
// admin/socios.ts). Mismo look nocturno del portal. Nunca bloquea el alta,
// pero devolvemos si salió — el panel avisa "se dio de alta, el mail no salió".
async function enviarBienvenida(
  env: Env,
  { email, nombre, tier, gramos }: { email: string; nombre: string; tier: string | null; gramos: number | null },
): Promise<{ enviado: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) return { enviado: false, error: 'RESEND_API_KEY no configurado' };
  const saludo = nombre ? nombre.split(/\s+/)[0] : '';
  const linea = tier && gramos
    ? `Tu membresía es <strong style="color:#f4f1f7;">${tier}</strong>: ${gramos} gramos por mes.`
    : 'En el club te contamos cómo seguir.';
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Flora</title></head>
<body style="margin:0;padding:0;background:#130d1c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#130d1c;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#1b1326;border:1px solid #2b2140;border-radius:20px;">
        <tr><td style="padding:40px 36px 0;text-align:center;">
          <img src="https://floraong.ar/img/flora-logo-white.png" width="140" alt="Flora" style="display:block;margin:0 auto 22px;width:140px;height:auto;border:0;">
          <span style="display:inline-block;background:#221c2c;border:1px solid rgba(255,255,255,0.14);border-radius:999px;padding:7px 16px;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#d8d2e0;">Ya sos socio</span>
        </td></tr>
        <tr><td style="padding:20px 36px 0;text-align:center;">
          <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:26px;line-height:1.3;color:#f4f1f7;">${saludo ? `Bienvenido a Flora, ${saludo}` : 'Bienvenido a Flora'}</h1>
        </td></tr>
        <tr><td style="padding:16px 36px 0;text-align:center;">
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#c9c3d4;">${linea} Desde la carta podés ver las genéticas disponibles y dejar tu reserva para retirar en el club.</p>
        </td></tr>
        <tr><td style="padding:28px 36px 0;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr><td style="border-radius:999px;background:#0A503C;">
              <a href="https://floraong.ar/socios/" style="display:inline-block;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:999px;">Entrar a la carta →</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:14px 36px 0;text-align:center;">
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#8d859b;">Entrá con tu cuenta de Google: <strong style="color:#c9c3d4;">${email}</strong></p>
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
      body: JSON.stringify({ from: 'Flora <hola@floraong.ar>', to: email, subject: 'Bienvenido a Flora 🌿', html }),
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
  const auth = await requireRol(request, env, ['dueno']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const email = (new URL(request.url).searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return json({ error: 'Falta email' }, 400);

  const [solicitud, yaEnKv, ficha, precios] = await Promise.all([
    env.SOLICITUDES.get(email, 'json') as Promise<{ name?: string; phone?: string; intent?: string; tieneAdjunto?: boolean } | null>,
    env.SOCIOS.get(email),
    env.DB.prepare(`SELECT id, nombre, telefono FROM socios WHERE email = ?`).bind(email).first(),
    env.DB.prepare(
      `SELECT p.item, p.gramos, p.contado, p.debito FROM precios p
         JOIN listas_precios lp ON lp.id = p.lista_id
        WHERE p.tipo = 'membresia' ORDER BY lp.vigente_desde DESC, p.gramos`,
    ).all(),
  ]);
  // una entrada por tier (la lista más reciente gana)
  const vistos = new Set<string>();
  const tarifas = (precios.results as { item: string; gramos: number; contado: number; debito: number }[])
    .filter((p) => (vistos.has(p.item) ? false : vistos.add(p.item)));

  return json({
    ok: true,
    solicitud: solicitud ? { nombre: solicitud.name, telefono: solicitud.phone, intent: solicitud.intent, adjunto: !!solicitud.tieneAdjunto } : null,
    yaTieneAcceso: !!yaEnKv,
    yaTieneFicha: ficha || null,
    tarifas,
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireRol(request, env, ['dueno']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  if (!puede(auth.rol, 'padron_editar')) return json({ error: 'Sin permiso' }, 403);

  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const email = String(b.email || '').trim().toLowerCase();
  const nombre = String(b.nombre || '').trim().slice(0, 120);
  const telefono = String(b.telefono || '').trim().slice(0, 30) || null;
  // El estado del trámite entra al embudo (ver migración 0008), no como texto
  // libre: es lo que después dice de quién depende cada socio.
  const PASOS_ALTA = ['esperando_codigo', 'codigo_listo', 'cargado', 'en_evaluacion', 'aprobado', 'autocultivo'];
  const rcEstado = PASOS_ALTA.includes(String(b.reprocann_estado)) ? String(b.reprocann_estado) : 'esperando_codigo';
  const rcCodigo = String(b.reprocann_codigo || '').trim().toUpperCase().replace(/\s/g, '') || null;
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

  // 1) Ficha financiera (D1) — la que faltaba siempre
  let socioId: number;
  const existente = await env.DB.prepare(`SELECT id FROM socios WHERE email = ?`).bind(email).first<{ id: number }>();
  if (existente) {
    socioId = existente.id;
    await env.DB.prepare(
      `UPDATE socios SET nombre = ?, telefono = COALESCE(?, telefono),
              reprocann_estado = ?, reprocann_codigo = COALESCE(?, reprocann_codigo),
              reprocann_vence = COALESCE(?, reprocann_vence), reprocann_actualizado = datetime('now'),
              nota = COALESCE(?, nota), estado = 'activo', actualizado = datetime('now') WHERE id = ?`,
    ).bind(nombre, telefono, rcEstado, rcCodigo, rcVence, nota, socioId).run();
  } else {
    // ¿hay una ficha del Excel con ese nombre y sin email? la reusamos en vez
    // de duplicar a la persona (el caso de los 121 socios sin email).
    const porNombre = await env.DB.prepare(
      `SELECT id FROM socios WHERE email IS NULL AND lower(nombre) = lower(?) AND (numero IS NULL OR numero != -1) LIMIT 1`,
    ).bind(nombre).first<{ id: number }>();
    if (porNombre) {
      socioId = porNombre.id;
      await env.DB.prepare(
        `UPDATE socios SET email = ?, telefono = COALESCE(?, telefono),
                reprocann_estado = ?, reprocann_codigo = COALESCE(?, reprocann_codigo),
                reprocann_vence = COALESCE(?, reprocann_vence), reprocann_actualizado = datetime('now'),
                nota = COALESCE(?, nota), estado = 'activo', actualizado = datetime('now') WHERE id = ?`,
      ).bind(email, telefono, rcEstado, rcCodigo, rcVence, nota, socioId).run();
    } else {
      const r = await env.DB.prepare(
        `INSERT INTO socios (nombre, email, telefono, nota, estado, alta,
                 reprocann_estado, reprocann_codigo, reprocann_vence, reprocann_actualizado)
         VALUES (?, ?, ?, ?, 'activo', date('now'), ?, ?, ?, datetime('now'))`,
      ).bind(nombre, email, telefono, nota, rcEstado, rcCodigo, rcVence).run();
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
      tier !== 'NINGUNA' ? `${tier} — alta` : 'Alta de socio',
      socioId, monto, medio, tier !== 'NINGUNA' ? GRAMOS[tier] : null, auth.email,
    ).run();
    movimientoId = Number(r.meta.last_row_id);
  }

  // 5) La solicitud web ya cumplió su función
  await env.SOLICITUDES.delete(email).catch(() => { /* puede no existir */ });

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
