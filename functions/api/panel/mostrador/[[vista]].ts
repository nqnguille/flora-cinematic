// Mostrador — el panel como mostrador del club:
//   GET  /api/panel/mostrador/buscar?q=          (socios del padrón)
//   GET  /api/panel/mostrador/socio?id=          (ficha + saldo de gramos)
//   GET  /api/panel/mostrador/catalogo           (genéticas activas + stock)
//   POST /api/panel/mostrador/retiro             (registra dispensa, descuenta stock)
//   GET  /api/panel/mostrador/stock              (kardex: saldo por ítem)
//   POST /api/panel/mostrador/stock              (entrada: cosecha/compra/ajuste/merma)
//
// Saldo de gramos (decisión 30/07): CONTADO no acumula — habilita los gramos
// pagados en el mes y a fin de mes se van; PLAN prepago acumula dentro de su
// ventana (total del plan menos retirado); DÉBITO acumulará desde la
// suscripción (cuando MP esté enchufado).
import { requireCap, puede } from '../_rol';
import { saldoDe } from '../_saldo';

interface Env {
  DB: D1Database;
  GENETICAS: KVNamespace;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireCap(request, env, ['mostrador_operar', 'finanzas_ver']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;
  const url = new URL(request.url);

  if (vista === 'buscar') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) return json({ ok: true, socios: [] });
    const rows = await env.DB.prepare(
      `SELECT s.id, s.numero, s.nombre, s.email, s.estado, s.reprocann_estado,
              (SELECT tier FROM membresias m WHERE m.socio_id = s.id AND m.hasta IS NULL ORDER BY m.desde DESC LIMIT 1) AS tier
         FROM socios s
        WHERE (s.numero IS NULL OR s.numero != -1) AND s.papelera IS NULL AND (s.nombre LIKE '%' || ?1 || '%' OR s.email LIKE '%' || ?1 || '%')
        ORDER BY s.estado = 'activo' DESC, s.nombre LIMIT 12`,
    ).bind(q).all();
    return json({ ok: true, socios: rows.results });
  }

  if (vista === 'socio') {
    const id = Number(url.searchParams.get('id'));
    if (!Number.isFinite(id)) return json({ error: 'Falta id' }, 400);
    const socio = await env.DB.prepare(
      `SELECT id, numero, nombre, email, estado, reprocann, nota,
              reprocann_estado, reprocann_vence FROM socios WHERE id = ?`,
    ).bind(id).first();
    if (!socio) return json({ error: 'No existe' }, 404);
    const [saldo, ultimos] = await Promise.all([
      saldoDe(env, id),
      env.DB.prepare(
        `SELECT fecha, producto, gramos, unidades, nota FROM dispensas
          WHERE socio_id = ? ORDER BY fecha DESC, id DESC LIMIT 8`,
      ).bind(id).all(),
    ]);
    return json({ ok: true, socio, saldo, ultimos: ultimos.results });
  }

  if (vista === 'catalogo') {
    const [kv, stock] = await Promise.all([
      env.GENETICAS.get('catalogo', 'json') as Promise<{ id: string; nombre: string; activo: boolean; formatos?: string[] }[] | null>,
      env.DB.prepare(`SELECT item, ROUND(SUM(cantidad), 1) AS saldo FROM stock_mov WHERE clase = 'flor' GROUP BY item`).all(),
    ]);
    const saldos: Record<string, number> = {};
    for (const s of stock.results as { item: string; saldo: number }[]) saldos[s.item] = s.saldo;
    const geneticas = (kv || [])
      .filter((g) => g.activo)
      .map((g) => ({ id: g.id, nombre: g.nombre, formatos: g.formatos || ['flor'], stock: saldos[g.id] ?? null }));
    return json({ ok: true, geneticas });
  }

  if (vista === 'stock') {
    const [porItem, kv] = await Promise.all([
      env.DB.prepare(
        `SELECT item, clase, ROUND(SUM(cantidad), 1) AS saldo,
                MAX(CASE WHEN cantidad > 0 THEN fecha END) AS ultima_entrada
           FROM stock_mov GROUP BY item, clase
           ORDER BY clase = 'flor' DESC, saldo DESC`,
      ).all(),
      env.GENETICAS.get('catalogo', 'json') as Promise<{ id: string; nombre: string; activo: boolean }[] | null>,
    ]);
    const nombres: Record<string, string> = {};
    for (const g of kv || []) nombres[g.id] = g.nombre;
    const items = (porItem.results as Record<string, unknown>[]).map((r) => ({
      ...r, nombre: nombres[r.item as string] || (r.item as string),
      enCatalogo: !!nombres[r.item as string],
    }));
    return json({ ok: true, items });
  }

  return json({ error: 'Vista desconocida' }, 404);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireCap(request, env, ['mostrador_operar', 'catalogo_editar']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  if (vista === 'retiro') {
    if (!puede(auth.rol, 'mostrador_operar')) return json({ error: 'Sin permiso' }, 403);
    const socioId = Number(body.socio_id);
    const items = Array.isArray(body.items) ? body.items as { item?: string; nombre?: string; gramos?: number; unidades?: number; clase?: string }[] : [];
    const nota = body.nota ? String(body.nota).slice(0, 300) : null;
    if (!Number.isFinite(socioId) || !items.length) return json({ error: 'Faltan socio o ítems' }, 400);
    // Regla de negocio (08/08/2026): los pre-rolls solo se entregan con
    // membresía SMALL, y cada uno vale 1 g del saldo (en los otros tiers los
    // costos no cierran). La clase 'preroll' la manda el mostrador o se
    // detecta por nombre para las cargas viejas.
    const esPreroll = (it: { clase?: string; nombre?: string; item?: string }) =>
      it.clase === 'preroll' || /pre.?rol/i.test(String(it.nombre || it.item || ''));
    if (items.some(esPreroll)) {
      const memb = await env.DB.prepare(
        `SELECT tier FROM membresias WHERE socio_id = ? AND (hasta IS NULL OR hasta > date('now')) AND modalidad != 'plan'
          ORDER BY desde DESC LIMIT 1`,
      ).bind(socioId).first<{ tier: string }>();
      if (memb && memb.tier !== 'SMALL') {
        return json({ error: `Los pre-rolls van solo con la membresía SMALL (esta es ${memb.tier}): en los otros planes los costos no cierran.` }, 400);
      }
    }
    const hoy = new Date().toISOString().slice(0, 10);
    for (const it of items) {
      let gramos = it.gramos != null ? Number(it.gramos) : null;
      const unidades = it.unidades != null ? Number(it.unidades) : null;
      // preroll: descuenta del saldo como 1 g por unidad
      if (esPreroll(it) && (gramos == null || gramos <= 0) && unidades) gramos = unidades;
      if ((gramos == null || gramos <= 0 || gramos > 200) && (unidades == null || unidades <= 0 || unidades > 50)) {
        return json({ error: `Cantidad inválida en ${it.nombre || it.item}` }, 400);
      }
      const disp = await env.DB.prepare(
        `INSERT INTO dispensas (fecha, socio_id, genetica_id, producto, gramos, unidades, nota, cargado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(hoy, socioId, it.item || null, it.nombre || it.item || '—', gramos, unidades, nota, auth.email).run();
      // salida de stock atada a la dispensa
      await env.DB.prepare(
        `INSERT INTO stock_mov (fecha, item, clase, cantidad, motivo, dispensa_id, cargado_por)
         VALUES (?, ?, ?, ?, 'dispensa', ?, ?)`,
      ).bind(hoy, it.item || (it.nombre || 'sin-item'), it.clase || 'flor',
             -(gramos ?? unidades ?? 0), disp.meta.last_row_id, auth.email).run();
    }
    const saldo = await saldoDe(env, socioId);
    return json({ ok: true, saldo });
  }

  if (vista === 'cobro') {
    // El cobro en caja del mostrador: entra confirmado (se cobró en mano),
    // con cargado_por para la trazabilidad. No requiere finanzas_cargar.
    if (!puede(auth.rol, 'mostrador_operar')) return json({ error: 'Sin permiso' }, 403);
    const socioId = Number(body.socio_id);
    const neto = Math.round(Number(body.neto));
    const concepto = String(body.concepto || '').trim().slice(0, 200);
    const medio = ['efectivo', 'transferencia', 'mp'].includes(String(body.medio)) ? String(body.medio) : 'efectivo';
    const categoria = ['membresia', 'producto', 'extra_gramos', 'cuota_ong'].includes(String(body.categoria)) ? String(body.categoria) : 'membresia';
    const gramos = body.gramos != null && body.gramos !== '' ? Number(body.gramos) : null;
    if (!Number.isFinite(socioId) || !Number.isFinite(neto) || neto <= 0 || !concepto) return json({ error: 'Datos inválidos' }, 400);
    await env.DB.prepare(
      `INSERT INTO movimientos (fecha, tipo, categoria, concepto, socio_id, neto, medio, estado, gramos, origen, cargado_por)
       VALUES (date('now'), 'ingreso', ?, ?, ?, ?, ?, 'confirmado', ?, 'manual', ?)`,
    ).bind(categoria, concepto, socioId, neto, medio, gramos, auth.email).run();
    const saldo = await saldoDe(env, socioId);
    return json({ ok: true, saldo });
  }

  if (vista === 'stock') {
    // Entradas de mercadería: cosecha, compra, ajuste de recuento, merma.
    if (!puede(auth.rol, 'catalogo_editar')) return json({ error: 'Sin permiso' }, 403);
    const item = String(body.item || '').trim();
    const clase = String(body.clase || 'flor');
    const cantidad = Number(body.cantidad);
    const motivo = String(body.motivo || '');
    const ubicacion = body.ubicacion ? String(body.ubicacion).slice(0, 40) : null;
    const nota = body.nota ? String(body.nota).slice(0, 200) : null;
    if (!item || !Number.isFinite(cantidad) || cantidad === 0) return json({ error: 'Datos inválidos' }, 400);
    if (!['cosecha', 'compra', 'ajuste', 'merma'].includes(motivo)) return json({ error: 'Motivo inválido' }, 400);
    const cant = motivo === 'merma' ? -Math.abs(cantidad) : cantidad;
    await env.DB.prepare(
      `INSERT INTO stock_mov (fecha, item, clase, cantidad, motivo, ubicacion, nota, cargado_por)
       VALUES (date('now'), ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(item, clase, cant, motivo, ubicacion, nota, auth.email).run();
    return json({ ok: true });
  }

  return json({ error: 'Vista desconocida' }, 404);
};
