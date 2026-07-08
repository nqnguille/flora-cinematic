import { readSessionEmail } from './_session';

interface Env {
  SESSION_SECRET: string;
  GENETICAS: KVNamespace;
  SOCIOS: KVNamespace;
}

const PRECIOS_KEY = 'precios';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) {
    return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });
  }
  // Mismo chequeo que geneticas.ts: la cookie sola no alcanza, un socio
  // dado de baja no puede seguir viendo esto hasta que expire la sesión.
  const esSocio = await env.SOCIOS.get(email);
  if (esSocio === null) {
    return Response.json({ ok: false, error: 'ya no sos socio de Flora' }, { status: 403 });
  }

  const raw = await env.GENETICAS.get(PRECIOS_KEY);
  const precios = raw ? JSON.parse(raw) : null;
  if (!precios) {
    return Response.json({ ok: false, error: 'sin lista de precios' }, { status: 404 });
  }

  return Response.json({ ok: true, precios });
};
