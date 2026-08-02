// Gestión de accesos al panel (quién tiene qué rol) — capacidad
// accesos_gestionar (hoy: solo el presidente). El GET además devuelve el
// catálogo de roles (etiqueta + descripción) para que el front no lo duplique.
//
// Protecciones:
//  - no se puede borrar ni degradar al ÚLTIMO dueño de la tabla
//  - nadie puede cambiarse el rol ni quitarse el acceso a sí mismo
import { requireCap, esRolValido, ROLES_META, type Rol, type RolCheck } from './_rol';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function guard(request: Request, env: Env): Promise<{ denied: Response | null; auth?: RolCheck & { status: 200 } }> {
  const check = await requireCap(request, env, 'accesos_gestionar');
  if (check.status !== 200) {
    return {
      denied: Response.json(
        { ok: false, error: check.status === 401 ? 'no autenticado' : 'solo el presidente puede gestionar accesos' },
        { status: check.status }
      ),
    };
  }
  return { denied: null, auth: check };
}

async function contarDuenos(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM accesos WHERE rol = 'dueno'").first<{ n: number }>();
  return row?.n ?? 0;
}

// Lista todos los accesos + catálogo de roles.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { denied } = await guard(request, env);
  if (denied) return denied;

  const { results } = await env.DB.prepare(
    'SELECT email, nombre, rol, creado FROM accesos ORDER BY email'
  ).all();

  return Response.json({ ok: true, accesos: results, roles: ROLES_META });
};

// Alta / edición de un acceso.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { denied, auth } = await guard(request, env);
  if (denied || !auth) return denied!;

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

  const existente = await env.DB.prepare('SELECT rol FROM accesos WHERE email = ?')
    .bind(email)
    .first<{ rol: string }>();

  // nadie se cambia el rol a sí mismo (evita degradarse por accidente)
  if (email === auth.email && existente && existente.rol !== rol) {
    return Response.json({ ok: false, error: 'no podés cambiarte tu propio rol' }, { status: 400 });
  }

  // no degradar al último dueño: el panel no puede quedar sin presidente
  if (existente?.rol === 'dueno' && rol !== 'dueno' && (await contarDuenos(env)) <= 1) {
    return Response.json({ ok: false, error: 'no se puede degradar al último presidente del panel' }, { status: 400 });
  }

  // UPSERT: si ya existe el email, actualiza nombre y rol; si no, lo crea.
  await env.DB.prepare(
    `INSERT INTO accesos (email, nombre, rol) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET nombre = excluded.nombre, rol = excluded.rol`
  )
    .bind(email, nombre, rol as Rol)
    .run();

  return Response.json({ ok: true, email, nombre, rol });
};

// Baja de un acceso.
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const { denied, auth } = await guard(request, env);
  if (denied || !auth) return denied!;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }

  const email = String(body?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ ok: false, error: 'falta email' }, { status: 400 });

  if (email === auth.email) {
    return Response.json({ ok: false, error: 'no podés quitarte el acceso a vos mismo' }, { status: 400 });
  }

  const objetivo = await env.DB.prepare('SELECT rol FROM accesos WHERE email = ?')
    .bind(email)
    .first<{ rol: string }>();

  if (objetivo?.rol === 'dueno' && (await contarDuenos(env)) <= 1) {
    return Response.json(
      { ok: false, error: 'no se puede borrar al último dueño del panel' },
      { status: 400 }
    );
  }

  await env.DB.prepare('DELETE FROM accesos WHERE email = ?').bind(email).run();
  return Response.json({ ok: true });
};
