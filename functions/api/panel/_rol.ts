// Guard de ROLES del panel nuevo (finanzas + operación diaria). Independiente
// del guard viejo de functions/api/socios/admin/_guard.ts (ADMIN_EMAILS /
// SUPER_ADMIN_EMAILS por env var, gestiona quién ve la carta de socios) — acá
// los roles viven en D1 (tabla `accesos`), no en env vars, porque son varios
// roles con permisos distintos, no un simple admin/no-admin.
import { readSessionEmail } from '../socios/_session';

export type Rol = 'dueno' | 'socio_ong' | 'socio_ong_carga' | 'mostrador';

const ROLES_VALIDOS: Rol[] = ['dueno', 'socio_ong', 'socio_ong_carga', 'mostrador'];

export function esRolValido(v: unknown): v is Rol {
  return typeof v === 'string' && (ROLES_VALIDOS as string[]).includes(v);
}

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

function emailList(v?: string): string[] {
  return (v || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// Semántica de cada rol:
// - dueno: ve y hace todo (Guille).
// - socio_ong: lectura de todo Finanzas SALVO sueldos/personal.
// - socio_ong_carga: lo mismo que socio_ong + puede cargar movimientos,
//   que nacen en estado `pendiente_aprobacion` (los aprueba el dueño).
// - mostrador: carga dispensas y cobros del día; NO ve balances, movimientos,
//   egresos, aportes ni personal — solo opera el día a día del mostrador.

// Matriz de permisos: capacidad -> roles que la tienen.
export const PERMISOS: Record<string, Rol[]> = {
  finanzas_ver: ['dueno', 'socio_ong', 'socio_ong_carga'],
  finanzas_cargar: ['dueno', 'socio_ong_carga'],
  finanzas_aprobar: ['dueno'],
  personal_ver: ['dueno'],
  aportes_ver: ['dueno', 'socio_ong', 'socio_ong_carga'],
  mostrador_operar: ['dueno', 'mostrador'],
  padron_ver: ['dueno', 'socio_ong', 'socio_ong_carga', 'mostrador'],
  padron_editar: ['dueno'],
  catalogo_editar: ['dueno'],
  reservas_operar: ['dueno', 'mostrador'],
  accesos_gestionar: ['dueno'],
};

export function puede(rol: Rol, cap: string): boolean {
  return (PERMISOS[cap] || []).includes(rol);
}

// Busca el rol de un email ya conocido (sesión válida): primero el fallback
// de super admin, después la tabla `accesos`. Devuelve null si no tiene rol
// asignado en ningún lado.
async function buscarRol(email: string, env: Env): Promise<Rol | null> {
  if (emailList(env.SUPER_ADMIN_EMAILS).includes(email)) return 'dueno';

  const row = await env.DB.prepare('SELECT rol FROM accesos WHERE email = ?')
    .bind(email)
    .first<{ rol: string }>();
  if (!row || !esRolValido(row.rol)) return null;
  return row.rol;
}

// Resuelve el email de la sesión y su rol. FALLBACK de seguridad: si el
// email figura en SUPER_ADMIN_EMAILS, es `dueno` aunque no esté (todavía, o
// nunca) en la tabla `accesos` — así Guille nunca queda afuera del panel
// aunque se rompa o se vacíe la tabla. Devuelve null tanto si no hay sesión
// como si la sesión no tiene rol asignado — para distinguir 401 de 403 usar
// requireRol().
export async function rolDe(request: Request, env: Env): Promise<{ email: string; rol: Rol } | null> {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return null;
  const emailLower = email.toLowerCase();

  const rol = await buscarRol(emailLower, env);
  if (!rol) return null;

  return { email: emailLower, rol };
}

// Mismo shape de respuesta que el guard viejo (AdminCheck) para consistencia
// entre panel viejo y nuevo. Distingue 401 (sin sesión) de 403 (con sesión
// pero sin rol asignado o rol no habilitado para esta capacidad).
export type RolCheck =
  | { status: 401 }
  | { status: 403 }
  | { status: 200; email: string; rol: Rol };

export async function requireRol(request: Request, env: Env, permitidos: Rol[]): Promise<RolCheck> {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return { status: 401 };
  const emailLower = email.toLowerCase();

  const rol = await buscarRol(emailLower, env);
  if (!rol) return { status: 403 };
  if (!permitidos.includes(rol)) return { status: 403 };

  return { status: 200, email: emailLower, rol };
}
