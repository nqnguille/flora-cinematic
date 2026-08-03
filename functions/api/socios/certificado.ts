// La "guantera digital" del socio: descarga de SU certificado REPROCANN
// (el PDF oficial emitido por el Ministerio, guardado por el club en KV).
// Solo el dueño de la sesión puede bajar el suyo — nunca el de otro.
import { readSessionEmail } from './_session';

interface Env {
  DB: D1Database;
  SOCIOS: KVNamespace;
  CERTIFICADOS: KVNamespace;
  SESSION_SECRET: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return Response.json({ error: 'Sin sesión' }, { status: 401 });
  const esSocio = await env.SOCIOS.get(email.toLowerCase());
  if (!esSocio) return Response.json({ error: 'Sin acceso' }, { status: 403 });

  const s = await env.DB.prepare(
    `SELECT id, nombre FROM socios WHERE email = ? AND (numero IS NULL OR numero != -1)`,
  ).bind(email.toLowerCase()).first<{ id: number; nombre: string }>();
  if (!s) return Response.json({ error: 'Tu cuenta no está vinculada al padrón' }, { status: 404 });

  const pdf = await env.CERTIFICADOS.get(`cert:${s.id}`, 'arrayBuffer');
  if (!pdf) return Response.json({ error: 'Todavía no tenemos tu certificado cargado' }, { status: 404 });

  const nombreArchivo = `REPROCANN ${s.nombre}.pdf`.replace(/[^\w\s.\-áéíóúÁÉÍÓÚñÑ]/g, '');
  return new Response(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
      'Cache-Control': 'private, no-store',
    },
  });
};
