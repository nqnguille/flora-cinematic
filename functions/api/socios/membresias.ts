// El contenido de /socios/membresias, para el socio.
//
// Mismo candado que precios.ts: la cookie sola no alcanza. Se revalida contra
// el padrón en cada carga, así un socio dado de baja deja de ver los importes
// al instante, sin esperar a que su sesión expire.
//
// Es a propósito que la página no traiga nada horneado en el HTML: los
// importes viajan solo por acá, detrás de este chequeo.
import { readSessionEmail } from './_session';
import { leerMembresias } from './admin/_membresias';

interface Env {
  SESSION_SECRET: string;
  GENETICAS: KVNamespace;
  SOCIOS: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });

  const esSocio = await env.SOCIOS.get(email.toLowerCase());
  if (esSocio === null) {
    return Response.json({ ok: false, error: 'ya no sos socio de Flora' }, { status: 403 });
  }

  return Response.json({ ok: true, membresias: await leerMembresias(env.GENETICAS) });
};
