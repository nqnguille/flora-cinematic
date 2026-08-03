// Editor de plantillas de avisos de reservas (capacidad avisos_editar:
// presidente y operación). GET devuelve las plantillas vigentes (con
// defaults) + las variables disponibles; PUT guarda el documento entero.
// Patrón calcado de precios.ts: un solo doc JSON en KV GENETICAS.
import { requireCap } from '../../panel/_rol';
import { leerAvisos, validarPlantilla, AVISOS_DEFAULT, type Avisos } from './_avisos';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
  GENETICAS: KVNamespace;
}

async function guard(request: Request, env: Env) {
  const check = await requireCap(request, env, 'avisos_editar');
  if (check.status !== 200) {
    return Response.json(
      { ok: false, error: check.status === 401 ? 'no autenticado' : 'sin permiso para editar avisos' },
      { status: check.status }
    );
  }
  return null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;
  const avisos = await leerAvisos(env.GENETICAS);
  return Response.json({
    ok: true,
    avisos,
    variables: ['{{nombre}}', '{{items}}', '{{nota}}'],
    defaults: AVISOS_DEFAULT,
  });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }

  const doc: Partial<Avisos> = {};
  for (const estado of ['listo', 'entregado'] as const) {
    const p = body?.[estado];
    if (!validarPlantilla(p)) {
      return Response.json({ ok: false, error: `plantilla "${estado}" inválida (activo booleano, asunto ≤150, textos ≤2000)` }, { status: 400 });
    }
    doc[estado] = { activo: p.activo, asunto: p.asunto.trim(), cuerpo: p.cuerpo.trim(), wa: p.wa.trim() };
  }

  await env.GENETICAS.put('avisos', JSON.stringify(doc));
  return Response.json({ ok: true, avisos: await leerAvisos(env.GENETICAS) });
};
