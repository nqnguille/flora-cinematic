interface Env {
  GENETICAS: KVNamespace;
}

const CATALOG_KEY = 'catalogo';
const MAX_ITEMS = 8;

// Vidriera PÚBLICA (sin sesión) para el teaser de la landing: solo nombre,
// tipo y formato de las genéticas activas — nada de THC/CBD, banco, efectos,
// sabores ni precio. La ficha completa sigue exclusiva de la carta de socios.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const raw = await env.GENETICAS.get(CATALOG_KEY);
  const catalogo = raw ? JSON.parse(raw) : [];
  const activas = catalogo
    .filter((g: any) => g.activo)
    .map((g: any) => ({
      id: g.id,
      nombre: g.nombre,
      tipo: g.tipo,
      formatos: Array.isArray(g.formatos) && g.formatos.length ? g.formatos : ['flor'],
    }))
    .slice(0, MAX_ITEMS);

  return Response.json(
    { ok: true, geneticas: activas, total: catalogo.filter((g: any) => g.activo).length },
    { headers: { 'Cache-Control': 'public, max-age=300' } } // 5 min: la landing no necesita estar al segundo
  );
};
