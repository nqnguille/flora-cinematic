// Padrón financiero — las fichas de los socios (D1, hoja Pacientes migrada):
//   GET   /api/panel/padron/lista        → todos con membresía vigente y sugerencias de email
//   PATCH /api/panel/padron/socio        → {id, email?, telefono?, nota?, estado?}
//   POST  /api/panel/padron/membresia    → {socio_id, tier} asigna membresía vigente
//   POST  /api/panel/padron/sugerencia   → {socio_id, aceptar: true|false}
// Editar exige padron_editar (presidente); ver alcanza con padron_ver.
import { requireRol, puede } from '../_rol';

interface Env {
  DB: D1Database;
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

  if (vista === 'lista') {
    const [socios, sug] = await Promise.all([
      env.DB.prepare(
        `SELECT s.id, s.numero, s.nombre, s.email, s.telefono, s.estado, s.reprocann, s.nota,
                m.tier, m.modalidad, m.gramos_mes,
                (SELECT MAX(fecha) FROM movimientos mv WHERE mv.socio_id = s.id AND mv.tipo = 'ingreso'
                  AND mv.categoria = 'membresia') AS ultimo_pago,
                (SELECT MAX(fecha) FROM dispensas d WHERE d.socio_id = s.id) AS ultimo_retiro
           FROM socios s
           LEFT JOIN membresias m ON m.socio_id = s.id AND m.hasta IS NULL
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
