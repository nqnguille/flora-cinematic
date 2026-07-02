import { readSessionEmail } from '../_session';

interface Env {
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
}

export type AdminCheck = { status: 401 } | { status: 403 } | { status: 200; email: string };

export async function requireAdmin(request: Request, env: Env): Promise<AdminCheck> {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return { status: 401 };

  const admins = env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!admins.includes(email.toLowerCase())) return { status: 403 };

  return { status: 200, email };
}
