import { readSessionEmail } from './_session';

interface Env {
  SESSION_SECRET: string;
  GENETICAS: KVNamespace;
  SOCIOS: KVNamespace;
}

const CATALOG_KEY = 'catalogo';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) {
    return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });
  }
  // La cookie por sí sola solo prueba que ALGUNA VEZ fue socio — sin este
  // chequeo, dar de baja a alguien no le sacaba el acceso hasta que
  // expirara la sesión (hasta 30 días).
  const esSocio = await env.SOCIOS.get(email);
  if (esSocio === null) {
    return Response.json({ ok: false, error: 'ya no sos socio de Flora' }, { status: 403 });
  }
  let rec: any = {};
  try { rec = JSON.parse(esSocio); } catch { rec = {}; }
  if (rec?.temporal && rec?.tempExpiraEn && Date.now() > new Date(rec.tempExpiraEn).getTime()) {
    return Response.json({ ok: false, error: 'Tu acceso de prueba expiró — escribinos por WhatsApp si querés asociarte.' }, { status: 403 });
  }

  const raw = await env.GENETICAS.get(CATALOG_KEY);
  const catalogo = raw ? JSON.parse(raw) : [];
  const activas = catalogo.filter((g: any) => g.activo);

  return Response.json({ ok: true, geneticas: activas });
};
