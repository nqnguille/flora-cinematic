// El embudo de LEADS — prospectos con seguimiento hasta convertirse en socio.
//   GET   /api/panel/leads            → espeja KV (solicitudes+intentos) y devuelve el tablero
//   POST  /api/panel/leads            → lead manual {nombre, telefono?, email?, nota?}
//   PATCH /api/panel/leads            → {id, etapa? | nota? | telefono? | nombre?}
//
// Espejo: las solicitudes web y los intentos de login viven en KV (el flujo
// público no cambia); acá se copian como leads 'nuevo' una sola vez por email
// (INSERT OR IGNORE). Convertir = dar de alta al socio: el alta unificada
// marca el lead como convertido sola (ver alta.ts).
import { requireCap } from './_rol';

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

// El corazón del GET, exportado para que el kanban de Inicio arme su columna
// de leads con EXACTAMENTE la misma data (espejo KV→D1 incluido) sin
// duplicar lógica. El caller pone su propio guard de capacidades.
export async function tableroLeads(env: Env): Promise<Record<string, unknown>[]> {
  // Los binarios `archivo:<email>` conviven con los registros JSON en
  // SOLICITUDES: no son leads, pero sí prueban que ese email adjuntó su
  // credencial (los aspirantes suben el PDF sin pasar por la solicitud web).
  const archivos = new Set<string>();
  // Lo que el modo aspirante enriqueció en INTENTOS (teléfono + lectura del
  // REPROCANN) vive solo en KV: se superpone a las filas al final, sin
  // volcarlo a D1 (la fuente de esos datos sigue siendo el KV).
  const extras = new Map<string, Record<string, unknown>>();

  // 1) espejo de las solicitudes web
  try {
    const sol = await env.SOLICITUDES.list({ limit: 500 });
    for (const k of sol.keys) {
      if (k.name.startsWith('archivo:')) { archivos.add(k.name.slice('archivo:'.length)); continue; }
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
      // los campos que suma el modo aspirante (aspirante.ts), si existen
      if (crudo.aspirante || crudo.telefono || crudo.reprocann || crudo.reprocannLeido) {
        extras.set(k.name.toLowerCase(), {
          aspirante: crudo.aspirante === true,
          telefono: crudo.telefono ? String(crudo.telefono) : null,
          reprocann: crudo.reprocann && typeof crudo.reprocann === 'object' ? crudo.reprocann : null,
          reprocannLeido: crudo.reprocannLeido || null,
        });
      }
      await env.DB.prepare(
        `INSERT OR IGNORE INTO leads (nombre, email, telefono, origen, creado)
         VALUES (?, ?, ?, 'intento', COALESCE(?, datetime('now')))`,
      ).bind(
        String(crudo.name || '') || null, k.name, String(crudo.telefono || '') || null,
        crudo.firstAttempt ? String(crudo.firstAttempt).replace('T', ' ').slice(0, 19) : null,
      ).run();
    }
  } catch { /* ídem */ }

  // 3) los que ya son socios del padrón se auto-convierten (llegaron por afuera)
  await env.DB.prepare(
    `UPDATE leads SET etapa = 'convertido', socio_id = (SELECT id FROM socios WHERE socios.email = leads.email),
            actualizado = datetime('now')
      WHERE etapa NOT IN ('convertido', 'perdido') AND email IS NOT NULL
        AND EXISTS (SELECT 1 FROM socios WHERE socios.email = leads.email AND (socios.numero IS NULL OR socios.numero != -1) AND socios.papelera IS NULL)`,
  ).run();

  const rows = await env.DB.prepare(
    `SELECT * FROM leads ORDER BY CASE etapa WHEN 'nuevo' THEN 0 WHEN 'contactado' THEN 1
       WHEN 'entrevista' THEN 2 WHEN 'convertido' THEN 3 ELSE 4 END, etapa_desde DESC`,
  ).all();
  // Superposición de lo que vive en KV sobre cada fila: el teléfono si la
  // fila no tenía, la lectura del REPROCANN del aspirante y si hay archivo
  // adjunto (el botón «Convertir» del tablero se habilita con esto).
  const leads = (rows.results as Record<string, unknown>[]).map((l) => {
    const email = String(l.email || '').toLowerCase();
    const ex = email ? extras.get(email) : undefined;
    const conArchivo = email ? archivos.has(email) : false;
    if (!ex && !conArchivo) return l;
    return {
      ...l,
      telefono: l.telefono || (ex ? ex.telefono : null) || null,
      aspirante: ex ? ex.aspirante === true : false,
      reprocann: ex ? ex.reprocann : null,
      reprocannLeido: ex ? ex.reprocannLeido : null,
      tiene_adjunto: l.tiene_adjunto || (conArchivo ? 1 : 0),
    };
  });
  return leads;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'leads_ver');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  return json({ ok: true, leads: await tableroLeads(env) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'leads_gestionar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
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
  const auth = await requireCap(request, env, 'leads_gestionar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
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
  // pasar a frío / revivir (kanban de Inicio, migración 0030): true lo duerme
  // (queda cuándo y quién), false lo revive — mismo patrón que el frío de socios
  if ('frio' in b) {
    const dar = b.frio === true;
    cambios.push('frio = ?'); vals.push(dar ? new Date().toISOString() : null);
    cambios.push('frio_por = ?'); vals.push(dar ? auth.email || null : null);
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

// Borrado definitivo de un lead basura o de prueba.
//
// Ojo con el espejo: los leads de la web se re-crean solos desde KV en cada
// carga del tablero (ver GET, "INSERT OR IGNORE"). Si solo se borra la fila,
// el lead reaparece al recargar. Por eso acá se limpian las tres puntas: la
// fila, el registro de origen en KV y el adjunto que hubiera subido.
//
// No es la papelera de socios: un lead basura no tiene nada que conservar, y
// para el que existía pero no cerró ya está la etapa 'perdido'.
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'leads_gestionar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);

  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const id = Number(b.id);
  if (!Number.isFinite(id)) return json({ error: 'Falta id' }, 400);

  const lead = await env.DB.prepare(`SELECT id, email, etapa FROM leads WHERE id = ?`)
    .bind(id).first<{ id: number; email: string | null; etapa: string }>();
  if (!lead) return json({ error: 'El lead no existe' }, 404);
  // Un convertido ya tiene ficha de socio. Borrar el lead NO la toca: solo se
  // pierde el rastro de por dónde entró esa persona. Igual pedimos `forzar`
  // para que nadie lo haga de casualidad desde otro cliente.
  if (lead.etapa === 'convertido' && b.forzar !== true) {
    return json({ error: 'Ese lead ya es paciente: confirmá que querés borrar igual el rastro del embudo.' }, 409);
  }

  await env.DB.prepare(`DELETE FROM leads WHERE id = ?`).bind(id).run();

  // el origen, para que el espejo no lo resucite
  if (lead.email) {
    const mail = String(lead.email).toLowerCase();
    await env.SOLICITUDES.delete(mail).catch(() => { /* puede no existir */ });
    await env.SOLICITUDES.delete(`archivo:${mail}`).catch(() => { /* idem */ });
    await env.INTENTOS.delete(mail).catch(() => { /* idem */ });
  }
  return json({ ok: true });
};
