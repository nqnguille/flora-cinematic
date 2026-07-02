import { requireAdmin } from './_guard';

interface Env {
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
  GENETICAS: KVNamespace;
}

const CATALOG_KEY = 'catalogo';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const check = await requireAdmin(request, env);
  if (check.status !== 200) {
    return Response.json({ ok: false, error: check.status === 401 ? 'no autenticado' : 'no autorizado' }, { status: check.status });
  }

  const raw = await env.GENETICAS.get(CATALOG_KEY);
  return Response.json({ ok: true, geneticas: raw ? JSON.parse(raw) : [] });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const check = await requireAdmin(request, env);
  if (check.status !== 200) {
    return Response.json({ ok: false, error: check.status === 401 ? 'no autenticado' : 'no autorizado' }, { status: check.status });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }

  if (!Array.isArray(body?.geneticas)) {
    return Response.json({ ok: false, error: 'se esperaba { geneticas: [...] }' }, { status: 400 });
  }

  for (const g of body.geneticas) {
    if (typeof g.id !== 'string' || typeof g.nombre !== 'string') {
      return Response.json({ ok: false, error: 'cada genética necesita id y nombre' }, { status: 400 });
    }
  }

  await env.GENETICAS.put(CATALOG_KEY, JSON.stringify(body.geneticas));
  return Response.json({ ok: true });
};
