// Webhook de Mercado Pago (público). Nunca confía en el payload: con el id
// que llega, re-consulta a la API de MP con nuestro token — esa es la
// verificación de autenticidad. Idempotente: un pago se registra una sola vez.
//
// Al acreditarse un pago de suscripción:
//   1. entra el movimiento (ingreso membresía, confirmado, medio mp, ref=payment_id)
//   2. habilita los gramos del tier (el saldo del socio se mueve solo)
//   3. suma 1 a la racha del débito (cada 3 seguidos, el 20% se renueva)
interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN?: string;
}

const MP = 'https://api.mercadopago.com';

async function mpGet(env: Env, path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(MP + path, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
  if (!res.ok) return null;
  return res.json();
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // MP espera un 200/201 rápido; cualquier otra cosa la reintenta.
  if (!env.MP_ACCESS_TOKEN) return new Response('sin configurar', { status: 200 });
  let body: { type?: string; topic?: string; data?: { id?: string }; resource?: string };
  try { body = await request.json(); } catch { return new Response('ok', { status: 200 }); }
  const tipo = body.type || body.topic || '';
  const id = body.data?.id || (body.resource ? String(body.resource).split('/').pop() : null);
  if (!id) return new Response('ok', { status: 200 });

  try {
    if (tipo === 'payment') {
      const pago = await mpGet(env, `/v1/payments/${id}`);
      if (!pago || pago.status !== 'approved') return new Response('ok', { status: 200 });
      const ref = `mp:${pago.id}`;
      const ya = await env.DB.prepare(`SELECT id FROM movimientos WHERE ref = ?`).bind(ref).first();
      if (ya) return new Response('ok', { status: 200 });

      // socio por external_reference ("socio:<id>") o por email del pagador
      let socioId: number | null = null;
      const ext = String(pago.external_reference || '');
      if (ext.startsWith('socio:')) socioId = Number(ext.slice(6)) || null;
      if (!socioId) {
        const email = String((pago.payer as Record<string, unknown> | undefined)?.email || '').toLowerCase();
        if (email) {
          const s = await env.DB.prepare(`SELECT id FROM socios WHERE email = ?`).bind(email).first<{ id: number }>();
          socioId = s?.id ?? null;
        }
      }
      const bruto = Math.round(Number(pago.transaction_amount) || 0);
      const detalles = pago.transaction_details as Record<string, unknown> | undefined;
      const neto = Math.round(Number(detalles?.net_received_amount) || bruto);
      const esRecurrente = pago.operation_type === 'recurring_payment';
      // gramos del tier vigente del socio (si lo conocemos)
      let gramos: number | null = null;
      let tier = '';
      if (socioId) {
        const m = await env.DB.prepare(
          `SELECT tier, gramos_mes FROM membresias WHERE socio_id = ? AND hasta IS NULL AND modalidad != 'plan'
            ORDER BY desde DESC LIMIT 1`,
        ).bind(socioId).first<{ tier: string; gramos_mes: number }>();
        gramos = m?.gramos_mes ?? null;
        tier = m?.tier ?? '';
      }
      await env.DB.prepare(
        `INSERT INTO movimientos (fecha, tipo, categoria, concepto, socio_id, bruto, comision, neto, medio, estado, gramos, origen, ref, cargado_por)
         VALUES (date('now'), 'ingreso', 'membresia', ?, ?, ?, ?, ?, 'mp', 'confirmado', ?, 'mp_webhook', ?, 'mercadopago')`,
      ).bind(
        esRecurrente ? `Débito automático${tier ? ' ' + tier : ''}` : String(pago.description || 'Pago Mercado Pago').slice(0, 200),
        socioId, bruto, bruto - neto, neto, gramos, ref,
      ).run();

      if (esRecurrente && socioId) {
        // racha del 20%: un débito acreditado más
        await env.DB.prepare(
          `UPDATE suscripciones SET racha_meses = racha_meses + 1, estado = 'activa', actualizado = datetime('now')
            WHERE socio_id = ? AND estado IN ('activa', 'pendiente')`,
        ).bind(socioId).run();
        // débito acumula: la modalidad del socio pasa a débito si no lo era
        await env.DB.prepare(
          `UPDATE membresias SET modalidad = 'debito' WHERE socio_id = ? AND hasta IS NULL AND modalidad = 'contado'`,
        ).bind(socioId).run();
        // ¿completó un ciclo de 3? El 20% se renueva: la suscripción se
        // extiende otros 3 meses sola (si corta, el end_date la termina).
        const su = await env.DB.prepare(
          `SELECT mp_preapproval_id, racha_meses FROM suscripciones
            WHERE socio_id = ? AND estado = 'activa' ORDER BY actualizado DESC LIMIT 1`,
        ).bind(socioId).first<{ mp_preapproval_id: string; racha_meses: number }>();
        if (su && su.racha_meses > 0 && su.racha_meses % 3 === 0) {
          const fin = new Date();
          fin.setMonth(fin.getMonth() + 3);
          fin.setDate(fin.getDate() + 10);
          await fetch(`${MP}/preapproval/${su.mp_preapproval_id}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ auto_recurring: { end_date: fin.toISOString() } }),
          });
        }
      }
      return new Response('ok', { status: 201 });
    }

    if (tipo === 'subscription_preapproval') {
      const pre = await mpGet(env, `/preapproval/${id}`);
      if (!pre) return new Response('ok', { status: 200 });
      const ESTADO: Record<string, string> = { authorized: 'activa', paused: 'pausada', cancelled: 'cancelada', pending: 'pendiente' };
      const estado = ESTADO[String(pre.status)] || 'pendiente';
      await env.DB.prepare(
        `UPDATE suscripciones SET estado = ?, actualizado = datetime('now') WHERE mp_preapproval_id = ?`,
      ).bind(estado, String(pre.id)).run();
      // Recién autorizada: ajustar el fin EXACTO a 3 cuotas desde la
      // autorización (cobros en el mes 0, 1 y 2 + 20 días de margen).
      if (estado === 'activa') {
        const fin = new Date();
        fin.setMonth(fin.getMonth() + 2);
        fin.setDate(fin.getDate() + 20);
        await fetch(`${MP}/preapproval/${pre.id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ auto_recurring: { end_date: fin.toISOString() } }),
        }).catch(() => { /* si falla, queda el end_date de la creación (con margen) */ });
      }
      // si se cancela, la racha vuelve a cero: el 20% se pierde (decisión 30/07)
      if (estado === 'cancelada') {
        await env.DB.prepare(
          `UPDATE suscripciones SET racha_meses = 0 WHERE mp_preapproval_id = ?`,
        ).bind(String(pre.id)).run();
      }
      return new Response('ok', { status: 201 });
    }
  } catch {
    // nunca hacer fallar el webhook: MP reintenta solo y el panel tiene "sincronizar"
  }
  return new Response('ok', { status: 200 });
};
