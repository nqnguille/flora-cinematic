import { requireAdmin, isSuperAdmin } from './_guard';

interface Env {
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
  SUPER_ADMIN_EMAILS?: string;
  GENETICAS: KVNamespace;
}

const CATALOG_KEY = 'catalogo';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const check = await requireAdmin(request, env);
  if (check.status !== 200) {
    return Response.json({ ok: false, error: check.status === 401 ? 'no autenticado' : 'no autorizado' }, { status: check.status });
  }

  const raw = await env.GENETICAS.get(CATALOG_KEY);
  return Response.json({
    ok: true,
    geneticas: raw ? JSON.parse(raw) : [],
    isSuperAdmin: isSuperAdmin(check.email, env),
    email: check.email, // identidad del admin para el chip del header
  });
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

// Cambia SOLO el estado "disponible" de una genética (autoguardado del toggle),
// sin tocar el resto del catálogo ni ediciones pendientes del cliente.
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
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

  const id = String(body?.id || '');
  if (!id) return Response.json({ ok: false, error: 'falta id' }, { status: 400 });

  const raw = await env.GENETICAS.get(CATALOG_KEY);
  const catalogo = raw ? JSON.parse(raw) : [];
  const g = catalogo.find((x: any) => x.id === id);
  if (!g) return Response.json({ ok: false, error: 'genética no encontrada (guardá primero)' }, { status: 404 });

  g.activo = !!body.activo;
  await env.GENETICAS.put(CATALOG_KEY, JSON.stringify(catalogo));
  return Response.json({ ok: true });
};
