// Editor del contenido de /socios/membresias (capacidad catalogo_editar).
// GET devuelve el documento vigente con sus defaults; PUT guarda el documento
// entero. Mismo patrón que precios.ts y avisos.ts: un solo doc JSON en KV.
import { requireCap } from '../../panel/_rol';
import { leerMembresiasAdmin, validarMembresias, MEMBRESIAS_KEY, ZONAS } from './_membresias';
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
  const { doc, rev } = await leerMembresiasAdmin(env.GENETICAS);
  return Response.json({ ok: true, membresias: doc, rev, zonas: ZONAS });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'body inválido' }, { status: 400 }); }

  const res = validarMembresias((body as Record<string, unknown>)?.membresias);
  if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 400 });

  // Concurrencia optimista: el editor manda el documento ENTERO desde su
  // memoria, así que una pestaña que quedó vieja pisaba con datos viejos todo
  // lo guardado en el medio (le pasó cinco veces al dueño con los mismos seis
  // ítems). Cada versión lleva una `rev` adentro del JSON (`_rev`): el PUT
  // solo se acepta si trae la rev vigente. Un panel viejo cacheado no manda
  // rev y también recibe 409: es exactamente el guardado que hay que frenar.
  // (KV no es atómico: dos guardados en el MISMO segundo aún podrían cruzarse,
  // pero el caso real es la pestaña vieja, con minutos u horas de diferencia.)
  const anterior = await env.GENETICAS.get(MEMBRESIAS_KEY);
  let revVigente = 0;
  try { revVigente = Number((JSON.parse(anterior || '{}') as { _rev?: unknown })._rev) || 0; } catch { /* doc viejo sin rev */ }
  const revMandada = Number((body as Record<string, unknown>)?.rev);
  if (!Number.isFinite(revMandada) || revMandada !== revVigente) {
    return Response.json(
      { ok: false, error: 'Otra pestaña guardó en el medio: recargá la página para no pisar esos cambios.', rev: revVigente },
      { status: 409 }
    );
  }

  // Historial automático ANTES de pisar: cada guardado archiva la versión
  // anterior en una clave con fecha, con 90 días de vida. Existe porque el
  // 07/08/2026 una escritura externa pisó una edición manual completa y no
  // había de dónde recuperarla: nunca más un solo punto de falla para textos
  // que alguien escribió a mano. Recuperar = copiar una clave hist a la
  // clave viva (o pedírselo al asistente).
  try {
    // Se compara SIN `_rev`: si no, el número solo haría parecer distinto un
    // guardado idéntico y se archivaría historial de más.
    let contenidoAnterior = anterior;
    try {
      const { _rev, ...resto } = JSON.parse(anterior || 'null') || {};
      contenidoAnterior = JSON.stringify(resto);
    } catch { /* si no parsea, se compara crudo */ }
    if (anterior && contenidoAnterior !== JSON.stringify(res.doc)) {
      const marca = new Date().toISOString().replace(/[:.]/g, '-');
      await env.GENETICAS.put(`${MEMBRESIAS_KEY}.hist.${marca}`, anterior, { expirationTtl: 60 * 60 * 24 * 90 });
    }
  } catch { /* el historial nunca bloquea el guardado */ }

  // La rev nueva es el reloj, con el máximo por si el reloj retrocediera.
  const revNueva = Math.max(Date.now(), revVigente + 1);
  await env.GENETICAS.put(MEMBRESIAS_KEY, JSON.stringify({ ...res.doc, _rev: revNueva }));
  return Response.json({ ok: true, membresias: res.doc, rev: revNueva });
};
