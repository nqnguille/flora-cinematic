import { requireCap } from '../../panel/_rol';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
  SUPER_ADMIN_EMAILS?: string;
  SOLICITUDES: KVNamespace;
}

// ¿Hay adjunto para este email? Responde sin traer el archivo, para que la
// ficha del socio pueda decidir si muestra el botón sin bajarse la foto
// entera cada vez que se abre el cajón.
export const onRequestHead: PagesFunction<Env> = async ({ request, env }) => {
  const check = await requireCap(request, env, 'carta_gestionar');
  if (check.status !== 200) return new Response(null, { status: check.status });

  const email = (new URL(request.url).searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return new Response(null, { status: 400 });

  // el KV no tiene un "existe?": pedimos la metadata, que es chica
  const obj = await env.SOLICITUDES.getWithMetadata(`archivo:${email}`, 'stream');
  if (!obj || !obj.value) return new Response(null, { status: 404 });
  // el cuerpo se descarta: HEAD no lo lleva
  try { await obj.value.cancel(); } catch { /* ya cerrado */ }
  return new Response(null, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
};

// Sirve el adjunto (foto/PDF del REPROCANN) de una solicitud — a diferencia
// de /foto/*, esto es privado: dato personal, no un asset de marketing.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const check = await requireCap(request, env, 'carta_gestionar');
  if (check.status !== 200) {
    return new Response(check.status === 401 ? 'No autenticado' : 'No autorizado', { status: check.status });
  }

  const url = new URL(request.url);
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return new Response('Falta el email', { status: 400 });

  const obj = await env.SOLICITUDES.getWithMetadata(`archivo:${email}`, 'arrayBuffer');
  if (!obj || !obj.value) return new Response('No hay adjunto para ese email', { status: 404 });

  const meta = (obj.metadata as any) || {};
  return new Response(obj.value, {
    headers: {
      'Content-Type': meta.contentType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${(meta.filename || 'reprocann').replace(/[^\w.\-]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
};
