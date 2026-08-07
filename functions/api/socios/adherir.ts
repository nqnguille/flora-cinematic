// El socio se adhiere solo al débito automático.
//
// Hasta ahora el link de suscripción de Mercado Pago se lo mandaba el equipo a
// mano desde el panel (vista 'enviar' de panel/mp, que deja constancia en
// envios_debito). Esto hace lo mismo, pero disparado por el propio socio desde
// /socios/membresias: un click y va al checkout de MP.
//
// Deja la MISMA constancia, con via = 'autogestion', para que el panel sepa
// que ya tiene el link y no lo persiga con un envío manual.
//
// Lo que NO hace: no cambia la membresía del socio ni le habilita gramos. Eso
// lo hace el webhook de MP recién cuando el pago se acredita de verdad
// (asegurarMembresiaDebito en api/mp/webhook). Acá solo se entrega el link.
import { readSessionEmail } from './_session';
import { planesVigentes, situacionDelSocio, puedeAdherir } from './_planes';
import { leerMembresias } from './admin/_membresias';

interface Env {
  SESSION_SECRET: string;
  SOCIOS: KVNamespace;
  GENETICAS: KVNamespace;
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });

  const esSocio = await env.SOCIOS.get(email.toLowerCase());
  if (esSocio === null) {
    return Response.json({ ok: false, error: 'ya no sos socio de Flora' }, { status: 403 });
  }

  let body: { tier?: unknown };
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'body inválido' }, { status: 400 }); }
  const tier = String(body?.tier ?? '').trim();
  if (!tier) return Response.json({ ok: false, error: 'falta la membresía' }, { status: 400 });

  // El plan tiene que existir en la lista vigente y tener su plan de MP
  // cargado: nunca se confía en el tier que manda el navegador.
  const plan = (await planesVigentes(env)).find((p) => p.item === tier);
  if (!plan) return Response.json({ ok: false, error: 'esa membresía no está disponible' }, { status: 404 });
  if (!plan.linkDebito) {
    return Response.json({ ok: false, error: 'esta membresía todavía no tiene el débito habilitado. Escribinos y lo activamos.' }, { status: 409 });
  }

  const situacion = await situacionDelSocio(env, email);

  // La regla de verdad está acá, no en el botón: el navegador puede llamar
  // este endpoint directamente.
  const { estadosAdhesion } = await leerMembresias(env.GENETICAS);
  const veredicto = puedeAdherir(situacion.reprocann, estadosAdhesion, situacion.adhesionHabilitada);
  if (!veredicto.puede) {
    return Response.json({ ok: false, error: veredicto.motivo }, { status: 409 });
  }

  if (situacion.debitoActivo) {
    return Response.json({ ok: false, error: 'ya tenés el débito automático activo' }, { status: 409 });
  }

  // La constancia no puede romper la adhesión: si falla el INSERT, el socio
  // igual se va a Mercado Pago. Peor es dejarlo sin poder adherirse.
  if (situacion.socioId) {
    try {
      const planId = plan.linkDebito.split('preapproval_plan_id=')[1] || null;
      await env.DB.prepare(
        `INSERT INTO envios_debito (socio_id, tier, mp_plan_id, via, enviado_por) VALUES (?, ?, ?, 'autogestion', ?)`,
      ).bind(situacion.socioId, tier, planId, email.toLowerCase()).run();
    } catch { /* la constancia es para el panel, no para el socio */ }
  }

  return Response.json({ ok: true, link: plan.linkDebito, tier, monto: plan.debito ?? plan.contado ?? null });
};
