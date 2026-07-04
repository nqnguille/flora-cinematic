import { requireSuperAdmin } from './_guard';

interface Env {
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
  SUPER_ADMIN_EMAILS?: string;
  SOCIOS: KVNamespace;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRec(raw: string | null): any {
  if (!raw) return {};
  try {
    const r = JSON.parse(raw);
    return typeof r === 'object' && r !== null ? r : {};
  } catch {
    return {}; // valor legado tipo "ok"
  }
}

async function guard(request: Request, env: Env) {
  const check = await requireSuperAdmin(request, env);
  if (check.status !== 200) {
    return Response.json(
      { ok: false, error: check.status === 401 ? 'no autenticado' : 'solo el super admin puede gestionar socios' },
      { status: check.status }
    );
  }
  return null;
}

// Lista de socios con su ficha (email + nota + perfil de Google capturado en login)
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  const list = await env.SOCIOS.list();
  const socios = await Promise.all(
    list.keys.map(async (k) => {
      const rec = parseRec(await env.SOCIOS.get(k.name));
      return {
        email: k.name,
        nota: rec.nota || '',
        name: rec.name || '',
        givenName: rec.givenName || '',
        familyName: rec.familyName || '',
        picture: rec.picture || '',
        locale: rec.locale || '',
        emailVerified: rec.emailVerified ?? null,
        alta: rec.alta || null,
        firstLogin: rec.firstLogin || null,
        lastLogin: rec.lastLogin || null,
        logins: rec.logins || 0,
      };
    })
  );
  socios.sort((a, b) => a.email.localeCompare(b.email));
  return Response.json({ ok: true, socios });
};

// Alta / edición (email + nota). Preserva el perfil ya capturado.
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

  const existente = await env.SOCIOS.get(email);
  const rec = parseRec(existente);
  rec.nota = String(body?.nota ?? rec.nota ?? '');
  if (existente === null) rec.alta = new Date().toISOString(); // fecha real de alta en el club
  await env.SOCIOS.put(email, JSON.stringify(rec));
  return Response.json({ ok: true, email });
};

// Baja
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

  await env.SOCIOS.delete(email);
  return Response.json({ ok: true });
};
