// Editor del contenido de /socios/membresias (capacidad catalogo_editar).
// GET devuelve el documento vigente con sus defaults; PUT guarda el documento
// entero. Mismo patrón que precios.ts y avisos.ts: un solo doc JSON en KV.
import { requireCap } from '../../panel/_rol';
import { leerMembresias, validarMembresias, MEMBRESIAS_KEY } from './_membresias';
import { planesVigentes } from '../_planes';
import { PASOS } from '../../panel/reprocann/_pasos';

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
  const q = new URL(request.url).searchParams;
  if (q.get('planes')) {
    return Response.json({ ok: true, planes: await planesVigentes(env) });
  }
  // Los estados del trámite con cuánta gente hay en cada uno: sin ese número,
  // tildar o destildar uno es a ciegas.
  if (q.get('estados')) {
    const filas = await env.DB.prepare(
      `SELECT COALESCE(reprocann_estado, '') AS estado,
              COUNT(*) AS socios,
              SUM(CASE WHEN EXISTS (
                    SELECT 1 FROM membresias m WHERE m.socio_id = socios.id AND m.hasta IS NULL
                  ) THEN 1 ELSE 0 END) AS con_membresia
         FROM socios
        WHERE numero IS NULL OR numero != -1
        GROUP BY 1`,
    ).all<{ estado: string; socios: number; con_membresia: number }>();
    const porEstado = new Map(filas.results.map((f) => [f.estado, f]));
    const estados = PASOS.map((paso) => {
      const c = porEstado.get(paso.id);
      return { id: paso.id, nombre: paso.nombre, ayuda: paso.ayuda, socios: c?.socios ?? 0, conMembresia: c?.con_membresia ?? 0 };
    });
    const sinDato = porEstado.get('');
    if (sinDato) {
      estados.push({ id: '', nombre: 'Sin dato', ayuda: 'No tiene estado de REPROCANN registrado.', socios: sinDato.socios, conMembresia: sinDato.con_membresia });
    }
    return Response.json({ ok: true, estados });
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
