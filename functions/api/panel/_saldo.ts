// Cálculo del saldo de gramos de un socio — compartido entre el Mostrador
// (panel) y el portal del paciente (/api/socios/saldo).
// CONTADO no acumula; PLAN prepago acumula dentro de su ventana; DÉBITO
// acumulará desde la suscripción cuando Mercado Pago esté enchufado.

function mesDe(fecha: Date): string {
  return fecha.toISOString().slice(0, 7);
}

function mesesEntre(desde: string, hasta: string): number {
  const a = Number(desde.slice(0, 4)) * 12 + Number(desde.slice(5, 7));
  const b = Number(hasta.slice(0, 4)) * 12 + Number(hasta.slice(5, 7));
  return Math.max(0, b - a);
}

export async function saldoDe(env: { DB: D1Database }, socioId: number) {
  const hoy = new Date();
  const mes = mesDe(hoy);
  const [membs, pagosMes, retMes] = await Promise.all([
    env.DB.prepare(
      `SELECT tier, modalidad, gramos_mes, desde, hasta, nota FROM membresias
        WHERE socio_id = ? AND (hasta IS NULL OR hasta > date('now'))
        ORDER BY modalidad = 'plan' DESC, desde DESC`,
    ).bind(socioId).all(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(gramos), 0) AS g FROM movimientos
        WHERE socio_id = ? AND tipo = 'ingreso' AND estado != 'anulado'
          AND categoria IN ('membresia', 'extra_gramos') AND substr(fecha, 1, 7) = ?`,
    ).bind(socioId, mes).first<{ g: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(gramos), 0) AS g, COUNT(*) AS visitas FROM dispensas
        WHERE socio_id = ? AND substr(fecha, 1, 7) = ? AND gramos > 0`,
    ).bind(socioId, mes).first<{ g: number; visitas: number }>(),
  ]);

  const lista = membs.results as { tier: string; modalidad: string; gramos_mes: number; desde: string; hasta: string | null; nota: string | null }[];
  const plan = lista.find((m) => m.modalidad === 'plan');
  const mensual = lista.find((m) => m.modalidad !== 'plan');

  if (plan && plan.hasta) {
    // Plan prepago: saldo total de la ventana, acumulable.
    const total = (plan.gramos_mes || 0) * mesesEntre(plan.desde, plan.hasta);
    const retirado = await env.DB.prepare(
      `SELECT COALESCE(SUM(gramos), 0) AS g FROM dispensas
        WHERE socio_id = ? AND fecha >= ? AND gramos > 0`,
    ).bind(socioId, plan.desde).first<{ g: number }>();
    return {
      tipo: 'plan', tier: plan.tier, gramosMes: plan.gramos_mes,
      total, retirado: retirado?.g ?? 0, saldo: total - (retirado?.g ?? 0),
      retiradoMes: retMes?.g ?? 0, visitasMes: retMes?.visitas ?? 0,
      hasta: plan.hasta,
    };
  }
  // Contado: gramos habilitados por lo pagado ESTE mes, sin arrastre.
  const habilitado = pagosMes?.g ?? 0;
  return {
    tipo: 'contado', tier: mensual?.tier ?? null, gramosMes: mensual?.gramos_mes ?? null,
    habilitado, retiradoMes: retMes?.g ?? 0, visitasMes: retMes?.visitas ?? 0,
    saldo: habilitado - (retMes?.g ?? 0),
    pagoEsteMes: habilitado > 0,
  };
}

