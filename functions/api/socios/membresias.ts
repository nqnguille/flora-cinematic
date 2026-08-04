// El contenido de /socios/membresias, para el socio.
//
// Mismo candado que precios.ts: la cookie sola no alcanza. Se revalida contra
// el padrón en cada carga, así un socio dado de baja deja de ver los importes
// al instante, sin esperar a que su sesión expire.
//
// Los PLANES salen de la tabla `precios` de D1, la misma que usan el alta de
// socios, la cobranza de finanzas y el panel de Mercado Pago. De KV salen solo
// los TEXTOS de la página. Nada de esto viaja en el HTML: todo pasa por acá,
// detrás del chequeo.
import { readSessionEmail } from './_session';
import { leerMembresias } from './admin/_membresias';
import { planesVigentes, situacionDelSocio, puedeAdherir } from './_planes';

interface Env {
  SESSION_SECRET: string;
  GENETICAS: KVNamespace;
  SOCIOS: KVNamespace;
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });

  const esSocio = await env.SOCIOS.get(email.toLowerCase());
  if (esSocio === null) {
    return Response.json({ ok: false, error: 'ya no sos socio de Flora' }, { status: 403 });
  }

  const [textos, planes, situacion] = await Promise.all([
    leerMembresias(env.GENETICAS),
    planesVigentes(env),
    situacionDelSocio(env, email),
  ]);

  return Response.json({
    ok: true,
    textos,
    planes,
    // Sin socioId: al front no le sirve y es un dato interno. El estado del
    // REPROCANN tampoco viaja: viaja el veredicto y el motivo en castellano.
    actual: {
      tier: situacion.tier,
      modalidad: situacion.modalidad,
      debitoActivo: situacion.debitoActivo,
      ...puedeAdherir(situacion.reprocann),
    },
  });
};
