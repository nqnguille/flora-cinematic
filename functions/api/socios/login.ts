import { verifyGoogleIdToken } from './_google';
import { createSessionCookie } from './_session';

interface Env {
  SOCIOS: KVNamespace;
  INTENTOS: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  SESSION_SECRET: string;
  ADMIN_EMAILS?: string;
  SUPER_ADMIN_EMAILS?: string;
  NOTIFY_TOKEN?: string;
}

const NOTIFY_URL = 'https://gates-analytics.nqnguille.workers.dev/api/notify';

// Avisa vía el hub central con el topic 'flora-intento' cuando aparece un
// prospecto NUEVO: alguien que se logueó con Google en la carta pero todavía
// no es socio, así el equipo lo puede aprobar a mano. Solo el primer intento
// de cada persona dispara aviso (los reintentos no re-avisan). Nunca bloquea.
async function notificarIntento(env: Env, p: { name: string; email: string }) {
  if (!env.NOTIFY_TOKEN) return;
  const text =
    `🚪 INTENTO DE INGRESO — todavía no es socia\n` +
    `👤 ${p.name || '(sin nombre de Google)'}\n` +
    `📧 ${p.email}\n` +
    `Probó entrar a la carta con Google pero no está en la lista.\n` +
    `Revisá/aprobá acá: https://floraong.ar/socios/admin/?ir=socios`;
  try {
    await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, token: env.NOTIFY_TOKEN, topic: 'flora-intento' }),
    });
  } catch {
    /* el aviso nunca bloquea el rechazo del login */
  }
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
  let appContext = '';
  try {
    const body = await request.json();
    credential = body?.credential;
    tosAccept = body?.tosAccept === true;
    appContext = String(body?.appContext || '');
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
    // Capturamos el intento como prospecto (solo el de la carta — un admin
    // que se equivoca de cuenta en /socios/admin/ no es un lead de socio).
    // Nunca bloqueamos el login por esto: si falla el guardado, igual 403.
    if (appContext !== 'admin') {
      try {
        const now = new Date().toISOString();
        const prevRaw = await env.INTENTOS.get(email);
        const prev = prevRaw ? JSON.parse(prevRaw) : {};
        await env.INTENTOS.put(email, JSON.stringify({
          name: payload.name || prev.name || '',
          picture: payload.picture || prev.picture || '',
          locale: payload.locale || prev.locale || '',
          firstAttempt: prev.firstAttempt || now,
          lastAttempt: now,
          attempts: (prev.attempts || 0) + 1,
        }));
        // Solo el primer intento de cada prospecto genera aviso (un reintento
        // del mismo email no debería re-avisar).
        if (!prevRaw) await notificarIntento(env, { name: payload.name || '', email });
      } catch {
        // no bloquea el rechazo del login
      }
    }
    return Response.json(
      { ok: false, error: 'tu cuenta de Google no está en la lista de socios verificados' },
      { status: 403 }
    );
  }

  // Si ya estaba en la lista de intentos y ahora es socio, dejamos de rastrearlo ahí.
  try { await env.INTENTOS.delete(email); } catch {}

  let rec: any = {};
  try { rec = JSON.parse(isSocio); } catch { rec = {}; } // valor legado "ok" → {}
  if (typeof rec !== 'object' || rec === null) rec = {};

  // Acceso de prueba (24h desde el PRIMER login, no desde el alta — ver
  // admin/socios.ts). Vencido, se lo trata como si nunca hubiera sido socio.
  if (rec.temporal && rec.tempExpiraEn && Date.now() > new Date(rec.tempExpiraEn).getTime()) {
    return Response.json(
      { ok: false, error: 'Tu acceso de prueba expiró — escribinos por WhatsApp si querés asociarte.' },
      { status: 403 }
    );
  }

  // El staff del club (ADMIN/SUPER_ADMIN) usa este mismo login para entrar al
  // panel: el consentimiento de "paciente reservando" no le aplica AHÍ. Pero
  // si esa misma persona entra por la CARTA (appContext !== 'admin') está
  // actuando como paciente y sí tiene que aceptar — por eso exigimos las DOS
  // condiciones, no solo que la cuenta figure como staff. (Antes eximía a
  // cualquier admin en cualquier contexto, así que un admin que también es
  // socio nunca veía el checkbox ni en la carta.)
  const isAdminStaff =
    emailList(env.ADMIN_EMAILS).includes(email) || emailList(env.SUPER_ADMIN_EMAILS).includes(email);
  const skipTos = isAdminStaff && appContext === 'admin';

  // Sin sesión hasta que el socio acepte la versión vigente de los términos.
  if (!skipTos && rec.tosAcceptedVersion !== TOS_VERSION) {
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
    // Arranca la cuenta atrás de 24h del acceso de prueba, justo en este
    // primer login (no antes) — para que "temporal" signifique 24h de uso
    // real, no 24h desde que Sofi lo aprobó y quizás tardó en entrar.
    if (rec.temporal && !rec.tempExpiraEn) {
      rec.tempExpiraEn = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    }
    rec.lastLogin = now;
    rec.logins = (rec.logins || 0) + 1;
    await env.SOCIOS.put(email, JSON.stringify(rec));
  } catch {
    // si falla el guardado del perfil, no bloqueamos el login
  }

  const cookie = await createSessionCookie(email, env.SESSION_SECRET, new URL(request.url).hostname);
  return Response.json(
    { ok: true, email },
    { headers: { 'Set-Cookie': cookie } }
  );
};
