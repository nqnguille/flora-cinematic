// Padrón financiero — las fichas de los socios (D1, hoja Pacientes migrada):
//   GET   /api/panel/padron/maestra      → LA lista única: ficha + membresía +
//         débito + paso REPROCANN + acceso a la carta (KV) + sugerencias
//   GET   /api/panel/padron/lista        → (legado) fichas con membresía
//   PATCH /api/panel/padron/socio        → {id, email?, telefono?, nota?, estado?}
//   POST  /api/panel/padron/membresia    → {socio_id, tier} asigna membresía vigente
//   POST  /api/panel/padron/sugerencia   → {socio_id, aceptar: true|false}
// Editar exige padron_editar (presidente); ver alcanza con padron_ver.
import { requireRol, puede } from '../_rol';
import { PASOS } from '../reprocann/_pasos';
import { tokens } from '../reprocann/_unificar';

interface Env {
  DB: D1Database;
  SOCIOS: KVNamespace;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

const GRAMOS: Record<string, number> = { SMALL: 10, MEDIUM: 20, LARGE: 30, 'EXTRA LARGE': 40 };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireRol(request, env, ['dueno', 'socio_ong', 'socio_ong_carga', 'mostrador']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  if (!puede(auth.rol, 'padron_ver')) return json({ error: 'Sin permiso' }, 403);
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;

  // La lista maestra de la ficha 360°: una fila por persona con las cuatro
  // dimensiones (membresía, débito, REPROCANN, acceso a la carta). Los que
  // tienen acceso a la carta pero no ficha entran al final como sinFicha.
  if (vista === 'maestra') {
    const hoy = new Date().toISOString().slice(0, 10);
    const [socios, sug] = await Promise.all([
      env.DB.prepare(
        `SELECT s.id, s.numero, s.nombre, s.email, s.telefono, s.documento, s.estado, s.nota,
                s.reprocann_estado, s.reprocann_codigo, s.reprocann_vence, s.reprocann_actualizado,
                s.debito_no_insistir,
                m.tier, m.modalidad, m.gramos_mes,
                (SELECT MAX(fecha) FROM movimientos mv WHERE mv.socio_id = s.id AND mv.tipo = 'ingreso'
                  AND mv.categoria = 'membresia') AS ultimo_pago,
                (SELECT MAX(fecha) FROM dispensas d WHERE d.socio_id = s.id) AS ultimo_retiro,
                su.estado AS debito_estado, su.fin AS debito_fin
           FROM socios s
           LEFT JOIN membresias m ON m.socio_id = s.id AND m.hasta IS NULL
           LEFT JOIN suscripciones su ON su.id = (
                SELECT id FROM suscripciones s2 WHERE s2.socio_id = s.id
                 ORDER BY CASE s2.estado WHEN 'activa' THEN 0 WHEN 'pendiente' THEN 1
                          WHEN 'pausada' THEN 2 ELSE 3 END, s2.actualizado DESC, s2.id DESC LIMIT 1)
          WHERE s.numero != -1 OR s.numero IS NULL
          GROUP BY s.id
          ORDER BY s.estado = 'activo' DESC, s.nombre`,
      ).all<Record<string, unknown>>(),
      env.DB.prepare(`SELECT * FROM sugerencias_email`).all(),
    ]);

    // acceso a la carta (KV): lastLogin/logins/temporal por email. Las claves
    // KV no cuentan como subrequests HTTP — ~160 gets van sobrados.
    const kv = new Map<string, Record<string, unknown>>();
    try {
      const lista = await env.SOCIOS.list({ limit: 1000 });
      const valores = await Promise.all(lista.keys.map(async (k) => {
        const crudo = await env.SOCIOS.get(k.name);
        if (!crudo) return null;
        if (crudo === 'ok') return { email: k.name };
        try { return { email: k.name, ...JSON.parse(crudo) }; } catch { return { email: k.name }; }
      }));
      for (const v of valores) if (v) kv.set(String(v.email).toLowerCase(), v);
    } catch { /* sin KV la lista sale igual, solo sin estado de carta */ }

    const porPaso = Object.fromEntries(PASOS.map((p) => [p.id, p]));
    const filas = socios.results.map((s) => {
      const acceso = s.email ? kv.get(String(s.email).toLowerCase()) : undefined;
      if (acceso) kv.delete(String(s.email).toLowerCase());
      const paso = porPaso[String(s.reprocann_estado)] || null;
      const vence = String(s.reprocann_vence || '');
      const porVencer = s.reprocann_estado === 'aprobado' && vence &&
        (Date.parse(vence) - Date.parse(hoy)) < 60 * 86400000;
      return {
        ...s,
        quien: paso?.quien || '—',
        paso_nombre: paso?.nombre || String(s.reprocann_estado || '—'),
        paso_ayuda: paso?.ayuda || '',
        por_vencer: !!porVencer,
        carta: acceso ? {
          lastLogin: acceso.lastLogin || null, logins: acceso.logins || 0,
          temporal: !!acceso.temporal, tempExpiraEn: acceso.tempExpiraEn || null,
        } : null,
      };
    });
    // acceso a la carta sin ficha en el padrón (la vieja "alta rápida")
    const huerfanos = [...kv.values()].map((v) => ({
      id: null, sinFicha: true, email: v.email,
      nombre: String(v.name || [v.givenName, v.familyName].filter(Boolean).join(' ') || v.email),
      telefono: v.telefono || null, nota: v.nota || null,
      quien: '—', paso_nombre: '—', paso_ayuda: '', por_vencer: false,
      carta: { lastLogin: v.lastLogin || null, logins: v.logins || 0, temporal: !!v.temporal, tempExpiraEn: v.tempExpiraEn || null },
    }));

    // ¿Un huérfano y una ficha sin email son la misma persona? Cruce por
    // nombre normalizado (misma vara que Unificar): exacto o subset de
    // tokens. Se confirma a mano en la card "Cruces por confirmar" — el Sí
    // le pone el email a la ficha y el huérfano desaparece solo.
    const sinEmail = filas.filter((f) => !f.email && f.nombre);
    const sugerenciasCarta: { email: string; nombre_kv: string; socio_id: number; nombre_socio: string; confianza: string }[] = [];
    for (const h of huerfanos) {
      const th = tokens(h.nombre);
      if (th.length < 2) continue;
      const setH = new Set(th);
      const candidatos = sinEmail.map((f) => {
        const tf = tokens(String(f.nombre));
        const inter = tf.filter((t) => setH.has(t));
        const exacto = tf.length === th.length && inter.length === tf.length;
        const subset = !exacto && inter.length >= 2 && (inter.length === tf.length || inter.length === th.length);
        return { f, puntos: exacto ? 2 : subset ? 1 : 0 };
      }).filter((c) => c.puntos > 0).sort((a, b) => b.puntos - a.puntos);
      if (candidatos.length === 1 || (candidatos.length > 1 && candidatos[0].puntos > candidatos[1].puntos)) {
        const c = candidatos[0];
        sugerenciasCarta.push({
          email: String(h.email), nombre_kv: h.nombre, socio_id: Number(c.f.id),
          nombre_socio: String(c.f.nombre), confianza: c.puntos === 2 ? 'exacto' : 'parcial',
        });
      }
    }

    return json({ ok: true, pasos: PASOS, socios: [...filas, ...huerfanos], sugerencias: sug.results, sugerenciasCarta });
  }

  if (vista === 'lista') {
    const [socios, sug] = await Promise.all([
      env.DB.prepare(
        `SELECT s.id, s.numero, s.nombre, s.email, s.telefono, s.documento, s.estado, s.reprocann, s.nota,
                s.debito_no_insistir,
                m.tier, m.modalidad, m.gramos_mes,
                (SELECT MAX(fecha) FROM movimientos mv WHERE mv.socio_id = s.id AND mv.tipo = 'ingreso'
                  AND mv.categoria = 'membresia') AS ultimo_pago,
                (SELECT MAX(fecha) FROM dispensas d WHERE d.socio_id = s.id) AS ultimo_retiro,
                su.estado AS debito_estado, su.fin AS debito_fin
           FROM socios s
           LEFT JOIN membresias m ON m.socio_id = s.id AND m.hasta IS NULL
           LEFT JOIN suscripciones su ON su.id = (
                SELECT id FROM suscripciones s2 WHERE s2.socio_id = s.id
                 ORDER BY CASE s2.estado WHEN 'activa' THEN 0 WHEN 'pendiente' THEN 1
                          WHEN 'pausada' THEN 2 ELSE 3 END, s2.actualizado DESC, s2.id DESC LIMIT 1)
          WHERE s.numero != -1 OR s.numero IS NULL
          GROUP BY s.id
          ORDER BY s.estado = 'activo' DESC, s.nombre`,
      ).all(),
      env.DB.prepare(`SELECT * FROM sugerencias_email`).all(),
    ]);
    return json({ ok: true, socios: socios.results, sugerencias: sug.results });
  }

  return json({ error: 'Vista desconocida' }, 404);
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireRol(request, env, ['dueno']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;
  if (vista !== 'socio') return json({ error: 'Vista desconocida' }, 404);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const id = Number(body.id);
  if (!Number.isFinite(id)) return json({ error: 'Falta id' }, 400);

  const cambios: string[] = [];
  const valores: (string | null)[] = [];
  if ('email' in body) {
    const email = String(body.email || '').trim().toLowerCase() || null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Email inválido' }, 400);
    if (email) {
      const otro = await env.DB.prepare(`SELECT nombre FROM socios WHERE email = ? AND id != ?`).bind(email, id).first<{ nombre: string }>();
      if (otro) return json({ error: `Ese email ya es de ${otro.nombre}` }, 409);
    }
    cambios.push('email = ?'); valores.push(email);
  }
  if ('telefono' in body) { cambios.push('telefono = ?'); valores.push(String(body.telefono || '').trim().slice(0, 30) || null); }
  if ('documento' in body) {
    // DNI: la llave común con el consultorio (migración 0010) — solo dígitos y único.
    const doc = String(body.documento || '').replace(/\D/g, '') || null;
    if (doc && (doc.length < 7 || doc.length > 8)) return json({ error: 'El DNI tiene 7 u 8 números' }, 400);
    if (doc) {
      const otro = await env.DB.prepare(`SELECT nombre FROM socios WHERE documento = ? AND id != ?`).bind(doc, id).first<{ nombre: string }>();
      if (otro) return json({ error: `Ese DNI ya es de ${otro.nombre}` }, 409);
    }
    cambios.push('documento = ?'); valores.push(doc);
  }
  if ('nota' in body) { cambios.push('nota = ?'); valores.push(String(body.nota || '').trim().slice(0, 400) || null); }
  if ('estado' in body) {
    const estado = String(body.estado);
    if (estado !== 'activo' && estado !== 'inactivo') return json({ error: 'Estado inválido' }, 400);
    cambios.push('estado = ?'); valores.push(estado);
  }
  if (!cambios.length) return json({ error: 'Nada para cambiar' }, 400);
  await env.DB.prepare(`UPDATE socios SET ${cambios.join(', ')}, actualizado = datetime('now') WHERE id = ?`)
    .bind(...valores, id).run();
  // si le puso email a mano, la sugerencia pendiente ya no aplica
  if ('email' in body) await env.DB.prepare(`DELETE FROM sugerencias_email WHERE socio_id = ?`).bind(id).run();
  return json({ ok: true });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireRol(request, env, ['dueno']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  if (vista === 'membresia') {
    const socioId = Number(body.socio_id);
    const tier = String(body.tier || '');
    if (!Number.isFinite(socioId)) return json({ error: 'Falta socio_id' }, 400);
    if (tier !== 'NINGUNA' && !(tier in GRAMOS)) return json({ error: 'Membresía inválida' }, 400);
    // cerrar la vigente (si hay) y abrir la nueva
    await env.DB.prepare(
      `UPDATE membresias SET hasta = date('now') WHERE socio_id = ? AND hasta IS NULL AND modalidad != 'plan'`,
    ).bind(socioId).run();
    if (tier !== 'NINGUNA') {
      await env.DB.prepare(
        `INSERT INTO membresias (socio_id, tier, modalidad, gramos_mes, desde) VALUES (?, ?, 'contado', ?, date('now'))`,
      ).bind(socioId, tier, GRAMOS[tier]).run();
    }
    return json({ ok: true });
  }

  if (vista === 'sugerencia') {
    const socioId = Number(body.socio_id);
    const sug = await env.DB.prepare(`SELECT * FROM sugerencias_email WHERE socio_id = ?`).bind(socioId).first<{ email: string }>();
    if (!sug) return json({ error: 'No hay sugerencia para ese socio' }, 404);
    if (body.aceptar) {
      const otro = await env.DB.prepare(`SELECT nombre FROM socios WHERE email = ? AND id != ?`).bind(sug.email, socioId).first<{ nombre: string }>();
      if (otro) return json({ error: `Ese email ya es de ${otro.nombre}` }, 409);
      await env.DB.prepare(`UPDATE socios SET email = ?, actualizado = datetime('now') WHERE id = ?`).bind(sug.email, socioId).run();
    }
    await env.DB.prepare(`DELETE FROM sugerencias_email WHERE socio_id = ?`).bind(socioId).run();
    return json({ ok: true, aplicado: !!body.aceptar });
  }

  return json({ error: 'Vista desconocida' }, 404);
};
