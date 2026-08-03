// Guard de ROLES del panel (floraong.ar/admin). Una sola fuente de verdad:
// la tabla D1 `accesos` (+ fallback SUPER_ADMIN_EMAILS para que Guille nunca
// quede afuera). Desde Roles v2 acá también se cuelgan los endpoints viejos
// de /api/socios/admin/* — el guard por env vars (_guard.ts) ya no existe.
//
// Regla de oro para endpoints: chequear CAPACIDADES (requireCap), nunca
// listas de roles. Así agregar un rol nuevo es tocar solo la matriz PERMISOS.
import { readSessionEmail } from '../socios/_session';

export type Rol = 'dueno' | 'operacion' | 'socio_proyecto' | 'medico' | 'mostrador' | 'tesorero';

const ROLES_VALIDOS: Rol[] = ['dueno', 'operacion', 'socio_proyecto', 'medico', 'mostrador', 'tesorero'];

// Roles previos a la migración 0020 que pueden sobrevivir en alguna fila
// vieja: se leen como su equivalente nuevo, nunca se escriben.
const ROLES_LEGADO: Record<string, Rol> = {
  socio_ong: 'socio_proyecto',
  socio_ong_carga: 'socio_proyecto',
};

export function esRolValido(v: unknown): v is Rol {
  return typeof v === 'string' && (ROLES_VALIDOS as string[]).includes(v);
}

// Catálogo para el front (Ajustes y el chip de identidad): etiqueta humana
// y descripción de cada rol, en el orden en que se ofrecen.
export const ROLES_META: { rol: Rol; etiqueta: string; descripcion: string }[] = [
  { rol: 'dueno', etiqueta: 'Presidente', descripcion: 'Ve y hace todo: aprueba movimientos, ve sueldos y aportes, gestiona accesos' },
  { rol: 'operacion', etiqueta: 'Operación', descripcion: 'Maneja el día a día completo: socios, REPROCANN, leads, links de pago, carta, catálogo, mostrador y carga de gastos. Sin sueldos, sin aportes y sin visto bueno' },
  { rol: 'socio_proyecto', etiqueta: 'Socio del proyecto', descripcion: 'Ve todo el proyecto (finanzas, aportes, socios, leads — sueldos tapados) y puede cargar gastos, que esperan el visto bueno del presidente' },
  { rol: 'medico', etiqueta: 'Médico', descripcion: 'Ve el padrón y gestiona REPROCANN. Sin finanzas' },
  { rol: 'mostrador', etiqueta: 'Mostrador', descripcion: 'Carga retiros, cobros y reservas del día. Sin balances' },
  { rol: 'tesorero', etiqueta: 'Tesorero', descripcion: 'Ve y carga finanzas y aportes. Sin padrón ni operación diaria' },
];

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

function emailList(v?: string): string[] {
  return (v || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// Matriz de permisos: capacidad -> roles que la tienen. ÚNICO lugar a tocar
// cuando cambia qué puede cada rol.
export const PERMISOS: Record<string, Rol[]> = {
  // padrón y ficha 360°
  padron_ver: ['dueno', 'operacion', 'socio_proyecto', 'medico', 'mostrador'],
  padron_editar: ['dueno', 'operacion'],
  reprocann_editar: ['dueno', 'operacion', 'medico'],
  leads_ver: ['dueno', 'operacion', 'socio_proyecto'],
  leads_gestionar: ['dueno', 'operacion'],
  papelera_gestionar: ['dueno', 'operacion'],
  papelera_purgar: ['dueno'],
  // carta de socios (KV SOCIOS: quién entra a /socios/carta, solicitudes, adjuntos)
  carta_gestionar: ['dueno', 'operacion'],
  // plantillas de los avisos al socio (reservas): editar textos
  avisos_editar: ['dueno', 'operacion'],
  // operación diaria
  catalogo_editar: ['dueno', 'operacion'],
  reservas_operar: ['dueno', 'operacion', 'mostrador'],
  mostrador_operar: ['dueno', 'operacion', 'mostrador'],
  // Mercado Pago (débito automático)
  mp_enviar: ['dueno', 'operacion'],
  mp_gestionar: ['dueno', 'operacion'],
  // finanzas
  finanzas_ver: ['dueno', 'operacion', 'socio_proyecto', 'tesorero'],
  finanzas_cargar: ['dueno', 'operacion', 'socio_proyecto', 'tesorero'],
  finanzas_aprobar: ['dueno'],
  aportes_ver: ['dueno', 'socio_proyecto', 'tesorero'],
  personal_ver: ['dueno'],
  // administración del panel
  accesos_gestionar: ['dueno'],
};

export function puede(rol: Rol, cap: string): boolean {
  return (PERMISOS[cap] || []).includes(rol);
}

// Busca el rol de un email ya conocido (sesión válida): primero el fallback
// de super admin, después la tabla `accesos`. Devuelve null si no tiene rol.
async function buscarRol(email: string, env: Env): Promise<Rol | null> {
  if (emailList(env.SUPER_ADMIN_EMAILS).includes(email)) return 'dueno';

  const row = await env.DB.prepare('SELECT rol FROM accesos WHERE email = ?')
    .bind(email)
    .first<{ rol: string }>();
  if (!row) return null;
  if (esRolValido(row.rol)) return row.rol;
  return ROLES_LEGADO[row.rol] || null;
}

// Resuelve el email de la sesión y su rol. FALLBACK de seguridad: si el
// email figura en SUPER_ADMIN_EMAILS, es `dueno` aunque no esté (todavía, o
// nunca) en la tabla `accesos` — así Guille nunca queda afuera del panel
// aunque se rompa o se vacíe la tabla.
export async function rolDe(request: Request, env: Env): Promise<{ email: string; rol: Rol } | null> {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return null;
  const emailLower = email.toLowerCase();

  const rol = await buscarRol(emailLower, env);
  if (!rol) return null;

  return { email: emailLower, rol };
}

export type RolCheck =
  | { status: 401 }
  | { status: 403 }
  | { status: 200; email: string; rol: Rol };

// Guard por CAPACIDAD (el estándar): pasa si el rol de la sesión tiene
// alguna de las capacidades pedidas. Distingue 401 (sin sesión) de 403
// (con sesión pero sin permiso).
export async function requireCap(request: Request, env: Env, cap: string | string[]): Promise<RolCheck> {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return { status: 401 };
  const emailLower = email.toLowerCase();

  const rol = await buscarRol(emailLower, env);
  if (!rol) return { status: 403 };

  const caps = Array.isArray(cap) ? cap : [cap];
  if (!caps.some((c) => puede(rol, c))) return { status: 403 };

  return { status: 200, email: emailLower, rol };
}

// Guard "cualquier rol del panel": para endpoints como Inicio o /me donde
// alcanza con tener un rol asignado; qué datos viajan se decide adentro
// con puede().
export async function requireRolAsignado(request: Request, env: Env): Promise<RolCheck> {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return { status: 401 };
  const emailLower = email.toLowerCase();

  const rol = await buscarRol(emailLower, env);
  if (!rol) return { status: 403 };

  return { status: 200, email: emailLower, rol };
}
