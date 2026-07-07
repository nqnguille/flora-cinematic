import { requireSuperAdmin } from './_guard';

interface Env {
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
  SUPER_ADMIN_EMAILS?: string;
  INTENTOS: KVNamespace;
}

async function guard(request: Request, env: Env) {
  const check = await requireSuperAdmin(request, env);
  if (check.status !== 200) {
    return Response.json(
      { ok: false, error: check.status === 401 ? 'no autenticado' : 'solo el super admin puede ver los intentos' },
      { status: check.status }
    );
  }
  return null;
}

// Gmails que intentaron entrar a la carta y no están en la lista de socios —
// se capturan en login.ts. Sirve como padrón de leads para invitar al club.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  const list = await env.INTENTOS.list();
  const intentos = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.INTENTOS.get(k.name);
      let rec: any = {};
      try { rec = raw ? JSON.parse(raw) : {}; } catch { rec = {}; }
      return {
        email: k.name,
        name: rec.name || '',
        picture: rec.picture || '',
        locale: rec.locale || '',
        firstAttempt: rec.firstAttempt || null,
        lastAttempt: rec.lastAttempt || null,
        attempts: rec.attempts || 0,
      };
    })
  );
  intentos.sort((a, b) => String(b.lastAttempt).localeCompare(String(a.lastAttempt)));
  return Response.json({ ok: true, intentos });
};

// Descartar un intento (ya invitado, no interesa, etc.)
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

  await env.INTENTOS.delete(email);
  return Response.json({ ok: true });
};
