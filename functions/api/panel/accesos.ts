// Gestión de accesos al panel nuevo (quién tiene qué rol) — solo `dueno`.
// Análogo a socios/admin/socios.ts pero para roles en D1 en vez de socios en KV.
import { requireRol, esRolValido, type Rol } from './_rol';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function guard(request: Request, env: Env) {
  const check = await requireRol(request, env, ['dueno']);
  if (check.status !== 200) {
    return Response.json(
      { ok: false, error: check.status === 401 ? 'no autenticado' : 'solo el dueño puede gestionar accesos' },
      { status: check.status }
    );
  }
  return null;
}

// Lista todos los accesos.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  const { results } = await env.DB.prepare(
    'SELECT email, nombre, rol, creado FROM accesos ORDER BY email'
  ).all();

  return Response.json({ ok: true, accesos: results });
};

// Alta / edición de un acceso.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }

  const email = String(body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: 'email inválido' }, { status: 400 });
  }

  const rol = body?.rol;
  if (!esRolValido(rol)) {
    return Response.json({ ok: false, error: 'rol inválido' }, { status: 400 });
  }

  const nombre = body?.nombre != null ? String(body.nombre).trim().slice(0, 120) : null;

  // UPSERT: si ya existe el email, actualiza nombre y rol; si no, lo crea.
  await env.DB.prepare(
    `INSERT INTO accesos (email, nombre, rol) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET nombre = excluded.nombre, rol = excluded.rol`
  )
    .bind(email, nombre, rol as Rol)
    .run();

  return Response.json({ ok: true, email, nombre, rol });
};

// Baja de un acceso. No se permite borrar al último `dueno` de la tabla —
// para no dejar el panel sin nadie que pueda gestionarlo (el fallback de
// SUPER_ADMIN_EMAILS existe, pero no reemplaza tener al menos un dueño real
// en la tabla de accesos).
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }

  const email = String(body?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ ok: false, error: 'falta email' }, { status: 400 });

  const objetivo = await env.DB.prepare('SELECT rol FROM accesos WHERE email = ?')
    .bind(email)
    .first<{ rol: string }>();

  if (objetivo?.rol === 'dueno') {
    const { results } = await env.DB.prepare("SELECT COUNT(*) as n FROM accesos WHERE rol = 'dueno'").all<{ n: number }>();
    const cantidadDuenos = results?.[0]?.n ?? 0;
    if (cantidadDuenos <= 1) {
      return Response.json(
        { ok: false, error: 'no se puede borrar al último dueño del panel' },
        { status: 400 }
      );
    }
  }

  await env.DB.prepare('DELETE FROM accesos WHERE email = ?').bind(email).run();
  return Response.json({ ok: true });
};
