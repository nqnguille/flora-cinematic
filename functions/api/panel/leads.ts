// El embudo de LEADS — prospectos con seguimiento hasta convertirse en socio.
//   GET   /api/panel/leads            → espeja KV (solicitudes+intentos) y devuelve el tablero
//   POST  /api/panel/leads            → lead manual {nombre, telefono?, email?, nota?}
//   PATCH /api/panel/leads            → {id, etapa? | nota? | telefono? | nombre?}
//
// Espejo: las solicitudes web y los intentos de login viven en KV (el flujo
// público no cambia); acá se copian como leads 'nuevo' una sola vez por email
// (INSERT OR IGNORE). Convertir = dar de alta al socio: el alta unificada
// marca el lead como convertido sola (ver alta.ts).
import { requireRol, puede } from './_rol';

interface Env {
  DB: D1Database;
  SOLICITUDES: KVNamespace;
  INTENTOS: KVNamespace;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

const ETAPAS = ['nuevo', 'contactado', 'entrevista', 'convertido', 'perdido'];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireRol(request, env, ['dueno', 'socio_ong', 'socio_ong_carga']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  if (!puede(auth.rol, 'padron_ver')) return json({ error: 'Sin permiso' }, 403);

  // 1) espejo de las solicitudes web
  try {
    const sol = await env.SOLICITUDES.list({ limit: 500 });
    for (const k of sol.keys) {
      const crudo = await env.SOLICITUDES.get(k.name, 'json') as Record<string, unknown> | null;
      if (!crudo) continue;
      await env.DB.prepare(
        `INSERT OR IGNORE INTO leads (nombre, email, telefono, origen, intent, tiene_adjunto, creado)
         VALUES (?, ?, ?, 'solicitud_web', ?, ?, COALESCE(?, datetime('now')))`,
      ).bind(
        String(crudo.name || '') || null, k.name, String(crudo.phone || '') || null,
        String(crudo.intent || 'acceso'), crudo.tieneAdjunto ? 1 : 0,
        crudo.creado ? String(crudo.creado).replace('T', ' ').slice(0, 19) : null,
      ).run();
    }
  } catch { /* sin KV el tablero sale igual */ }
  // 2) espejo de los intentos de login
  try {
    const intentos = await env.INTENTOS.list({ limit: 500 });
    for (const k of intentos.keys) {
      const crudo = await env.INTENTOS.get(k.name, 'json') as Record<string, unknown> | null;
      if (!crudo) continue;
      await env.DB.prepare(
        `INSERT OR IGNORE INTO leads (nombre, email, origen, creado)
         VALUES (?, ?, 'intento', COALESCE(?, datetime('now')))`,
      ).bind(
        String(crudo.name || '') || null, k.name,
        crudo.firstAttempt ? String(crudo.firstAttempt).replace('T', ' ').slice(0, 19) : null,
      ).run();
    }
  } catch { /* ídem */ }

  // 3) los que ya son socios del padrón se auto-convierten (llegaron por afuera)
  await env.DB.prepare(
    `UPDATE leads SET etapa = 'convertido', socio_id = (SELECT id FROM socios WHERE socios.email = leads.email),
            actualizado = datetime('now')
      WHERE etapa NOT IN ('convertido', 'perdido') AND email IS NOT NULL
        AND EXISTS (SELECT 1 FROM socios WHERE socios.email = leads.email AND (socios.numero IS NULL OR socios.numero != -1))`,
  ).run();

  const rows = await env.DB.prepare(
    `SELECT * FROM leads ORDER BY CASE etapa WHEN 'nuevo' THEN 0 WHEN 'contactado' THEN 1
       WHEN 'entrevista' THEN 2 WHEN 'convertido' THEN 3 ELSE 4 END, etapa_desde DESC`,
  ).all();
  return json({ ok: true, leads: rows.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireRol(request, env, ['dueno']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  if (!puede(auth.rol, 'padron_editar')) return json({ error: 'Sin permiso' }, 403);
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const nombre = String(b.nombre || '').trim().slice(0, 120);
  if (!nombre) return json({ error: 'Falta el nombre' }, 400);
  const email = String(b.email || '').trim().toLowerCase() || null;
  if (email) {
    const ya = await env.DB.prepare(`SELECT id FROM leads WHERE email = ?`).bind(email).first();
    if (ya) return json({ error: 'Ya hay un lead con ese email' }, 409);
  }
  const r = await env.DB.prepare(
    `INSERT INTO leads (nombre, email, telefono, origen, nota) VALUES (?, ?, ?, 'manual', ?)`,
  ).bind(nombre, email, String(b.telefono || '').trim().slice(0, 30) || null, String(b.nota || '').trim().slice(0, 300) || null).run();
  return json({ ok: true, id: Number(r.meta.last_row_id) });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireRol(request, env, ['dueno']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  if (!puede(auth.rol, 'padron_editar')) return json({ error: 'Sin permiso' }, 403);
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const id = Number(b.id);
  if (!Number.isFinite(id)) return json({ error: 'Falta id' }, 400);

  const cambios: string[] = [];
  const vals: (string | null)[] = [];
  if ('etapa' in b) {
    const e = String(b.etapa);
    if (!ETAPAS.includes(e)) return json({ error: 'Etapa inválida' }, 400);
    cambios.push(`etapa = ?`);
    vals.push(e);
  }
  for (const campo of ['nota', 'telefono', 'nombre']) {
    if (campo in b) { cambios.push(`${campo} = ?`); vals.push(String(b[campo] || '').trim().slice(0, 300) || null); }
  }
  if (!cambios.length) return json({ error: 'Nada para cambiar' }, 400);
  const extraEtapa = 'etapa' in b ? ", etapa_desde = datetime('now')" : '';
  await env.DB.prepare(
    `UPDATE leads SET ${cambios.join(', ')}${extraEtapa}, actualizado = datetime('now') WHERE id = ?`,
  ).bind(...vals, id).run();
  return json({ ok: true });
};
