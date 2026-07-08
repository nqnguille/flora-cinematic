import { requireAdmin, isSuperAdmin } from './_guard';

interface Env {
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
  SUPER_ADMIN_EMAILS?: string;
  GENETICAS: KVNamespace;
}

const CATALOG_KEY = 'catalogo';
const VERSION_KEY = 'catalogo:version';

async function getVersion(env: Env): Promise<number> {
  const raw = await env.GENETICAS.get(VERSION_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const check = await requireAdmin(request, env);
  if (check.status !== 200) {
    return Response.json({ ok: false, error: check.status === 401 ? 'no autenticado' : 'no autorizado' }, { status: check.status });
  }

  const raw = await env.GENETICAS.get(CATALOG_KEY);
  return Response.json({
    ok: true,
    geneticas: raw ? JSON.parse(raw) : [],
    version: await getVersion(env),
    isSuperAdmin: isSuperAdmin(check.email, env),
    email: check.email, // identidad del admin para el chip del header
  });
};

// Guarda el catálogo completo — protegido con un número de versión: si otra
// sesión (u otra pestaña) guardó o togglear "Disponible" desde que esta
// pantalla cargó los datos, se rechaza en vez de pisar ese cambio en
// silencio (dos admins podían perder ediciones del otro sin ningún aviso).
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

  const current = await getVersion(env);
  const clientVersion = Number(body?.version);
  if (!Number.isFinite(clientVersion) || clientVersion !== current) {
    const raw = await env.GENETICAS.get(CATALOG_KEY);
    return Response.json({
      ok: false,
      conflict: true,
      error: 'Alguien más guardó cambios en el catálogo mientras tenías esta pantalla abierta. Recargá para ver la versión más reciente antes de volver a guardar.',
      geneticas: raw ? JSON.parse(raw) : [],
      version: current,
    }, { status: 409 });
  }

  const next = current + 1;
  await env.GENETICAS.put(CATALOG_KEY, JSON.stringify(body.geneticas));
  await env.GENETICAS.put(VERSION_KEY, String(next));
  return Response.json({ ok: true, version: next });
};

// Cambia SOLO el estado "disponible" de una genética (autoguardado del toggle),
// sin tocar el resto del catálogo ni ediciones pendientes del cliente. También
// bumpea la versión — así un PUT viejo en otra pestaña detecta el conflicto.
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
  const next = (await getVersion(env)) + 1;
  await env.GENETICAS.put(CATALOG_KEY, JSON.stringify(catalogo));
  await env.GENETICAS.put(VERSION_KEY, String(next));
  return Response.json({ ok: true, version: next });
};
