// Inicio del panel — el resumen del día en una sola llamada:
// retiros de hoy, cobros de hoy, reservas activas (KV) y pendientes de
// visto bueno. Cada rol ve lo suyo: el front oculta lo que no corresponde,
// y acá los montos solo viajan si el rol puede verlos.
import { requireRolAsignado, puede } from './_rol';
import { PASOS } from './reprocann/_pasos';
import { tableroLeads } from './leads';

interface Env {
  DB: D1Database;
  PEDIDOS: KVNamespace;
  INTENTOS: KVNamespace;
  SOLICITUDES: KVNamespace;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

// ---- Kanban "viaje del socio" (dashboard de Inicio) ----
// La etapa NO se arrastra: se deriva de los datos y avanza con acciones
// reales (cargar el código, verificar la declaración, mandar el link).
const TOPE_COL = 30; // cards por columna; el resto viaja como contador

// Dos procesos de entrada distintos que se ENCUENTRAN en Firmas: el que
// arranca desde cero (ENTREVISTA: preparación con Ezequiel) y el
// autocultivador ya aprobado (directo a la declaración jurada). Después de
// la firma, la cocina es del organismo (MINISTERIO). Ambos ríos desembocan
// en VINCULADOS y el objetivo final es ADHERIDOS.
const ESTADOS_ENTREVISTA = new Set(['sin_iniciar', 'esperando_codigo', 'codigo_listo', 'revisar']);
const ESTADOS_MINISTERIO = new Set(['observado', 'a_vincular', 'en_evaluacion', 'revision_medica', 'vencido', 'rechazado']);
// 'cargado' clasifica en FIRMAS: el médico ya cargó el trámite y falta el
// consentimiento del paciente en reprocann.msal (una firma, al fin y al cabo).
// la "pelota" (de quién depende que avance) sale del embudo compartido
const QUIEN_POR_ESTADO = new Map(PASOS.map((p) => [p.id, p.quien]));

interface FilaSweep {
  id: number; nombre: string; telefono: string | null;
  reprocann_estado: string; reprocann_actualizado: string | null;
  reprocann_vence: string | null; debito_no_insistir: number;
  vence_dias: number | null; frio: string | null;
  med_en_tratamiento: number | null; med_proxima_consulta: string | null;
  dec_estado: string | null; dec_generada: string | null; dec_firmada: string | null;
  sus_estado: string | null; sus_tier: string | null; sus_racha: number | null; sus_fin: string | null;
  sus_act: string | null; sus_creado: string | null;
  memb_tier: string | null; memb_modalidad: string | null;
}

const diasHasta = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / 86400000);
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireRolAsignado(request, env);
  if (auth.status !== 200) {
    return Response.json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, { status: auth.status });
  }
  const rol = auth.rol;
  const hoy = new Date().toISOString().slice(0, 10);
  const mes = hoy.slice(0, 7);

  const [retiros, cobros, pendientes, mesTot, vencen, debitos, aVincular] = await Promise.all([
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
    // vencimientos de REPROCANN: recordatorio en el panel (decisión 01/08).
    // Solo para quien ve el padrón (nombres de pacientes).
    puede(rol, 'padron_ver')
      ? env.DB.prepare(
          `SELECT id, nombre, reprocann_vence,
                  CAST(julianday(reprocann_vence) - julianday('now') AS INTEGER) AS dias
             FROM socios
            WHERE reprocann_estado = 'aprobado' AND reprocann_vence IS NOT NULL
              AND (numero IS NULL OR numero != -1) AND papelera IS NULL
            ORDER BY reprocann_vence LIMIT 8`,
        ).all<{ id: number; nombre: string; reprocann_vence: string; dias: number }>()
      : Promise.resolve(null),
    // salud del débito automático, para el tile de Inicio
    puede(rol, 'finanzas_ver')
      ? env.DB.prepare(
          `SELECT
             (SELECT COUNT(*) FROM suscripciones WHERE estado = 'activa') AS al_dia,
             (SELECT COUNT(*) FROM suscripciones WHERE estado = 'pendiente' AND (fin IS NULL OR fin >= ?1)) AS esperando,
             (SELECT COUNT(*) FROM suscripciones WHERE estado = 'activa' AND substr(fin, 1, 7) = ?2) AS terminan_mes,
             (SELECT COALESCE(SUM(neto), 0) FROM movimientos WHERE substr(fecha, 1, 7) = ?2
               AND origen = 'mp_webhook' AND estado = 'confirmado') AS recaudado_mes,
             (SELECT COUNT(*) FROM suscripciones WHERE socio_id IS NULL AND no_es_socio = 0
               AND estado != 'cancelada') AS sin_identificar`,
        ).bind(hoy, mes).first<{ al_dia: number; esperando: number; terminan_mes: number; recaudado_mes: number }>()
      : Promise.resolve(null),
    // "Nos toca vincular": trámites que el paciente ya firmó y esperan que la
    // ONG los vincule. La tabla la llena el agente (el trámite todavía no está
    // en el volcado de la ONG, así que no vive en `socios`). Solo padrón.
    puede(rol, 'padron_ver')
      ? env.DB.prepare(
          `SELECT COUNT(*) AS n FROM pendientes_vinculacion WHERE resuelto IS NULL`,
        ).first<{ n: number }>().catch(() => null)
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

  // ---- Kanban del viaje del socio ----
  // Cada columna viaja solo si el rol puede ver esos datos (mismo criterio
  // que el resto del endpoint): leads con leads_ver, socios con padron_ver.
  // Cada columna: vivos (total + tope 30) y fríos aparte (su propio total y
  // tope): el front los oculta por defecto y los muestra con el chip "Fríos".
  type ColKanban = {
    total: number; items: Record<string, unknown>[];
    frios: { total: number; items: Record<string, unknown>[] };
  } | null;
  let kanban: {
    leads: ColKanban; entrevista: ColKanban; firmas: ColKanban;
    ministerio: ColKanban; vinculados: ColKanban; adheridos: ColKanban;
  } | null = null;
  const verSocios = puede(rol, 'padron_ver');
  const verLeads = puede(rol, 'leads_ver');
  if (verSocios || verLeads) {
    kanban = { leads: null, entrevista: null, firmas: null, ministerio: null, vinculados: null, adheridos: null };

    if (verLeads) {
      try {
        // Mismo motor que el viejo tablero de Leads (leads.ts): espejo KV→D1
        // de solicitudes e intentos incluido, más la superposición del modo
        // aspirante (reprocann leído, teléfono, adjunto). Desde acá salen las
        // cards de LEADS (nuevo+contactado) y las de lead en ENTREVISTA.
        const todos = await tableroLeads(env);
        const enJuego = todos.filter((l) => l.etapa === 'nuevo' || l.etapa === 'contactado' || l.etapa === 'entrevista');
        // Los fríos viajan APARTE y no consumen el tope de 30 de los vivos:
        // así un frío nunca desplaza del tablero a una card viva.
        const vivosL = enJuego.filter((l) => !l.frio);
        const friosL = enJuego.filter((l) => !!l.frio);
        // primero el que lleva más tiempo parado en su etapa (es al que hay
        // que perseguir), como ordenaba el tablero viejo
        const enEtapa = (l: Record<string, unknown>) => Date.parse(String(l.etapa_desde || l.creado || '').replace(' ', 'T') + 'Z') || 0;
        vivosL.sort((a, b) => enEtapa(a) - enEtapa(b));
        friosL.sort((a, b) => String(b.frio || '').localeCompare(String(a.frio || '')));
        kanban.leads = {
          total: vivosL.length, items: vivosL.slice(0, TOPE_COL),
          frios: { total: friosL.length, items: friosL.slice(0, TOPE_COL) },
        };
      } catch { kanban.leads = null; }
    }

    if (verSocios) {
      // Un solo sweep del padrón vivo con la última declaración no-anulada,
      // la suscripción viva y la membresía vigente de cada socio.
      const sweep = await env.DB.prepare(
        `SELECT s.id, s.nombre, s.telefono, s.reprocann_estado, s.reprocann_actualizado,
                s.reprocann_vence, s.debito_no_insistir,
                s.med_en_tratamiento, s.med_proxima_consulta, s.frio,
                CASE WHEN s.reprocann_vence IS NULL THEN NULL
                     ELSE CAST(julianday(s.reprocann_vence) - julianday('now') AS INTEGER) END AS vence_dias,
                de.estado AS dec_estado, de.generada AS dec_generada, de.firmada AS dec_firmada,
                su.estado AS sus_estado, su.tier AS sus_tier, su.racha_meses AS sus_racha, su.fin AS sus_fin,
                su.actualizado AS sus_act, su.creado AS sus_creado,
                me.tier AS memb_tier, me.modalidad AS memb_modalidad
           FROM socios s
           LEFT JOIN declaraciones de ON de.id =
             (SELECT id FROM declaraciones WHERE socio_id = s.id AND estado != 'anulada'
               ORDER BY id DESC LIMIT 1)
           LEFT JOIN suscripciones su ON su.id =
             (SELECT id FROM suscripciones WHERE socio_id = s.id
               AND (estado = 'activa' OR (estado = 'pendiente' AND (fin IS NULL OR fin >= date('now'))))
              ORDER BY CASE estado WHEN 'activa' THEN 0 ELSE 1 END, id DESC LIMIT 1)
           LEFT JOIN membresias me ON me.id =
             (SELECT id FROM membresias WHERE socio_id = s.id AND (hasta IS NULL OR hasta > date('now'))
              ORDER BY desde DESC LIMIT 1)
          WHERE s.papelera IS NULL AND (s.numero IS NULL OR s.numero != -1)`,
      ).all<FilaSweep>();

      const entrevista: Record<string, unknown>[] = [];
      const firmas: Record<string, unknown>[] = [];
      const ministerio: Record<string, unknown>[] = [];
      const vinculados: Record<string, unknown>[] = [];
      const adheridos: Record<string, unknown>[] = [];
      // los fríos de cada columna, aparte: no consumen el tope de los vivos
      const friosCol: Record<string, Record<string, unknown>[]> = {
        entrevista: [], firmas: [], ministerio: [], vinculados: [], adheridos: [],
      };

      for (const s of sweep.results) {
        const susViva = !!s.sus_estado;
        // FIRMAS primero: acá se encuentran los dos ríos. Una declaración
        // esperando firma o verificación (el autocultivador que se pasa a
        // Flora), o el consentimiento del trámite desde cero ('cargado': el
        // médico ya lo cargó, falta la firma del paciente en reprocann.msal).
        const decEnJuego = s.dec_estado === 'generada' || s.dec_estado === 'firmada';
        const ddjjSinDec = !s.dec_estado && (s.reprocann_estado === 'ddjj_pendiente' || s.reprocann_estado === 'ddjj_firmada');
        // un frío conserva su columna natural pero viaja en la lista aparte
        const en = (vivosArr: Record<string, unknown>[], col: string) => (s.frio ? friosCol[col] : vivosArr);
        if (decEnJuego || ddjjSinDec) {
          en(firmas, 'firmas').push({
            id: s.id, nombre: s.nombre, estado: s.reprocann_estado, tipo: 'declaracion',
            dec_estado: s.dec_estado || (s.reprocann_estado === 'ddjj_firmada' ? 'firmada' : 'generada'),
            dec_generada: s.dec_generada, dec_firmada: s.dec_firmada, frio: s.frio,
          });
          continue;
        }
        if (s.reprocann_estado === 'cargado') {
          en(firmas, 'firmas').push({
            id: s.id, nombre: s.nombre, estado: 'cargado', tipo: 'consentimiento',
            dec_estado: null, dec_generada: null, dec_firmada: null,
            actualizado: s.reprocann_actualizado, frio: s.frio,
          });
          continue;
        }
        if (ESTADOS_ENTREVISTA.has(s.reprocann_estado)) {
          const proxDias = diasHasta(s.med_proxima_consulta);
          en(entrevista, 'entrevista').push({
            id: s.id, nombre: s.nombre, estado: s.reprocann_estado,
            quien: QUIEN_POR_ESTADO.get(s.reprocann_estado) || '—',
            actualizado: s.reprocann_actualizado,
            en_tratamiento: !!s.med_en_tratamiento,
            prox_consulta: s.med_proxima_consulta,
            prox_dias: proxDias, frio: s.frio,
          });
          continue;
        }
        if (ESTADOS_MINISTERIO.has(s.reprocann_estado)) {
          en(ministerio, 'ministerio').push({
            id: s.id, nombre: s.nombre, estado: s.reprocann_estado,
            quien: QUIEN_POR_ESTADO.get(s.reprocann_estado) || '—',
            actualizado: s.reprocann_actualizado, vence: s.reprocann_vence, vence_dias: s.vence_dias,
            frio: s.frio,
          });
          continue;
        }
        if (susViva && s.sus_tier !== 'CUOTA SOCIAL') {
          en(adheridos, 'adheridos').push({
            id: s.id, nombre: s.nombre, sus_estado: s.sus_estado,
            tier: s.sus_tier || s.memb_tier || null,
            racha_meses: s.sus_racha || 0, fin: s.sus_fin, fin_dias: diasHasta(s.sus_fin),
            // "actividad" de un adherido = el último latido de su suscripción
            actualizado: s.sus_act || s.sus_creado, frio: s.frio,
          });
          continue;
        }
        if ((s.reprocann_estado === 'aprobado' || s.reprocann_estado === 'conversion')
          && !susViva && s.memb_modalidad !== 'debito') {
          en(vinculados, 'vinculados').push({
            id: s.id, nombre: s.nombre, telefono: s.telefono, estado: s.reprocann_estado,
            no_insistir: !!s.debito_no_insistir, memb_tier: s.memb_tier, memb_modalidad: s.memb_modalidad,
            // "actividad" de un vinculado = su último movimiento de trámite
            actualizado: s.reprocann_actualizado, frio: s.frio,
          });
        }
      }

      // ENTREVISTA: la consulta agendada del consultorio manda (en tratamiento
      // y con fecha futura arriba, la más próxima primero); después lo que nos
      // toca a nosotros, y adentro el más frío primero.
      const conConsulta = (x: Record<string, unknown>) =>
        (x.en_tratamiento && x.prox_dias !== null && Number(x.prox_dias) >= 0) ? 0 : 1;
      entrevista.sort((a, b) => (conConsulta(a) - conConsulta(b))
        || (conConsulta(a) === 0 ? Number(a.prox_dias) - Number(b.prox_dias) : 0)
        || ((a.quien === 'club' ? 0 : 1) - (b.quien === 'club' ? 0 : 1))
        || String(a.actualizado || '').localeCompare(String(b.actualizado || '')));
      // FIRMAS: la declaración firmada (verificar y habilitar) es la estrella y
      // va antes que todo lo que espera una firma ajena (declaración generada o
      // consentimiento del trámite).
      const fechaFirma = (x: Record<string, unknown>) =>
        String(x.dec_firmada || x.dec_generada || x.actualizado || '');
      firmas.sort((a, b) =>
        ((a.dec_estado === 'firmada' ? 0 : 1) - (b.dec_estado === 'firmada' ? 0 : 1))
        || fechaFirma(a).localeCompare(fechaFirma(b)));
      // MINISTERIO: lo que nos toca a nosotros arriba, después el más frío primero
      ministerio.sort((a, b) =>
        ((a.quien === 'club' ? 0 : 1) - (b.quien === 'club' ? 0 : 1))
        || String(a.actualizado || '').localeCompare(String(b.actualizado || '')));
      // VINCULADOS: los "no insistir" al fondo
      vinculados.sort((a, b) => (a.no_insistir ? 1 : 0) - (b.no_insistir ? 1 : 0));
      // ADHERIDOS: primero los que piden renovación (racha o fin cercano)
      const urgencia = (x: Record<string, unknown>) =>
        (Number(x.racha_meses) >= 2 || (x.fin_dias !== null && Number(x.fin_dias) < 35)) ? 0 : 1;
      adheridos.sort((a, b) => (urgencia(a) - urgencia(b))
        || (Number(a.fin_dias ?? 9999) - Number(b.fin_dias ?? 9999)));

      // fríos: los dormidos más recientes primero
      for (const c of Object.keys(friosCol)) {
        friosCol[c].sort((a, b) => String(b.frio || '').localeCompare(String(a.frio || '')));
      }
      // El tope de 30 va por separado para vivos y fríos: `total` cuenta solo
      // vivos (mueve el contador grande y el "+N más"); los fríos llevan el suyo.
      const pack = (vivosArr: Record<string, unknown>[], col: string) => ({
        total: vivosArr.length, items: vivosArr.slice(0, TOPE_COL),
        frios: { total: friosCol[col].length, items: friosCol[col].slice(0, TOPE_COL) },
      });
      kanban.entrevista = pack(entrevista, 'entrevista');
      kanban.firmas = pack(firmas, 'firmas');
      kanban.ministerio = pack(ministerio, 'ministerio');
      kanban.vinculados = pack(vinculados, 'vinculados');
      kanban.adheridos = pack(adheridos, 'adheridos');
    }
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
    debitos: debitos || null,
    vencimientos: vencen ? {
      vencidos: vencen.results.filter((v) => v.dias < 0).length,
      en60: vencen.results.filter((v) => v.dias >= 0 && v.dias <= 60).length,
      proximos: vencen.results.slice(0, 6),
    } : null,
    aVincular: aVincular?.n ?? null,
    kanban,
  });
};
