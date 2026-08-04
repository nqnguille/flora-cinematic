// Editor del contenido de /socios/membresias (capacidad catalogo_editar).
// GET devuelve el documento vigente con sus defaults; PUT guarda el documento
// entero. Mismo patrón que precios.ts y avisos.ts: un solo doc JSON en KV.
import { requireCap } from '../../panel/_rol';
import { leerMembresias, validarMembresias, MEMBRESIAS_KEY } from './_membresias';
import { planesVigentes } from '../_planes';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
  GENETICAS: KVNamespace;
}

async function guard(request: Request, env: Env) {
  const check = await requireCap(request, env, 'catalogo_editar');
  if (check.status !== 200) {
    return Response.json(
      { ok: false, error: check.status === 401 ? 'no autenticado' : 'sin permiso para editar el catálogo' },
      { status: check.status }
    );
  }
  return null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;
  // ?planes=1 devuelve los planes de la lista de precios vigente, para que el
  // panel los muestre en solo lectura junto a los textos.
  if (new URL(request.url).searchParams.get('planes')) {
    return Response.json({ ok: true, planes: await planesVigentes(env) });
  }
  return Response.json({ ok: true, membresias: await leerMembresias(env.GENETICAS) });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'body inválido' }, { status: 400 }); }

  const res = validarMembresias((body as Record<string, unknown>)?.membresias);
  if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 400 });

  await env.GENETICAS.put(MEMBRESIAS_KEY, JSON.stringify(res.doc));
  return Response.json({ ok: true, membresias: res.doc });
};
