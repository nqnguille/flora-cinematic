// Módulo Finanzas — un solo function con sub-vistas:
//   GET  /api/panel/finanzas/resumen?mes=2026-07
//   GET  /api/panel/finanzas/movimientos?mes=2026-07[&tipo=ingreso|egreso]
//   POST /api/panel/finanzas/movimientos          (alta manual)
//   PATCH /api/panel/finanzas/movimientos         (aprobar / confirmar / anular)
//   GET  /api/panel/finanzas/cobranza?mes=2026-07 (deudores depurados)
//   GET  /api/panel/finanzas/fijos?mes=2026-07
//   POST /api/panel/finanzas/fijos                (generar mes / marcar pagado)
//   GET  /api/panel/finanzas/aportes
//   GET  /api/panel/finanzas/personal?anio=2026
//
// Regla de visibilidad: quien no tiene personal_ver ve los egresos de
// sueldos AGRUPADOS como "Personal", sin concepto ni persona — los totales
// no cambian, el detalle por persona queda solo para el presidente.
import { requireCap, puede, type Rol } from '../_rol';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mesParam(url: URL): string | null {
  const mes = url.searchParams.get('mes') || '';
  return MES_RE.test(mes) ? mes : null;
}

// Sin personal_ver: los sueldos se agrupan y despersonalizan.
function taparSueldos<T extends { categoria?: string; concepto?: string; persona?: string | null }>(
  rows: T[], rol: Rol,
): T[] {
  if (puede(rol, 'personal_ver')) return rows;
  return rows.map((r) =>
    r.categoria === 'sueldos' ? { ...r, concepto: 'Personal', persona: null } : r,
  );
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireCap(request, env, 'finanzas_ver');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const rol = auth.rol;
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;
  const url = new URL(request.url);

  if (vista === 'resumen') {
    const mes = mesParam(url);
    if (!mes) return json({ error: 'Falta ?mes=YYYY-MM' }, 400);
    const [porCat, serie, pendientes] = await Promise.all([
      env.DB.prepare(
        `SELECT tipo, categoria, SUM(neto) AS total, COUNT(*) AS n
           FROM movimientos
          WHERE substr(fecha,1,7) = ? AND estado = 'confirmado'
          GROUP BY tipo, categoria`,
      ).bind(mes).all(),
      env.DB.prepare(
        `SELECT substr(fecha,1,7) AS mes, tipo, SUM(neto) AS total
           FROM movimientos
          WHERE substr(fecha,1,4) = ? AND estado = 'confirmado'
          GROUP BY 1, 2 ORDER BY 1`,
      ).bind(mes.slice(0, 4)).all(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM movimientos WHERE estado = 'pendiente_aprobacion'`,
      ).first<{ n: number }>(),
    ]);
    // sin personal_ver, "sueldos" se reporta igual como categoría (es un
    // agregado sin nombres) — el tapado aplica al detalle de movimientos.
    const mp = await env.DB.prepare(
      `SELECT COUNT(DISTINCT socio_id) AS socios FROM movimientos
        WHERE substr(fecha,1,7) = ? AND medio = 'mp' AND tipo = 'ingreso' AND socio_id IS NOT NULL`,
    ).bind(mes).first<{ socios: number }>();
    return json({
      ok: true, mes,
      porCategoria: porCat.results,
      serie: serie.results,
      pendientesAprobacion: pendientes?.n ?? 0,
      sociosPagaronMp: mp?.socios ?? 0,
    });
  }

  if (vista === 'movimientos') {
    const mes = mesParam(url);
    if (!mes) return json({ error: 'Falta ?mes=YYYY-MM' }, 400);
    const tipo = url.searchParams.get('tipo');
    const filtroTipo = tipo === 'ingreso' || tipo === 'egreso' ? ` AND m.tipo = '${tipo}'` : '';
    const rows = await env.DB.prepare(
      `SELECT m.id, m.fecha, m.tipo, m.categoria, m.concepto, m.persona, m.bruto,
              m.comision, m.neto, m.medio, m.estado, m.gramos, m.origen, m.cargado_por,
              s.nombre AS socio_nombre, s.id AS socio_id
         FROM movimientos m LEFT JOIN socios s ON s.id = m.socio_id
        WHERE substr(m.fecha,1,7) = ? AND m.estado != 'anulado'${filtroTipo}
        ORDER BY m.fecha DESC, m.id DESC`,
    ).bind(mes).all();
    let lista = rows.results as Record<string, unknown>[];
    if (!puede(rol, 'personal_ver')) {
      lista = lista.map((r) =>
        r.categoria === 'sueldos'
          ? { ...r, concepto: 'Personal', persona: null, cargado_por: null }
          : r,
      );
    }
    return json({ ok: true, mes, movimientos: lista });
  }

  if (vista === 'cobranza') {
    const mes = mesParam(url);
    if (!mes) return json({ error: 'Falta ?mes=YYYY-MM' }, 400);
    // Deudor = retiró flor este mes, sin pago de membresía este mes,
    // sin plan prepago vigente y sin compra de productos este mes.
    // Los planes y las compras del mes se descuentan SOLOS (lección del 30/07).
    const rows = await env.DB.prepare(
      `WITH retiros AS (
         SELECT socio_id, SUM(gramos) AS gramos, COUNT(*) AS visitas
           FROM dispensas
          WHERE substr(fecha,1,7) = ? AND socio_id IS NOT NULL AND gramos > 0
          GROUP BY socio_id
       ),
       pagos_mes AS (
         SELECT DISTINCT socio_id FROM movimientos
          WHERE substr(fecha,1,7) = ? AND tipo = 'ingreso'
            AND categoria IN ('membresia','extra_gramos') AND socio_id IS NOT NULL
       ),
       compras_mes AS (
         SELECT DISTINCT socio_id FROM movimientos
          WHERE substr(fecha,1,7) = ? AND tipo = 'ingreso'
            AND categoria = 'producto' AND socio_id IS NOT NULL
       ),
       plan_vigente AS (
         SELECT DISTINCT socio_id FROM membresias
          WHERE modalidad = 'plan' AND desde <= ? || '-28'
            AND (hasta IS NULL OR hasta > ? || '-01')
       ),
       ultimo_pago AS (
         SELECT socio_id, MAX(fecha) AS fecha FROM movimientos
          WHERE tipo = 'ingreso' AND categoria = 'membresia' AND socio_id IS NOT NULL
          GROUP BY socio_id
       )
       SELECT s.id, s.nombre, r.gramos, r.visitas, up.fecha AS ultimo_pago,
              mb.tier, mb.gramos_mes,
              (SELECT p.contado FROM precios p
                 JOIN listas_precios lp ON lp.id = p.lista_id
                WHERE p.item = mb.tier AND p.tipo = 'membresia'
                  AND lp.vigente_desde <= ? || '-28'
                ORDER BY lp.vigente_desde DESC LIMIT 1) AS precio
         FROM retiros r
         JOIN socios s ON s.id = r.socio_id
         LEFT JOIN membresias mb ON mb.socio_id = s.id AND mb.hasta IS NULL AND mb.modalidad != 'plan'
         LEFT JOIN ultimo_pago up ON up.socio_id = s.id
        WHERE r.socio_id NOT IN (SELECT socio_id FROM pagos_mes)
          AND r.socio_id NOT IN (SELECT socio_id FROM plan_vigente)
          AND r.socio_id NOT IN (SELECT socio_id FROM compras_mes)
          AND (s.numero IS NULL OR s.numero != -1) AND s.papelera IS NULL
        ORDER BY up.fecha ASC NULLS FIRST`,
    ).bind(mes, mes, mes, mes, mes, mes).all();
    // También: cuántos quedaron excluidos por plan/compra (para el copy del módulo)
    const excluidos = await env.DB.prepare(
      `SELECT COUNT(DISTINCT d.socio_id) AS n FROM dispensas d
        WHERE substr(d.fecha,1,7) = ?1 AND d.socio_id IS NOT NULL
          AND d.socio_id IN (SELECT socio_id FROM membresias WHERE modalidad='plan'
                              AND desde <= ?1 || '-28' AND (hasta IS NULL OR hasta > ?1 || '-01'))`,
    ).bind(mes).first<{ n: number }>();
    return json({ ok: true, mes, deudores: rows.results, cubiertosPorPlan: excluidos?.n ?? 0 });
  }

  if (vista === 'fijos') {
    const mes = mesParam(url);
    if (!mes) return json({ error: 'Falta ?mes=YYYY-MM' }, 400);
    const conPersonal = puede(rol, 'personal_ver');
    const fijos = await env.DB.prepare(
      `SELECT * FROM gastos_fijos WHERE activo = 1${conPersonal ? '' : ' AND solo_dueno = 0'} ORDER BY solo_dueno, monto_estimado DESC`,
    ).all();
    const delMes = await env.DB.prepare(
      `SELECT id, ref, neto, estado FROM movimientos WHERE ref LIKE 'fijo:%:' || ?`,
    ).bind(mes).all();
    return json({ ok: true, mes, fijos: fijos.results, generados: delMes.results });
  }

  if (vista === 'aportes') {
    if (!puede(rol, 'aportes_ver')) return json({ error: 'Sin permiso' }, 403);
    const [porPersona, lista] = await Promise.all([
      env.DB.prepare(
        `SELECT aportante, tipo, COUNT(*) AS n, ROUND(SUM(monto_usd), 2) AS usd,
                SUM(CASE WHEN estado = 'pendiente' THEN 1 ELSE 0 END) AS pendientes
           FROM aportes GROUP BY aportante, tipo ORDER BY usd DESC`,
      ).all(),
      env.DB.prepare(`SELECT * FROM aportes ORDER BY fecha DESC LIMIT 400`).all(),
    ]);
    return json({ ok: true, porPersona: porPersona.results, aportes: lista.results });
  }

  if (vista === 'personal') {
    if (!puede(rol, 'personal_ver')) return json({ error: 'Sin permiso' }, 403);
    const anio = url.searchParams.get('anio') || new Date().getFullYear().toString();
    if (!/^\d{4}$/.test(anio)) return json({ error: 'Año inválido' }, 400);
    const [fichas, pagos] = await Promise.all([
      env.DB.prepare(`SELECT * FROM personal ORDER BY activo DESC, monto_mensual DESC`).all(),
      env.DB.prepare(
        `SELECT substr(fecha,1,7) AS mes, concepto, persona, neto, estado
           FROM movimientos
          WHERE tipo = 'egreso' AND categoria = 'sueldos' AND substr(fecha,1,4) = ?
          ORDER BY fecha DESC`,
      ).bind(anio).all(),
    ]);
    return json({ ok: true, personal: fichas.results, pagos: pagos.results });
  }

  if (vista === 'export') {
    // CSV para la contadora: un año entero o un mes. Respeta el tapado de
    // sueldos para quien no tiene personal_ver.
    const anio = url.searchParams.get('anio');
    const mes = url.searchParams.get('mes');
    const periodo = mes && MES_RE.test(mes) ? mes : anio && /^\d{4}$/.test(anio) ? anio : null;
    if (!periodo) return json({ error: 'Falta ?anio=YYYY o ?mes=YYYY-MM' }, 400);
    const rows = await env.DB.prepare(
      `SELECT m.fecha, m.tipo, m.categoria, m.concepto, s.nombre AS socio, m.persona,
              m.bruto, m.comision, m.neto, m.medio, m.estado, m.gramos, m.origen
         FROM movimientos m LEFT JOIN socios s ON s.id = m.socio_id
        WHERE substr(m.fecha, 1, ${periodo.length}) = ? AND m.estado != 'anulado'
        ORDER BY m.fecha, m.id`,
    ).bind(periodo).all();
    const lista = taparSueldos(rows.results as Record<string, string | number | null>[], rol);
    const cab = ['fecha', 'tipo', 'categoria', 'concepto', 'socio', 'persona', 'bruto', 'comision', 'neto', 'medio', 'estado', 'gramos', 'origen'];
    const celda = (v: unknown) => {
      if (v == null) return '';
      const s = String(v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = '﻿' + cab.join(';') + '\n' +
      lista.map((r) => cab.map((c) => celda((r as Record<string, unknown>)[c])).join(';')).join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="flora-movimientos-${periodo}.csv"`,
      },
    });
  }

  if (vista === 'prevision') {
    // Previsión de débito automático: los planes de MP quedaron configurados
    // para cobrar el día 1 de cada mes (decisión 08/2026). Proyecta el mes
    // corriente + 2, con la comisión REAL promedio de MP (neto vs bruto de
    // los últimos movimientos, nunca hardcodeada).
    const hoy = new Date().toISOString().slice(0, 10);
    const meses: string[] = [];
    {
      const a = Number(hoy.slice(0, 4)), m0 = Number(hoy.slice(5, 7));
      for (let i = 0; i < 3; i++) {
        const t = a * 12 + (m0 - 1) + i;
        meses.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`);
      }
    }

    const [susc, comReciente, cobradoMes] = await Promise.all([
      env.DB.prepare(
        `SELECT su.socio_id, su.tier, su.monto, su.racha_meses, su.estado, su.fin,
                su.mp_payer_email, s.nombre AS socio_nombre
           FROM suscripciones su LEFT JOIN socios s ON s.id = su.socio_id
          WHERE su.no_es_socio = 0 AND su.estado IN ('activa','pendiente','pausada')
          ORDER BY su.monto DESC`,
      ).all(),
      env.DB.prepare(
        `SELECT SUM(bruto) AS bruto, SUM(neto) AS neto, COUNT(*) AS n FROM movimientos
          WHERE medio = 'mp' AND tipo = 'ingreso' AND estado = 'confirmado'
            AND bruto IS NOT NULL AND bruto > 0 AND fecha >= date(?, '-120 days')`,
      ).bind(hoy).first<{ bruto: number | null; neto: number | null; n: number }>(),
      env.DB.prepare(
        `SELECT SUM(neto) AS neto, COUNT(*) AS n FROM movimientos
          WHERE medio = 'mp' AND tipo = 'ingreso' AND estado = 'confirmado'
            AND substr(fecha,1,7) = ?`,
      ).bind(meses[0]).first<{ neto: number | null; n: number }>(),
    ]);

    // Comisión promedio real; si en 120 días no hubo cobros MP con bruto,
    // cae a todo el histórico. Sin datos: 0 (y el front avisa que es bruto).
    let comBruto = comReciente?.bruto ?? 0;
    let comNeto = comReciente?.neto ?? 0;
    let comN = comReciente?.n ?? 0;
    let comVentanaDias: number | null = 120;
    if (!comBruto) {
      const total = await env.DB.prepare(
        `SELECT SUM(bruto) AS bruto, SUM(neto) AS neto, COUNT(*) AS n FROM movimientos
          WHERE medio = 'mp' AND tipo = 'ingreso' AND estado = 'confirmado'
            AND bruto IS NOT NULL AND bruto > 0`,
      ).first<{ bruto: number | null; neto: number | null; n: number }>();
      comBruto = total?.bruto ?? 0; comNeto = total?.neto ?? 0; comN = total?.n ?? 0;
      comVentanaDias = null;
    }
    const comisionPct = comBruto > 0 ? Math.round((1 - comNeto / comBruto) * 10000) / 100 : 0;
    const factor = 1 - comisionPct / 100;

    type Susc = {
      socio_id: number | null; tier: string | null; monto: number; racha_meses: number;
      estado: string; fin: string | null; mp_payer_email: string | null; socio_nombre: string | null;
    };
    const filas = susc.results as Susc[];
    const dia1 = (m: string) => `${m}-01`;

    const mesesOut = meses.map((m, i) => {
      // Entra al mes todo débito activo o esperando autorización cuyo fin
      // (si tiene) no corta antes del día 1, que es cuando sale el cobro.
      const detalle = filas
        .filter((s) => (s.estado === 'activa' || s.estado === 'pendiente') && (!s.fin || s.fin >= dia1(m)))
        .map((s) => ({
          socio: s.socio_nombre || null,
          mp_payer_email: s.mp_payer_email,
          tier: s.tier,
          monto: s.monto,
          estado: s.estado,
          cuota: s.racha_meses + i + 1,                    // cuota que le tocaría acreditar
          cuota_ciclo: ((s.racha_meses + i) % 3) + 1,      // posición en el ciclo de 3 del 20%
          fin: s.fin,
        }));
      const bruto = detalle.reduce((t, d) => t + d.monto, 0);
      const neto = Math.round(bruto * factor);
      const esCorriente = i === 0;
      const cobrado = esCorriente ? (cobradoMes?.neto ?? 0) : null;
      return {
        mes: m,
        bruto,
        neto,
        suscripciones: detalle.length,
        cobradoMp: cobrado,
        avancePct: esCorriente && neto > 0 ? Math.round(((cobrado ?? 0) / neto) * 100) : null,
        detalle,
      };
    });

    const riesgo = (s: Susc) => ({
      socio: s.socio_nombre || null,
      mp_payer_email: s.mp_payer_email,
      tier: s.tier,
      monto: s.monto,
      fin: s.fin,
    });
    // Terminan dentro de la ventana: cada una es una renovación a conseguir.
    const renovaciones = filas
      .filter((s) => s.estado === 'activa' && s.fin && s.fin >= dia1(meses[0]) && s.fin <= `${meses[2]}-31`)
      .sort((a, b) => (a.fin! < b.fin! ? -1 : 1))
      .map(riesgo);
    const pausadas = filas.filter((s) => s.estado === 'pausada').map(riesgo);

    return json({
      ok: true,
      prevision: {
        generado: hoy,
        comisionPct,
        comisionBase: { movimientos: comN, ventanaDias: comVentanaDias },
        meses: mesesOut,
        renovaciones,
        pausadas,
      },
    });
  }

  return json({ error: 'Vista desconocida' }, 404);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireCap(request, env, 'finanzas_cargar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const rol = auth.rol;
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  if (vista === 'movimientos') {
    if (!puede(rol, 'finanzas_cargar')) return json({ error: 'Sin permiso' }, 403);
    const fecha = String(body.fecha || '');
    const tipo = String(body.tipo || '');
    const categoria = String(body.categoria || '').slice(0, 40);
    const concepto = String(body.concepto || '').trim().slice(0, 200);
    const neto = Math.round(Number(body.neto));
    const medio = body.medio ? String(body.medio).slice(0, 20) : null;
    const persona = body.persona ? String(body.persona).trim().slice(0, 80) : null;
    const socioId = body.socio_id ? Number(body.socio_id) : null;
    const gramos = body.gramos != null && body.gramos !== '' ? Number(body.gramos) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json({ error: 'Fecha inválida' }, 400);
    if (tipo !== 'ingreso' && tipo !== 'egreso') return json({ error: 'Tipo inválido' }, 400);
    if (!concepto) return json({ error: 'Falta el concepto' }, 400);
    if (!Number.isFinite(neto) || neto <= 0) return json({ error: 'Importe inválido' }, 400);
    // Los del presidente entran confirmados; los de un socio con carga esperan visto bueno.
    const estado = puede(rol, 'finanzas_aprobar') ? 'confirmado' : 'pendiente_aprobacion';
    const r = await env.DB.prepare(
      `INSERT INTO movimientos (fecha, tipo, categoria, concepto, socio_id, persona, neto, medio, estado, gramos, origen, cargado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
    ).bind(fecha, tipo, categoria || 'otros', concepto, socioId, persona, neto, medio, estado, gramos, auth.email).run();
    return json({ ok: true, id: r.meta.last_row_id, estado });
  }

  if (vista === 'fijos') {
    if (!puede(rol, 'finanzas_aprobar')) return json({ error: 'Sin permiso' }, 403);
    const accion = String(body.accion || '');
    if (accion === 'generar') {
      const mes = String(body.mes || '');
      if (!MES_RE.test(mes)) return json({ error: 'Mes inválido' }, 400);
      const fijos = await env.DB.prepare(`SELECT * FROM gastos_fijos WHERE activo = 1`).all();
      let creados = 0;
      for (const f of fijos.results as Record<string, unknown>[]) {
        const ref = `fijo:${f.id}:${mes}`;
        const ya = await env.DB.prepare(`SELECT id FROM movimientos WHERE ref = ?`).bind(ref).first();
        if (ya) continue;
        const dia = String(f.dia_vencimiento || 1).padStart(2, '0');
        await env.DB.prepare(
          `INSERT INTO movimientos (fecha, tipo, categoria, concepto, persona, neto, estado, origen, ref, cargado_por)
           VALUES (?, 'egreso', ?, ?, ?, ?, 'pendiente_aprobacion', 'manual', ?, ?)`,
        ).bind(`${mes}-${dia}`, f.categoria, f.nombre, f.persona, f.monto_estimado || 0, ref, auth.email).run();
        creados++;
      }
      return json({ ok: true, creados });
    }
    if (accion === 'pagar') {
      const id = Number(body.id);
      const neto = Math.round(Number(body.neto));
      if (!Number.isFinite(id) || !Number.isFinite(neto) || neto <= 0) return json({ error: 'Datos inválidos' }, 400);
      await env.DB.prepare(
        `UPDATE movimientos SET neto = ?, estado = 'confirmado', aprobado_por = ? WHERE id = ? AND estado = 'pendiente_aprobacion'`,
      ).bind(neto, auth.email, id).run();
      return json({ ok: true });
    }
    return json({ error: 'Acción desconocida' }, 400);
  }

  return json({ error: 'Vista desconocida' }, 404);
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireCap(request, env, 'finanzas_aprobar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;
  if (vista !== 'movimientos') return json({ error: 'Vista desconocida' }, 404);
  let body: { id?: number; accion?: string };
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const id = Number(body.id);
  if (!Number.isFinite(id)) return json({ error: 'Falta id' }, 400);
  if (body.accion === 'aprobar') {
    await env.DB.prepare(
      `UPDATE movimientos SET estado = 'confirmado', aprobado_por = ? WHERE id = ? AND estado = 'pendiente_aprobacion'`,
    ).bind(auth.email, id).run();
    return json({ ok: true });
  }
  if (body.accion === 'anular') {
    await env.DB.prepare(`UPDATE movimientos SET estado = 'anulado', aprobado_por = ? WHERE id = ?`)
      .bind(auth.email, id).run();
    return json({ ok: true });
  }
  return json({ error: 'Acción desconocida' }, 400);
};
