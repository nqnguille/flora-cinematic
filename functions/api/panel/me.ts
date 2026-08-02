// Endpoint que el shell del panel llama al arrancar: quién soy y qué puedo
// hacer. 401 si no hay sesión (no logueado con Google), 403 si está logueado
// pero no tiene rol asignado en `accesos` (ni fallback de super admin).
import { requireRolAsignado, PERMISOS, ROLES_META } from './_rol';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const check = await requireRolAsignado(request, env);
  if (check.status !== 200) {
    return Response.json(
      { ok: false, error: check.status === 401 ? 'no autenticado' : 'sin rol asignado en el panel' },
      { status: check.status }
    );
  }

  const capacidades = Object.entries(PERMISOS)
    .filter(([, roles]) => roles.includes(check.rol))
    .map(([cap]) => cap);

  const meta = ROLES_META.find((r) => r.rol === check.rol);

  return Response.json({
    ok: true,
    email: check.email,
    rol: check.rol,
    etiqueta: meta?.etiqueta || check.rol,
    capacidades,
  });
};
