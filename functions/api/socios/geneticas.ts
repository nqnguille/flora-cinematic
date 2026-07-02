import { readSessionEmail } from './_session';

interface Env {
  SESSION_SECRET: string;
  GENETICAS: KVNamespace;
}

const CATALOG_KEY = 'catalogo';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) {
    return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });
  }

  const raw = await env.GENETICAS.get(CATALOG_KEY);
  const catalogo = raw ? JSON.parse(raw) : [];
  const activas = catalogo.filter((g: any) => g.activo);

  return Response.json({ ok: true, geneticas: activas });
};
