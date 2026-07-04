import { readSessionEmail } from './_session';

interface Env {
  SESSION_SECRET: string;
  GENETICAS: KVNamespace;
}

const PRECIOS_KEY = 'precios';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) {
    return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });
  }

  const raw = await env.GENETICAS.get(PRECIOS_KEY);
  const precios = raw ? JSON.parse(raw) : null;
  if (!precios) {
    return Response.json({ ok: false, error: 'sin lista de precios' }, { status: 404 });
  }

  return Response.json({ ok: true, precios });
};
