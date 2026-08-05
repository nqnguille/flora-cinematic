// Qué cuentas atienden mostrador. GET devuelve la lista vigente (con el
// nombre de cada una, para que el panel muestre personas y no emails sueltos);
// PUT guarda la lista entera. Mismo patrón que avisos.ts: un doc JSON en KV
// GENETICAS.
import { requireCap } from '../../panel/_rol';
import { leerMostrador, guardarMostrador, MOSTRADOR_DEFAULT } from '../_mostrador';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
  GENETICAS: KVNamespace;
  SOCIOS: KVNamespace;
}

async function guard(request: Request, env: Env, cap: 'carta_gestionar' | 'reservas_operar' = 'carta_gestionar') {
  const check = await requireCap(request, env, cap);
  if (check.status !== 200) {
    return Response.json(
      { ok: false, error: check.status === 401 ? 'no autenticado' : 'sin permiso para configurar el mostrador' },
      { status: check.status },
    );
  }
  return null;
}

async function conNombre(env: Env, cuentas: string[]) {
  return Promise.all(
    cuentas.map(async (email) => {
      const raw = await env.SOCIOS.get(email);
      let rec: any = {};
      try { rec = JSON.parse(raw || '{}'); } catch { rec = {}; }
      if (typeof rec !== 'object' || rec === null) rec = {};
      // `existe` en falso = la cuenta está configurada pero ya no es socia:
      // no podría ni entrar a la carta, así que el panel lo marca.
      return { email, name: String(rec.name || ''), existe: raw !== null };
    }),
  );
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // Leerla la necesita cualquiera que atienda reservas (el panel marca con
  // ella qué pedidos vienen del living); editarla es de quien gestiona.
  const denied = await guard(request, env, 'reservas_operar');
  if (denied) return denied;
  const cfg = await leerMostrador(env.GENETICAS);
  return Response.json({ ok: true, cuentas: await conNombre(env, cfg.cuentas), defaults: MOSTRADOR_DEFAULT.cuentas });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }
  if (!Array.isArray(body?.cuentas)) {
    return Response.json({ ok: false, error: 'falta la lista de cuentas' }, { status: 400 });
  }

  const cfg = await guardarMostrador(env.GENETICAS, body.cuentas);
  return Response.json({ ok: true, cuentas: await conNombre(env, cfg.cuentas) });
};
