import { requireSuperAdmin } from './_guard';

interface Env {
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
  SUPER_ADMIN_EMAILS?: string;
  SOLICITUDES: KVNamespace;
}

// Sirve el adjunto (foto/PDF del REPROCANN) de una solicitud — a diferencia
// de /foto/*, esto es privado: dato personal, no un asset de marketing.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const check = await requireSuperAdmin(request, env);
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
