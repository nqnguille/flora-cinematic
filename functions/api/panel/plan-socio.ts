// Venderle un plan prepago a un socio.
//
// El plan prepago se paga entero por adelantado y le deja al socio un saldo de
// gramos a favor que retira cuando quiere durante N meses. Lo que no retira en
// un mes NO se pierde: queda para el siguiente. Eso ya lo calculaba `_saldo`,
// pero no había forma de asignarle uno a nadie sin escribir en la base a mano.
//
//   GET  ?socio_id=X   → planes disponibles + qué tiene hoy ese socio
//   POST {socio_id, item, desde, cobro, monto, medio}
//        → cierra la mensual vigente, crea la membresía del plan y registra el pago
//   DELETE {membresia_id} → cancela un plan asignado por error
import { requireCap } from './_rol';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Suma meses a un YYYY-MM-DD sin depender de la zona horaria. */
function sumarMeses(fecha: string, meses: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const total = (a * 12 + (m - 1)) + meses;
  const anio = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  // si el día no existe en el mes destino (31 → febrero), cae al último
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dia = Math.min(d, ultimo);
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'padron_editar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const socioId = Number(new URL(request.url).searchParams.get('socio_id'));
  if (!Number.isFinite(socioId)) return json({ error: 'Falta socio_id' }, 400);

  const [planes, actual, mensual] = await Promise.all([
    env.DB.prepare(
      `SELECT p.item, p.plan_gramos_mes, p.plan_meses, p.gramos, p.contado, p.valor_usd
         FROM precios p JOIN listas_precios l ON l.id = p.lista_id
        WHERE p.tipo = 'plan' AND l.vigente_desde <= date('now')
          AND l.id = (SELECT id FROM listas_precios WHERE vigente_desde <= date('now')
                       ORDER BY vigente_desde DESC, id DESC LIMIT 1)
        ORDER BY p.contado`,
    ).all(),
    env.DB.prepare(
      `SELECT id, tier, gramos_mes, desde, hasta FROM membresias
        WHERE socio_id = ? AND modalidad = 'plan' AND (hasta IS NULL OR hasta >= date('now'))
        ORDER BY desde DESC LIMIT 1`,
    ).bind(socioId).first(),
    env.DB.prepare(
      `SELECT id, tier, modalidad FROM membresias
        WHERE socio_id = ? AND hasta IS NULL AND modalidad != 'plan' LIMIT 1`,
    ).bind(socioId).first(),
  ]);

  return json({ ok: true, planes: planes.results, actual: actual || null, mensual: mensual || null });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'padron_editar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);

  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const socioId = Number(b.socio_id);
  const item = String(b.item || '').trim();
  if (!Number.isFinite(socioId)) return json({ error: 'Falta socio_id' }, 400);
  if (!item) return json({ error: 'Elegí un plan' }, 400);

  const socio = await env.DB.prepare(`SELECT id, nombre FROM socios WHERE id = ?`).bind(socioId).first<{ id: number; nombre: string }>();
  if (!socio) return json({ error: 'El socio no existe' }, 404);

  const plan = await env.DB.prepare(
    `SELECT p.item, p.plan_gramos_mes, p.plan_meses, p.contado
       FROM precios p JOIN listas_precios l ON l.id = p.lista_id
      WHERE p.tipo = 'plan' AND p.item = ? AND l.vigente_desde <= date('now')
      ORDER BY l.vigente_desde DESC, l.id DESC LIMIT 1`,
  ).bind(item).first<{ item: string; plan_gramos_mes: number | null; plan_meses: number | null; contado: number | null }>();
  if (!plan) return json({ error: 'Ese plan no está en la lista vigente' }, 404);
  if (!plan.plan_gramos_mes || !plan.plan_meses) {
    return json({ error: `A «${item}» le falta el reparto (gramos por mes y meses). Completalo en Membresías.` }, 400);
  }

  // Un plan vivo por vez: dos superpuestos harían que el saldo cuente dos
  // veces la misma ventana y nadie entendería de dónde salen los gramos.
  const yaTiene = await env.DB.prepare(
    `SELECT id, tier, hasta FROM membresias
      WHERE socio_id = ? AND modalidad = 'plan' AND (hasta IS NULL OR hasta >= date('now'))`,
  ).bind(socioId).first<{ id: number; tier: string; hasta: string }>();
  if (yaTiene) {
    return json({ error: `${socio.nombre} ya tiene el plan ${yaTiene.tier} hasta el ${yaTiene.hasta}. Cancelalo primero.` }, 409);
  }

  const desde = String(b.desde || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return json({ error: 'Fecha inválida' }, 400);
  const hasta = sumarMeses(desde, plan.plan_meses);

  // La mensual se cierra: el prepago la reemplaza mientras dure. Si no, el
  // socio figuraría debiendo la cuota de cada mes además de haber pagado todo
  // por adelantado.
  await env.DB.prepare(
    `UPDATE membresias SET hasta = ? WHERE socio_id = ? AND hasta IS NULL AND modalidad != 'plan'`,
  ).bind(desde, socioId).run();

  const ins = await env.DB.prepare(
    `INSERT INTO membresias (socio_id, tier, modalidad, gramos_mes, desde, hasta)
     VALUES (?, ?, 'plan', ?, ?, ?)`,
  ).bind(socioId, plan.item, plan.plan_gramos_mes, desde, hasta).run();

  // El pago. `cobro: 'ninguno'` es para cargar un plan que ya se había pagado
  // antes de que existiera esta pantalla, sin duplicar el ingreso.
  const cobro = String(b.cobro || 'ninguno');
  let movimientoId: number | null = null;
  if (cobro !== 'ninguno') {
    const monto = Math.round(Number(b.monto) || plan.contado || 0);
    if (monto <= 0) return json({ error: 'Poné el importe cobrado' }, 400);
    const medio = ['efectivo', 'transferencia', 'mp'].includes(cobro) ? cobro : 'efectivo';
    const total = plan.plan_gramos_mes * plan.plan_meses;
    const mov = await env.DB.prepare(
      `INSERT INTO movimientos (fecha, tipo, categoria, concepto, socio_id, neto, medio, estado, gramos, origen, cargado_por)
       VALUES (?, 'ingreso', 'membresia', ?, ?, ?, ?, 'confirmado', ?, 'manual', ?)`,
    ).bind(desde, `${plan.item} — plan prepago (${total} g hasta ${hasta})`, socioId, monto, medio, total, auth.email).run();
    movimientoId = Number(mov.meta?.last_row_id);
  }

  return json({
    ok: true,
    membresia_id: Number(ins.meta?.last_row_id),
    movimiento_id: movimientoId,
    desde, hasta,
    gramos_mes: plan.plan_gramos_mes,
    total: plan.plan_gramos_mes * plan.plan_meses,
  });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'padron_editar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const id = Number(b.membresia_id);
  if (!Number.isFinite(id)) return json({ error: 'Falta membresia_id' }, 400);
  // Se corta hoy, no se borra: los retiros que ya se hicieron contra ese plan
  // tienen que seguir teniendo contra qué haberse hecho.
  await env.DB.prepare(
    `UPDATE membresias SET hasta = date('now') WHERE id = ? AND modalidad = 'plan'`,
  ).bind(id).run();
  return json({ ok: true });
};
