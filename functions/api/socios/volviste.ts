// La VUELTA de Mercado Pago: el eslabón que le faltaba a la adhesión
// autogestionada.
//
// El circuito viejo terminaba en la nada: el socio autorizaba el débito y
// quedaba parado en la pantalla de MP, y de nuestro lado el webhook tenía que
// adivinar de quién era la suscripción por el payer_email (que MP muchas
// veces no manda). Cuando no podía, la suscripción quedaba huérfana en la
// cola de identificación del panel — pasó con la primera adhesión real.
//
// Ahora los planes llevan back_url apuntando acá: MP redirige al socio con el
// preapproval_id en la query, su cookie de sesión (SameSite=Lax viaja en
// navegaciones top-level) dice QUIÉN es, y la identificación deja de ser una
// adivinanza. La cola del panel queda para lo que le corresponde: pagos
// hechos por terceros.
//
// Seguridad, mismo criterio que el webhook: NUNCA se confía en el id de la
// query; se re-consulta el preapproval a la API de MP con nuestro token, y
// solo se procesa si pertenece a un plan de Flora (descubrirPreapproval
// devuelve 'ajena' y no inserta nada si no lo es). El orden y la idempotencia
// también son los del webhook: los dos pueden llegar en cualquier orden.
import { readSessionEmail } from './_session';
import { descubrirPreapproval, aplicarPreapproval, asegurarMembresiaDebito } from '../mp/webhook';

interface Env {
  SESSION_SECRET: string;
  DB: D1Database;
  MP_ACCESS_TOKEN?: string;
}

const DESTINO = '/socios/membresias/';
const ir = (q = '') =>
  new Response(null, { status: 302, headers: { Location: DESTINO + q } });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const preId = String(url.searchParams.get('preapproval_id') || '').trim();
  // Sin id, sin sesión o sin token: a la página igual, sin drama. El webhook
  // y la cola del panel siguen cubriendo por atrás.
  if (!preId || !/^[a-zA-Z0-9-]+$/.test(preId)) return ir();
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email || !env.MP_ACCESS_TOKEN) return ir();

  const res = await fetch(`https://api.mercadopago.com/preapproval/${preId}`, {
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
  });
  if (!res.ok) return ir();
  const pre = await res.json<Record<string, unknown>>();

  // Si el webhook llegó primero, la fila ya existe y esto no hace nada; si
  // llegamos primero, la crea (con match por email si puede). Idempotente.
  const envMp = env as unknown as Parameters<typeof descubrirPreapproval>[0];
  await descubrirPreapproval(envMp, pre);
  await aplicarPreapproval(envMp, pre);

  const su = await env.DB.prepare(
    `SELECT id, socio_id, estado, tier FROM suscripciones WHERE mp_preapproval_id = ?`,
  ).bind(String(pre.id)).first<{ id: number; socio_id: number | null; estado: string; tier: string | null }>();
  if (!su) return ir(); // plan ajeno a Flora: no es nuestro problema

  const vuelta = su.estado === 'pendiente' ? '?adherido=pendiente' : '?adherido=1';
  const socio = await env.DB.prepare(`SELECT id FROM socios WHERE email = ?`)
    .bind(email.toLowerCase()).first<{ id: number }>();
  if (!socio) return ir(vuelta);

  if (su.socio_id === null) {
    // La identificación con sesión, con el mismo guardarraíl que la cola del
    // panel: si este socio ya tiene otra suscripción viva, no se pisa nada y
    // lo resuelve un humano (caso "pareja que paga las dos").
    const viva = await env.DB.prepare(
      `SELECT id FROM suscripciones WHERE socio_id = ? AND estado IN ('activa','pendiente','pausada') AND id != ?`,
    ).bind(socio.id, su.id).first();
    if (!viva) {
      await env.DB.prepare(
        `UPDATE suscripciones SET socio_id = ?, actualizado = datetime('now') WHERE id = ? AND socio_id IS NULL`,
      ).bind(socio.id, su.id).run();
      let gramos: number | null = null;
      if (su.tier && su.tier !== 'CUOTA SOCIAL' && (su.estado === 'activa' || String(pre.status) === 'authorized')) {
        gramos = await asegurarMembresiaDebito(envMp, socio.id, su.tier);
      }
      // Retro-enganche y racha, calcados de panel/mp identificar.
      await env.DB.prepare(
        `UPDATE movimientos SET socio_id = ?, gramos = COALESCE(?, gramos)
          WHERE suscripcion_id = ? AND socio_id IS NULL AND categoria = 'membresia'`,
      ).bind(socio.id, gramos, su.id).run();
      await env.DB.prepare(
        `UPDATE suscripciones SET racha_meses = (SELECT COUNT(*) FROM movimientos WHERE suscripcion_id = ? AND estado = 'confirmado') WHERE id = ?`,
      ).bind(su.id, su.id).run();
    }
  } else if (su.socio_id === socio.id && su.estado === 'activa' && su.tier && su.tier !== 'CUOTA SOCIAL') {
    // Ya estaba identificada (el webhook matcheó por email): asegurar la
    // membresía igual es gratis, la función es idempotente.
    await asegurarMembresiaDebito(envMp, socio.id, su.tier);
  }

  return ir(vuelta);
};
