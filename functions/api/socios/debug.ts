interface Env {
  PEDIDOS: KVNamespace;
}

// Buzón TEMPORAL de diagnóstico del admin (pantalla negra en el Chrome de Guille).
// La página manda una radiografía del DOM y acá queda 24h en KV para leerla
// con wrangler. Sacar cuando el bug esté cazado.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const text = (await request.text()).slice(0, 20000);
  if (!text) return new Response('vacio', { status: 400 });
  const id = `debug:${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await env.PEDIDOS.put(id, text, { expirationTtl: 86400 });
  return new Response('ok');
};
