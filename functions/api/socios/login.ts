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
  let payload: Awaited<ReturnType<typeof verifyGoogleIdToken>>;
  try {
    payload = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID);
    email = payload.email.toLowerCase();
  } catch (err: any) {
    return Response.json({ ok: false, error: `token de Google inválido: ${err.message}` }, { status: 401 });
  }

  const isSocio = await env.SOCIOS.get(email);
  if (isSocio === null) {
    return Response.json(
      { ok: false, error: 'tu cuenta de Google no está en la lista de socios verificados' },
      { status: 403 }
    );
  }

  // Enriquecemos la ficha del socio con el perfil de Google + registro de ingreso.
  try {
    let rec: any = {};
    try { rec = JSON.parse(isSocio); } catch { rec = {}; } // valor legado "ok" → {}
    if (typeof rec !== 'object' || rec === null) rec = {};
    const now = new Date().toISOString();
    rec.name = payload.name || rec.name || '';
    rec.givenName = payload.given_name || rec.givenName || '';
    rec.familyName = payload.family_name || rec.familyName || '';
    rec.picture = payload.picture || rec.picture || '';
    rec.locale = payload.locale || rec.locale || '';
    rec.googleId = payload.sub || rec.googleId || '';
    rec.emailVerified = payload.email_verified;
    if (!rec.firstLogin) rec.firstLogin = now;
    rec.lastLogin = now;
    rec.logins = (rec.logins || 0) + 1;
    await env.SOCIOS.put(email, JSON.stringify(rec));
  } catch {
    // si falla el guardado del perfil, no bloqueamos el login
  }

  const cookie = await createSessionCookie(email, env.SESSION_SECRET);
  return Response.json(
    { ok: true, email },
    { headers: { 'Set-Cookie': cookie } }
  );
};
