// Inicio del panel — el resumen del día en una sola llamada:
// retiros de hoy, cobros de hoy, reservas activas (KV) y pendientes de
// visto bueno. Cada rol ve lo suyo: el front oculta lo que no corresponde,
// y acá los montos solo viajan si el rol puede verlos.
import { requireRol, puede } from './_rol';

interface Env {
  DB: D1Database;
  PEDIDOS: KVNamespace;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireRol(request, env, ['dueno', 'socio_ong', 'socio_ong_carga', 'mostrador']);
  if (auth.status !== 200) {
    return Response.json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, { status: auth.status });
  }
  const rol = auth.rol;
  const hoy = new Date().toISOString().slice(0, 10);
  const mes = hoy.slice(0, 7);

  const [retiros, cobros, pendientes, mesTot] = await Promise.all([
    env.DB.prepare(
      `SELECT d.fecha, d.producto, d.gramos, d.unidades, s.nombre
         FROM dispensas d JOIN socios s ON s.id = d.socio_id
        WHERE d.fecha = ? ORDER BY d.id DESC LIMIT 20`,
    ).bind(hoy).all(),
    puede(rol, 'finanzas_ver') || puede(rol, 'mostrador_operar')
      ? env.DB.prepare(
          `SELECT COUNT(*) AS n, COALESCE(SUM(neto), 0) AS total FROM movimientos
            WHERE fecha = ? AND tipo = 'ingreso' AND estado = 'confirmado'`,
        ).bind(hoy).first<{ n: number; total: number }>()
      : Promise.resolve(null),
    puede(rol, 'finanzas_aprobar')
      ? env.DB.prepare(`SELECT COUNT(*) AS n FROM movimientos WHERE estado = 'pendiente_aprobacion'`).first<{ n: number }>()
      : Promise.resolve(null),
    puede(rol, 'finanzas_ver')
      ? env.DB.prepare(
          `SELECT tipo, COALESCE(SUM(neto), 0) AS total FROM movimientos
            WHERE substr(fecha, 1, 7) = ? AND estado = 'confirmado' GROUP BY tipo`,
        ).bind(mes).all()
      : Promise.resolve(null),
  ]);

  // reservas activas desde el KV del portal (mismas que ve el módulo Reservas)
  let reservas: { pendientes: number; listas: number; ultimas: { name: string; estado: string; items: number }[] } | null = null;
  if (puede(rol, 'reservas_operar') || puede(rol, 'finanzas_ver')) {
    try {
      const lista = await env.PEDIDOS.list({ prefix: 'pedido:', limit: 200 });
      let pend = 0, listas = 0;
      const ultimas: { name: string; estado: string; items: number }[] = [];
      for (const k of lista.keys) {
        const p = await env.PEDIDOS.get(k.name, 'json') as { estado?: string; name?: string; items?: unknown[]; creado?: string } | null;
        if (!p) continue;
        if (p.estado === 'pendiente') pend++;
        if (p.estado === 'listo') listas++;
        if ((p.estado === 'pendiente' || p.estado === 'listo') && ultimas.length < 6) {
          ultimas.push({ name: String(p.name || '—'), estado: String(p.estado), items: (p.items || []).length });
        }
      }
      reservas = { pendientes: pend, listas, ultimas };
    } catch { reservas = null; }
  }

  const gramosHoy = (retiros.results as { gramos: number | null }[]).reduce((s, r) => s + (r.gramos || 0), 0);
  const totales: Record<string, number> = {};
  if (mesTot) for (const t of mesTot.results as { tipo: string; total: number }[]) totales[t.tipo] = t.total;

  return Response.json({
    ok: true, hoy,
    retirosHoy: { n: retiros.results.length, gramos: gramosHoy, lista: retiros.results },
    cobrosHoy: cobros,
    pendientesAprobacion: pendientes?.n ?? null,
    reservas,
    mes: mesTot ? { ingreso: totales.ingreso || 0, egreso: totales.egreso || 0 } : null,
  });
};
