// Endpoint que el shell del panel llama al arrancar: quién soy y qué puedo
// hacer. 401 si no hay sesión (no logueado con Google), 403 si está logueado
// pero no tiene rol asignado en `accesos` (ni fallback de super admin).
import { requireRol, PERMISOS } from './_rol';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

const TODOS_LOS_ROLES = ['dueno', 'socio_ong', 'socio_ong_carga', 'mostrador'] as const;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const check = await requireRol(request, env, [...TODOS_LOS_ROLES]);
  if (check.status !== 200) {
    return Response.json(
      { ok: false, error: check.status === 401 ? 'no autenticado' : 'sin rol asignado en el panel' },
      { status: check.status }
    );
  }

  const capacidades = Object.entries(PERMISOS)
    .filter(([, roles]) => roles.includes(check.rol))
    .map(([cap]) => cap);

  return Response.json({ ok: true, email: check.email, rol: check.rol, capacidades });
};
