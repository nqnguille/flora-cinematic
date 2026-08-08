// Panel de notificaciones: qué avisos existen, cuáles están prendidos, con
// qué texto salen y qué se mandó.
//
//   GET                          → catálogo + resumen de lo enviado + últimos envíos
//   PATCH {clave, ...campos}     → prender/apagar y editar textos, días y tope
//   POST  {clave, prueba: true}  → me lo mando a mí para verlo antes de prenderlo
import { requireCap } from './_rol';
import { notificar, leerEvento, interpolar, enviarMail } from '../_notif';

interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'avisos_editar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);

  const [eventos, resumen, ultimos, push] = await Promise.all([
    env.DB.prepare(`SELECT * FROM notif_eventos ORDER BY familia, nombre`).all(),
    env.DB.prepare(
      `SELECT evento, canal, estado, COUNT(*) AS n FROM notif_envios
        WHERE creado >= datetime('now', '-30 days') GROUP BY evento, canal, estado`,
    ).all(),
    env.DB.prepare(
      `SELECT e.id, e.evento, e.canal, e.estado, e.motivo, e.creado, e.enviado, s.nombre
         FROM notif_envios e LEFT JOIN socios s ON s.id = e.socio_id
        ORDER BY e.id DESC LIMIT 40`,
    ).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM push_subs WHERE baja IS NULL`).first<{ n: number }>(),
  ]);

  return json({
    ok: true,
    eventos: eventos.results,
    resumen: resumen.results,
    ultimos: ultimos.results,
    push_activos: push?.n || 0,
  });
};

const EDITABLES = ['activo', 'dias_antes', 'tope_diario', 'asunto', 'cuerpo', 'push_titulo', 'push_texto', 'def_push', 'def_mail', 'canales'];

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'avisos_editar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);

  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const clave = String(b.clave || '');
  if (!clave) return json({ error: 'Falta la clave del aviso' }, 400);

  const ev = await leerEvento(env, clave);
  if (!ev) return json({ error: 'Ese aviso no existe' }, 404);

  const campos: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const c of EDITABLES) {
    if (!(c in b)) continue;
    if (c === 'activo' || c === 'def_push' || c === 'def_mail') { campos.push(`${c} = ?`); vals.push(b[c] ? 1 : 0); continue; }
    if (c === 'dias_antes' || c === 'tope_diario') {
      const n = Number(b[c]);
      if (!Number.isFinite(n) || n < 0) return json({ error: `${c} tiene que ser un número` }, 400);
      campos.push(`${c} = ?`); vals.push(Math.round(n)); continue;
    }
    campos.push(`${c} = ?`); vals.push(String(b[c] || '').slice(0, 2000) || null);
  }
  if (!campos.length) return json({ error: 'Nada para cambiar' }, 400);

  await env.DB.prepare(
    `UPDATE notif_eventos SET ${campos.join(', ')}, actualizado = datetime('now') WHERE clave = ?`,
  ).bind(...vals, clave).run();
  return json({ ok: true });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'avisos_editar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);

  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const clave = String(b.clave || '');
  const ev = await leerEvento(env, clave);
  if (!ev) return json({ error: 'Ese aviso no existe' }, 404);

  // Probarlo antes de prenderlo: sale a MI casilla, con datos de ejemplo, y
  // no toca el registro de envíos ni le llega a ningún socio.
  const vars = {
    nombre: 'Ejemplo', vence: '15/09/2026', paso: 'aceptar el consentimiento en Mi Argentina',
    items: '20 g de flores', monto: '$ 250.000', genetica: 'Q3',
  };
  const asunto = '[prueba] ' + interpolar(ev.asunto || ev.nombre, vars);
  const cuerpo = interpolar(ev.cuerpo || '', vars)
    + '\n\n—\nEsto es una prueba que pediste desde el panel. Los pacientes no la recibieron.';
  const r = await enviarMail(env, auth.email, asunto, cuerpo);
  return r.ok ? json({ ok: true, a: auth.email }) : json({ error: r.motivo || 'no se pudo mandar' }, 502);
};
