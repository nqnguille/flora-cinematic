interface Env {
  FOTOS: KVNamespace;
}

// Sirve una imagen guardada en KV. Pública (las fotos no son sensibles) y cacheable.
export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  if (!path) return new Response('Not found', { status: 404 });

  const obj = await env.FOTOS.getWithMetadata(path, 'arrayBuffer');
  if (!obj || !obj.value) return new Response('Not found', { status: 404 });

  const contentType = (obj.metadata as any)?.contentType || 'image/jpeg';
  return new Response(obj.value, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
