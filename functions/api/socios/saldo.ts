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
    `SELECT id, nombre FROM socios WHERE email = ? AND numero != -1`,
  ).bind(email.toLowerCase()).first<{ id: number; nombre: string }>();
  if (!socio) {
    // Todavía no está enganchado al padrón financiero: sin tarjeta de saldo.
    return Response.json({ ok: true, vinculado: false });
  }
  const [saldo, retiros] = await Promise.all([
    saldoDe(env, socio.id),
    env.DB.prepare(
      `SELECT fecha, producto, gramos, unidades FROM dispensas
        WHERE socio_id = ? AND gramos > 0 ORDER BY fecha DESC, id DESC LIMIT 6`,
    ).bind(socio.id).all(),
  ]);
  // Solo gramos: nada de montos, deuda ni precios en esta respuesta.
  return Response.json({
    ok: true, vinculado: true, nombre: socio.nombre,
    saldo: {
      tipo: saldo.tipo, saldo: Math.max(0, saldo.saldo),
      retiradoMes: saldo.retiradoMes, visitasMes: saldo.visitasMes,
      base: saldo.tipo === 'plan' ? saldo.total : saldo.habilitado,
      hasta: 'hasta' in saldo ? saldo.hasta : null,
    },
    retiros: retiros.results,
  });
};
