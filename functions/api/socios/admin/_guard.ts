import { readSessionEmail } from '../_session';

interface Env {
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
  SUPER_ADMIN_EMAILS?: string;
}

export type AdminCheck = { status: 401 } | { status: 403 } | { status: 200; email: string };

function emailList(v?: string): string[] {
  return (v || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isSuperAdmin(email: string, env: Env): boolean {
  return emailList(env.SUPER_ADMIN_EMAILS).includes(email.toLowerCase());
}

// Admin: puede gestionar catálogo y fotos. Los super admin también cuentan como admin.
export async function requireAdmin(request: Request, env: Env): Promise<AdminCheck> {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return { status: 401 };

  const admins = emailList(env.ADMIN_EMAILS);
  if (!admins.includes(email.toLowerCase()) && !isSuperAdmin(email, env)) return { status: 403 };

  return { status: 200, email };
}

// Super admin: además puede gestionar socios (quién accede a la carta).
export async function requireSuperAdmin(request: Request, env: Env): Promise<AdminCheck> {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return { status: 401 };
  if (!isSuperAdmin(email, env)) return { status: 403 };
  return { status: 200, email };
}
