// Buscador de socios para el mostrador del living.
//
// Tres decisiones que valen la pena explicar:
//  · Solo responde a cuentas de mostrador. Un socio común pidiendo esta URL
//    se lleva un 403: el padrón no es dato de la carta.
//  · Exige 2 caracteres y devuelve como mucho 8. La pantalla del living la ve
//    cualquiera que esté sentado en el sillón, así que el listado completo de
//    socios no puede aparecer nunca, ni con el campo vacío.
//  · Devuelve nombre y email, nada más. Ni teléfono, ni DNI, ni notas.
//
// El padrón se arma leyendo el KV entero (una lectura por socio), así que se
// cachea 60 segundos: tipear "facundo" son cuatro requests seguidos y no
// tiene sentido releer 75 registros en cada tecla.

import { readSessionEmail } from './_session';
import { esMostrador, leerMostrador } from './_mostrador';

interface Env {
  SESSION_SECRET: string;
  SOCIOS: KVNamespace;
  GENETICAS: KVNamespace;
}

const MIN_CHARS = 2;
const MAX_RESULTADOS = 8;
const CACHE_URL = 'https://flora.interno/padron-mostrador';
const CACHE_SEGUNDOS = 60;

interface Ficha {
  email: string;
  name: string;
  temporal: boolean;
}

async function padron(env: Env): Promise<Ficha[]> {
  // `caches.default` no existe en todos los entornos (dev local); si falta,
  // los try/catch dejan la búsqueda igual de correcta, solo sin caché.
  const cache = (caches as any)?.default as Cache | undefined;
  const req = new Request(CACHE_URL);
  try {
    const hit = await cache!.match(req);
    if (hit) return await hit.json();
  } catch { /* sin caché se relee, no es un error */ }

  const list = await env.SOCIOS.list();
  const fichas = await Promise.all(
    list.keys.map(async (k) => {
      let rec: any = {};
      try { rec = JSON.parse((await env.SOCIOS.get(k.name)) || '{}'); } catch { rec = {}; }
      if (typeof rec !== 'object' || rec === null) rec = {}; // registros legados guardados como "ok"
      return { email: k.name, name: String(rec.name || ''), temporal: rec.temporal === true };
    }),
  );

  try {
    await cache!.put(req, new Response(JSON.stringify(fichas), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SEGUNDOS}` },
    }));
  } catch { /* idem */ }
  return fichas;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });
  if (!(await esMostrador(env.GENETICAS, email))) {
    return Response.json({ ok: false, error: 'esta cuenta no atiende mostrador' }, { status: 403 });
  }

  const q = String(new URL(request.url).searchParams.get('q') || '').trim().toLowerCase();
  if (q.length < MIN_CHARS) return Response.json({ ok: true, socios: [] });

  const cuentasMostrador = new Set((await leerMostrador(env.GENETICAS)).cuentas);
  const fichas = await padron(env);

  const socios = fichas
    // Un acceso de prueba no puede reservar (pedidos.ts lo rechaza), así que
    // ofrecerlo como destino sería mandar al mostrador contra una pared.
    .filter((f) => !f.temporal && !cuentasMostrador.has(f.email))
    .filter((f) => f.email.includes(q) || f.name.toLowerCase().includes(q))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, 'es', { sensitivity: 'base' }))
    .slice(0, MAX_RESULTADOS)
    .map((f) => ({ email: f.email, name: f.name }));

  return Response.json({ ok: true, socios });
};
