import { readSessionEmail } from './_session';

interface Env {
  SESSION_SECRET: string;
  SOCIOS: KVNamespace;
}

// Perfil mínimo del socio logueado (para el "¡Hola, ...!" de la landing).
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) {
    return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });
  }

  const raw = await env.SOCIOS.get(email);
  if (raw === null) {
    return Response.json({ ok: false, error: 'no sos socio' }, { status: 403 });
  }
  let rec: any = {};
  try { rec = JSON.parse(raw); } catch { rec = {}; }
  if (typeof rec !== 'object' || rec === null) rec = {};

  return Response.json({
    ok: true,
    email,
    name: rec.name || '',
    picture: rec.picture || '',
  });
};
