import { verifyGoogleIdToken } from './_google';
import { createSessionCookie } from './_session';

interface Env {
  SOCIOS: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  SESSION_SECRET: string;
  ADMIN_EMAILS?: string;
  SUPER_ADMIN_EMAILS?: string;
}

// Bump esta fecha cuando el texto legal en carta.astro (#gn-tos-modal) cambie
// de forma sustancial: los socios que ya aceptaron una versión anterior
// vuelven a ver el modal de aceptación en su próximo login.
const TOS_VERSION = '2026-07-05';

function emailList(v?: string): string[] {
  return (v || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let credential: string | undefined;
  let tosAccept = false;
  try {
    const body = await request.json();
    credential = body?.credential;
    tosAccept = body?.tosAccept === true;
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

  let rec: any = {};
  try { rec = JSON.parse(isSocio); } catch { rec = {}; } // valor legado "ok" → {}
  if (typeof rec !== 'object' || rec === null) rec = {};

  // El staff del club (ADMIN/SUPER_ADMIN) usa este mismo login para entrar al
  // panel: el consentimiento de "paciente reservando" no le aplica.
  const isAdminStaff =
    emailList(env.ADMIN_EMAILS).includes(email) || emailList(env.SUPER_ADMIN_EMAILS).includes(email);

  // Sin sesión hasta que el socio acepte la versión vigente de los términos.
  if (!isAdminStaff && rec.tosAcceptedVersion !== TOS_VERSION) {
    if (!tosAccept) {
      return Response.json({
        ok: false,
        needsTos: true,
        name: payload.name || rec.name || '',
        picture: payload.picture || rec.picture || '',
      });
    }
    rec.tosAcceptedVersion = TOS_VERSION;
    rec.tosAcceptedAt = new Date().toISOString();
  }

  // Enriquecemos la ficha del socio con el perfil de Google + registro de ingreso.
  try {
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
