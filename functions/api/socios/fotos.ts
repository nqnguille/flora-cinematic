// Fotos de producto (aceites/cremas/extracciones), públicas — a diferencia de
// /api/socios/precios (gateado a socios), el catálogo visual debe verse sin
// sesión. Se sirve desde el mismo documento "precios" en KV, pero acá solo
// exponemos foto por id, nunca el precio.
interface Env {
  GENETICAS: KVNamespace;
}

const PRECIOS_KEY = 'precios';
const CATEGORIAS = ['aceites', 'cremas', 'extracciones'];

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const raw = await env.GENETICAS.get(PRECIOS_KEY);
  const precios = raw ? JSON.parse(raw) : {};

  const fotos: Record<string, Record<string, string>> = {};
  for (const cat of CATEGORIAS) {
    fotos[cat] = {};
    const items = Array.isArray(precios[cat]) ? precios[cat] : [];
    for (const it of items) {
      if (it?.id && it?.foto) fotos[cat][it.id] = it.foto;
    }
  }

  return Response.json({ ok: true, fotos });
};
