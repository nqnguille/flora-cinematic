// La ficha 360° de UN socio — todo lo que el drawer del panel necesita en un
// solo viaje: ficha D1, membresía vigente, suscripción de MP relevante,
// último envío del link, actividad reciente y el acceso a la carta (KV).
// Los montos de la actividad solo viajan si el rol puede verlos.
import { requireRol, puede } from './_rol';

interface Env {
  DB: D1Database;
  SOCIOS: KVNamespace;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireRol(request, env, ['dueno', 'socio_ong', 'socio_ong_carga', 'mostrador']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  if (!puede(auth.rol, 'padron_ver')) return json({ error: 'Sin permiso' }, 403);
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isFinite(id)) return json({ error: 'Falta id' }, 400);

  const verPlata = puede(auth.rol, 'finanzas_ver');
  const [socio, membresia, susc, envio, dispensas, movimientos] = await Promise.all([
    env.DB.prepare(`SELECT * FROM socios WHERE id = ? AND (numero IS NULL OR numero != -1)`).bind(id).first<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT tier, modalidad, gramos_mes, desde FROM membresias WHERE socio_id = ? AND hasta IS NULL
        ORDER BY desde DESC LIMIT 1`,
    ).bind(id).first(),
    env.DB.prepare(
      `SELECT id, estado, monto, racha_meses, fin, tier, origen, mp_payer_email FROM suscripciones
        WHERE socio_id = ?
        ORDER BY CASE estado WHEN 'activa' THEN 0 WHEN 'pendiente' THEN 1 WHEN 'pausada' THEN 2 ELSE 3 END,
                 actualizado DESC, id DESC LIMIT 1`,
    ).bind(id).first(),
    env.DB.prepare(
      `SELECT tier, via, enviado FROM envios_debito WHERE socio_id = ? ORDER BY enviado DESC LIMIT 1`,
    ).bind(id).first(),
    env.DB.prepare(
      `SELECT fecha, producto, gramos, unidades FROM dispensas WHERE socio_id = ? ORDER BY fecha DESC, id DESC LIMIT 5`,
    ).bind(id).all(),
    verPlata
      ? env.DB.prepare(
          `SELECT fecha, categoria, concepto, neto, medio, estado FROM movimientos
            WHERE socio_id = ? AND tipo = 'ingreso' ORDER BY fecha DESC, id DESC LIMIT 5`,
        ).bind(id).all()
      : Promise.resolve(null),
  ]);
  if (!socio) return json({ error: 'No existe' }, 404);

  // acceso a la carta: el registro KV de su email (si tiene)
  let carta: Record<string, unknown> | null = null;
  if (socio.email) {
    try {
      const crudo = await env.SOCIOS.get(String(socio.email).toLowerCase());
      if (crudo === 'ok') carta = {};
      else if (crudo) carta = JSON.parse(crudo);
    } catch { carta = null; }
  }

  return json({
    ok: true,
    socio,
    membresia: membresia || null,
    debito: susc ? { ...susc, ultimo_envio: envio || null } : (envio ? { estado: null, ultimo_envio: envio } : null),
    dispensas: dispensas.results,
    movimientos: movimientos ? movimientos.results : null,
    carta: carta ? {
      acceso: true, lastLogin: carta.lastLogin || null, logins: carta.logins || 0,
      temporal: !!carta.temporal, tempExpiraEn: carta.tempExpiraEn || null,
    } : { acceso: false },
  });
};
