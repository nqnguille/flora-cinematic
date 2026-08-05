// Editor de los planes de membresía: gramos, importes y el link de suscripción
// de Mercado Pago.
//
// Dos cuidados que hacen a la plata y que están cableados acá:
//
// 1. NO se pisa la lista de precios vigente. Cambiar importes crea una lista
//    nueva con su fecha, porque Finanzas calcula la deuda de cada mes con la
//    lista que regía ESE mes: pisar la actual reescribiría el pasado. Si ya
//    existe una lista para la fecha elegida, esa se edita.
//
// 2. El link de Mercado Pago se VERIFICA contra su API antes de guardar. El
//    importe que se cobra de verdad vive del lado de ellos; esta tabla era una
//    copia a mano que nadie chequeaba, así que se podía prometer un precio en
//    el mail y cobrar otro. Ahora, si no coinciden, se avisa.
//
//   GET                       → planes de la lista vigente + listas + estado MP
//   POST {plan}               → guarda un plan (crea lista nueva si hace falta)
//   POST {verificar, link}    → consulta el plan en MP sin guardar nada
import { requireCap } from './_rol';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
  MP_ACCESS_TOKEN?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Del link de suscripción sale el id del plan; también se acepta el id pelado. */
export function idDePlan(v: string): string | null {
  const s = String(v || '').trim();
  if (!s) return null;
  const m = s.match(/preapproval_plan_id=([a-zA-Z0-9]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9]{16,}$/.test(s) ? s : null;
}

interface PlanMP {
  id: string;
  reason?: string;
  status?: string;
  subscribed?: number;
  init_point?: string;
  auto_recurring?: { transaction_amount?: number; frequency?: number; frequency_type?: string; repetitions?: number };
}

/** Le pregunta a Mercado Pago cuánto cobra de verdad ese plan. */
async function consultarMP(env: Env, planId: string): Promise<{ ok: true; plan: PlanMP } | { ok: false; error: string }> {
  if (!env.MP_ACCESS_TOKEN) return { ok: false, error: 'falta el token de Mercado Pago' };
  try {
    const r = await fetch(`https://api.mercadopago.com/preapproval_plan/${planId}`, {
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
    });
    if (r.status === 404) return { ok: false, error: 'ese plan no existe en Mercado Pago' };
    if (!r.ok) return { ok: false, error: `Mercado Pago respondió ${r.status}` };
    return { ok: true, plan: await r.json<PlanMP>() };
  } catch {
    return { ok: false, error: 'no se pudo consultar Mercado Pago' };
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'catalogo_editar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);

  const lista = await env.DB.prepare(
    `SELECT id, vigente_desde, nota FROM listas_precios WHERE vigente_desde <= date('now')
      ORDER BY vigente_desde DESC, id DESC LIMIT 1`,
  ).first<{ id: number; vigente_desde: string; nota: string | null }>();

  const [planes, listas] = await Promise.all([
    lista
      ? env.DB.prepare(
          `SELECT item, tipo, gramos, contado, debito, cupo, mp_plan_id, valor_usd,
                  plan_gramos_mes, plan_meses
             FROM precios WHERE lista_id = ? AND tipo IN ('membresia','cuota_ong','plan')
            ORDER BY tipo, gramos, item`,
        ).bind(lista.id).all()
      : Promise.resolve({ results: [] }),
    env.DB.prepare(
      `SELECT l.id, l.vigente_desde, l.nota, COUNT(p.id) AS items
         FROM listas_precios l LEFT JOIN precios p ON p.lista_id = l.id
        GROUP BY l.id ORDER BY l.vigente_desde DESC LIMIT 12`,
    ).all(),
  ]);

  // cuántos socios tiene viva cada suscripción, para avisar antes de tocar algo
  const susc = await env.DB.prepare(
    `SELECT tier, COUNT(*) AS n FROM suscripciones WHERE estado IN ('activa','pendiente','pausada') GROUP BY tier`,
  ).all<{ tier: string; n: number }>().catch(() => ({ results: [] as { tier: string; n: number }[] }));

  return json({
    ok: true,
    lista,
    planes: planes.results,
    listas: listas.results,
    suscripciones: Object.fromEntries(susc.results.map((s) => [s.tier, s.n])),
    mp_configurado: !!env.MP_ACCESS_TOKEN,
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'catalogo_editar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);

  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // ---- solo verificar un link, sin guardar ----
  if (b.verificar) {
    const id = idDePlan(String(b.link || ''));
    if (!id) return json({ error: 'Ese no parece un link de plan de Mercado Pago' }, 400);
    const r = await consultarMP(env, id);
    if (!r.ok) return json({ error: r.error }, 400);
    return json({
      ok: true, mp_plan_id: id,
      nombre: r.plan.reason || null,
      importe: r.plan.auto_recurring?.transaction_amount ?? null,
      cuotas: r.plan.auto_recurring?.repetitions ?? null,
      estado: r.plan.status || null,
      adheridos: r.plan.subscribed ?? null,
    });
  }

  // ---- guardar un plan ----
  const item = String(b.item || '').trim().toUpperCase();
  if (!item) return json({ error: 'Falta el nombre del plan' }, 400);
  const tipo = ['membresia', 'plan', 'cuota_ong'].includes(String(b.tipo || ''))
    ? String(b.tipo) : 'membresia';

  // Prepago: se pagan por adelantado y dan un saldo de gramos a favor que el
  // socio retira a lo largo de N meses. El total sale del reparto, no se
  // escribe a mano: si no, el nombre, el total y la vigencia se desincronizan.
  const gxMes = b.plan_gramos_mes === undefined || b.plan_gramos_mes === '' ? null : Number(b.plan_gramos_mes);
  const meses = b.plan_meses === undefined || b.plan_meses === '' ? null : Math.round(Number(b.plan_meses));
  if (gxMes !== null && (!Number.isFinite(gxMes) || gxMes <= 0)) return json({ error: 'Gramos por mes inválidos' }, 400);
  if (meses !== null && (!Number.isFinite(meses) || meses <= 0 || meses > 60)) return json({ error: 'Los meses tienen que ir de 1 a 60' }, 400);
  if (tipo === 'plan' && (gxMes === null || meses === null)) {
    return json({ error: 'Un plan prepago necesita gramos por mes y cantidad de meses' }, 400);
  }
  const usd = b.valor_usd === undefined || b.valor_usd === '' ? null : Number(b.valor_usd);
  if (usd !== null && (!Number.isFinite(usd) || usd < 0)) return json({ error: 'Referencia en dólares inválida' }, 400);
  let gramos = b.gramos === null || b.gramos === '' ? null : Number(b.gramos);
  if (tipo === 'plan' && gxMes !== null && meses !== null) gramos = gxMes * meses;
  const contado = b.contado === null || b.contado === '' ? null : Math.round(Number(b.contado));
  const debito = b.debito === null || b.debito === '' ? null : Math.round(Number(b.debito));
  if (gramos !== null && (!Number.isFinite(gramos) || gramos < 0)) return json({ error: 'Gramos inválidos' }, 400);
  if (contado !== null && (!Number.isFinite(contado) || contado < 0)) return json({ error: 'Importe de contado inválido' }, 400);
  if (debito !== null && (!Number.isFinite(debito) || debito < 0)) return json({ error: 'Importe de débito inválido' }, 400);

  const mpPlanId = 'link' in b ? idDePlan(String(b.link || '')) : undefined;
  if ('link' in b && String(b.link || '').trim() && !mpPlanId) {
    return json({ error: 'Ese no parece un link de plan de Mercado Pago' }, 400);
  }

  // Si viene link, se verifica contra MP y se compara el importe. No se
  // bloquea el guardado: a veces se quiere corregir el precio primero y el
  // plan después. Pero el aviso viaja para que se vea en el panel.
  let avisoMP: string | null = null;
  if (mpPlanId) {
    const r = await consultarMP(env, mpPlanId);
    if (!r.ok) return json({ error: r.error }, 400);
    const cobra = r.plan.auto_recurring?.transaction_amount;
    if (r.plan.status && r.plan.status !== 'active') avisoMP = `El plan está ${r.plan.status} en Mercado Pago.`;
    else if (debito !== null && cobra != null && Math.round(cobra) !== debito) {
      avisoMP = `Ojo: Mercado Pago cobra $${Math.round(cobra).toLocaleString('es-AR')} y acá dice $${debito.toLocaleString('es-AR')}.`;
    }
  }

  // La fecha decide en qué lista entra. Sin fecha, hoy.
  const desde = String(b.vigente_desde || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return json({ error: 'Fecha inválida' }, 400);

  let lista = await env.DB.prepare(`SELECT id FROM listas_precios WHERE vigente_desde = ?`)
    .bind(desde).first<{ id: number }>();

  if (!lista) {
    // Lista nueva: se copia la vigente entera. Si solo se insertara el ítem
    // editado, el resto de los planes desaparecería de la lista nueva y con
    // ellos su mp_plan_id, que es lo que hace que el webhook reconozca los
    // pagos entrantes.
    const anterior = await env.DB.prepare(
      `SELECT id FROM listas_precios WHERE vigente_desde <= ? ORDER BY vigente_desde DESC, id DESC LIMIT 1`,
    ).bind(desde).first<{ id: number }>();
    const ins = await env.DB.prepare(
      `INSERT INTO listas_precios (vigente_desde, nota, creada_por) VALUES (?, ?, ?)`,
    ).bind(desde, String(b.nota || '').slice(0, 200) || 'editada desde el panel', auth.email).run();
    lista = { id: Number(ins.meta?.last_row_id) };
    if (anterior) {
      await env.DB.prepare(
        `INSERT INTO precios (lista_id, item, tipo, gramos, valor_usd, contado, debito, cupo, mp_plan_id)
         SELECT ?, item, tipo, gramos, valor_usd, contado, debito, cupo, mp_plan_id FROM precios WHERE lista_id = ?`,
      ).bind(lista.id, anterior.id).run();
    }
  }

  const existe = await env.DB.prepare(`SELECT id, mp_plan_id FROM precios WHERE lista_id = ? AND item = ?`)
    .bind(lista.id, item).first<{ id: number; mp_plan_id: string | null }>();

  if (existe) {
    const campos: string[] = [];
    const vals: (string | number | null)[] = [];
    if (b.gramos !== undefined || tipo === 'plan') { campos.push('gramos = ?'); vals.push(gramos); }
    if (b.plan_gramos_mes !== undefined) { campos.push('plan_gramos_mes = ?'); vals.push(gxMes); }
    if (b.plan_meses !== undefined) { campos.push('plan_meses = ?'); vals.push(meses); }
    if (b.valor_usd !== undefined) { campos.push('valor_usd = ?'); vals.push(usd); }
    if (b.contado !== undefined) { campos.push('contado = ?'); vals.push(contado); }
    if (b.debito !== undefined) { campos.push('debito = ?'); vals.push(debito); }
    if (mpPlanId !== undefined) { campos.push('mp_plan_id = ?'); vals.push(mpPlanId); }
    if (campos.length) {
      await env.DB.prepare(`UPDATE precios SET ${campos.join(', ')} WHERE id = ?`).bind(...vals, existe.id).run();
    }
  } else {
    await env.DB.prepare(
      `INSERT INTO precios (lista_id, item, tipo, gramos, contado, debito, mp_plan_id,
                            valor_usd, plan_gramos_mes, plan_meses)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(lista.id, item, tipo, gramos, contado, debito, mpPlanId || null, usd, gxMes, meses).run();
  }

  return json({ ok: true, lista_id: lista.id, vigente_desde: desde, aviso: avisoMP });
};
