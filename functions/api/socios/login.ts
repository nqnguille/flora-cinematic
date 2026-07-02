import { verifyGoogleIdToken } from './_google';
import { createSessionCookie } from './_session';

interface Env {
  SOCIOS: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  SESSION_SECRET: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let credential: string | undefined;
  try {
    ({ credential } = await request.json());
  } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }
  if (!credential) {
    return Response.json({ ok: false, error: 'falta el credential de Google' }, { status: 400 });
  }

  let email: string;
  try {
    const payload = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID);
    email = payload.email.toLowerCase();
  } catch (err: any) {
    return Response.json({ ok: false, error: `token de Google inválido: ${err.message}` }, { status: 401 });
  }

  const isSocio = await env.SOCIOS.get(email);
  if (!isSocio) {
    return Response.json(
      { ok: false, error: 'tu cuenta de Google no está en la lista de socios verificados' },
      { status: 403 }
    );
  }

  const cookie = await createSessionCookie(email, env.SESSION_SECRET);
  return Response.json(
    { ok: true, email },
    { headers: { 'Set-Cookie': cookie } }
  );
};
