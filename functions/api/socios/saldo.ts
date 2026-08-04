// Saldo de gramos para el PACIENTE en su portal (/socios/cuenta).
// Decisión de Guille (30/07/2026): el socio ve SOLO sus gramos y sus
// retiros — la plata (deuda, pagos, balances) queda puertas adentro.
import { readSessionEmail } from './_session';
import { saldoDe } from '../panel/_saldo';

interface Env {
  DB: D1Database;
  SOCIOS: KVNamespace;
  SESSION_SECRET: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return Response.json({ error: 'Sin sesión' }, { status: 401 });
  // tiene que seguir siendo socio vigente de la carta
  const esSocio = await env.SOCIOS.get(email.toLowerCase());
  if (!esSocio) return Response.json({ error: 'Sin acceso' }, { status: 403 });

  const socio = await env.DB.prepare(
    `SELECT id, nombre, alta FROM socios WHERE email = ? AND (numero IS NULL OR numero != -1)`,
  ).bind(email.toLowerCase()).first<{ id: number; nombre: string; alta: string | null }>();
  if (!socio) {
    // Todavía no está enganchado al padrón financiero: sin tarjeta de saldo.
    return Response.json({ ok: true, vinculado: false });
  }
  const [saldo, retiros] = await Promise.all([
    saldoDe(env, socio.id),
    // TODOS los retiros: flores (gramos) y también aceites/cremas/cartuchos
    // (unidades) — antes el filtro gramos > 0 los hacía invisibles.
    env.DB.prepare(
      `SELECT fecha, producto, gramos, unidades FROM dispensas
        WHERE socio_id = ? ORDER BY fecha DESC, id DESC LIMIT 30`,
    ).bind(socio.id).all(),
  ]);
  // Solo gramos: nada de montos, deuda ni precios en esta respuesta.
  // (pagoEsteMes es un sí/no de "cuota al día", sin importes.)
  return Response.json({
    ok: true, vinculado: true, nombre: socio.nombre, desde: socio.alta,
    saldo: {
      tipo: saldo.tipo, saldo: Math.max(0, saldo.saldo),
      tier: saldo.tier || null, gramosMes: saldo.gramosMes || null,
      retiradoMes: saldo.retiradoMes, visitasMes: saldo.visitasMes,
      // Referencia contra la que se dibuja la barra. En débito es lo acumulado,
      // no lo del mes: si no, alguien que juntó dos meses vería la barra llena.
      base: saldo.tipo === 'plan' ? saldo.total : saldo.tipo === 'debito' ? saldo.acumulado : saldo.habilitado,
      acumulado: saldo.tipo === 'debito' ? saldo.acumulado : null,
      tope: saldo.tipo === 'debito' ? saldo.tope : null,
      hasta: 'hasta' in saldo ? saldo.hasta : null,
      // En débito la cuota la cobra Mercado Pago sola: no tiene sentido
      // mostrarle "sin pago este mes" a quien tiene el débito andando.
      alDia: saldo.tipo === 'plan' || saldo.tipo === 'debito' ? true : !!(saldo as { pagoEsteMes?: boolean }).pagoEsteMes,
    },
    retiros: retiros.results,
  });
};
