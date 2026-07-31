// REPROCANN — el embudo del trámite de cada socio, del lado del club.
//   GET  /api/panel/reprocann/embudo     → todos los socios agrupados por paso
//   PATCH /api/panel/reprocann/socio     → mover de paso / cargar código / nº de trámite
//   POST /api/panel/reprocann/sincronizar → volcar lo leído de REPROCANN (lo manda la extensión)
//
// Por qué existe: el club es responsable del ÚLTIMO paso (vincular al paciente
// como su cultivador con el mismo código). Sin esto no había forma de saber a
// quién había que empujar: el 84 de 156 socios no tenía ni el dato cargado.
import { requireRol, puede } from '../_rol';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

// El embudo, en orden. `quien` = de quién depende que avance: eso es lo que
// convierte una lista de estados en una lista de acciones.
export const PASOS: { id: string; nombre: string; quien: string; ayuda: string }[] = [
  { id: 'sin_iniciar', nombre: 'Sin iniciar', quien: 'club', ayuda: 'Todavía no arrancó el trámite.' },
  { id: 'esperando_codigo', nombre: 'Esperando su código', quien: 'paciente', ayuda: 'Tiene que generar su código de vinculación en Mi Argentina.' },
  { id: 'codigo_listo', nombre: 'Código listo', quien: 'medico', ayuda: 'Ya tenemos el código: le toca a Ezequiel cargar el trámite.' },
  { id: 'cargado', nombre: 'Esperando su firma', quien: 'paciente', ayuda: 'El médico cargó el trámite; el paciente tiene que aceptar el consentimiento desde su cuenta.' },
  { id: 'observado', nombre: 'Observado por el paciente', quien: 'paciente', ayuda: 'El paciente objetó algo del trámite.' },
  { id: 'a_vincular', nombre: 'Nos toca vincular', quien: 'club', ayuda: 'El paciente ya firmó: Flora tiene que vincularlo como su cultivadora.' },
  { id: 'en_evaluacion', nombre: 'En evaluación', quien: 'organismo', ayuda: 'Ya está todo hecho de nuestro lado; espera al Ministerio.' },
  { id: 'revision_medica', nombre: 'Volvió al médico', quien: 'medico', ayuda: 'El organismo pidió correcciones al profesional.' },
  { id: 'aprobado', nombre: 'Aprobado', quien: '—', ayuda: 'Certificado vigente.' },
  { id: 'autocultivo', nombre: 'Autocultivo', quien: '—', ayuda: 'Cultiva por su cuenta, no depende de Flora.' },
  { id: 'revisar', nombre: 'A revisar', quien: 'club', ayuda: 'Viene del Excel sin dato claro: hay que confirmar en qué anda.' },
  { id: 'rechazado', nombre: 'Rechazado', quien: 'club', ayuda: 'El organismo lo rechazó.' },
  { id: 'vencido', nombre: 'Vencido', quien: 'club', ayuda: 'El certificado venció: hay que renovar.' },
];
const IDS = new Set(PASOS.map((p) => p.id));

// Estados de REPROCANN (los 8 oficiales) → nuestro embudo.
const DESDE_REPROCANN: Record<string, string> = {
  PendienteConsentimientoPaciente: 'cargado',
  PendienteConsentimiento: 'cargado',
  ObservadoPorPaciente: 'observado',
  PendienteVinculacionCultivador: 'a_vincular',
  PendienteEvaluacion: 'en_evaluacion',
  PendienteRevisionMedica: 'revision_medica',
  Aprobado: 'aprobado',
  Rechazado: 'rechazado',
  Anulado: 'rechazado',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireRol(request, env, ['dueno', 'socio_ong', 'socio_ong_carga', 'mostrador']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  if (!puede(auth.rol, 'padron_ver')) return json({ error: 'Sin permiso' }, 403);
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;

  if (vista === 'embudo') {
    const socios = await env.DB.prepare(
      `SELECT s.id, s.nombre, s.email, s.telefono, s.estado,
              s.reprocann_estado, s.reprocann_codigo, s.reprocann_tramite,
              s.reprocann_vence, s.reprocann_nota, s.reprocann_actualizado,
              (SELECT MAX(fecha) FROM dispensas d WHERE d.socio_id = s.id) AS ultimo_retiro,
              (SELECT tier FROM membresias m WHERE m.socio_id = s.id AND m.hasta IS NULL LIMIT 1) AS tier
         FROM socios s
        WHERE (s.numero IS NULL OR s.numero != -1)
        ORDER BY s.reprocann_actualizado IS NULL, s.reprocann_actualizado ASC, s.nombre`,
    ).all();
    // vencimientos próximos: el certificado de persona jurídica dura 1 año
    const porVencer = (socios.results as { reprocann_vence: string | null; reprocann_estado: string }[])
      .filter((s) => s.reprocann_estado === 'aprobado' && s.reprocann_vence &&
        (Date.parse(s.reprocann_vence) - Date.now()) < 60 * 86400000).length;
    return json({ ok: true, pasos: PASOS, socios: socios.results, porVencer });
  }

  return json({ error: 'Vista desconocida' }, 404);
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireRol(request, env, ['dueno', 'mostrador']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  if (!puede(auth.rol, 'padron_editar') && !puede(auth.rol, 'mostrador_operar')) {
    return json({ error: 'Sin permiso' }, 403);
  }
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;
  if (vista !== 'socio') return json({ error: 'Vista desconocida' }, 404);
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const id = Number(b.id);
  if (!Number.isFinite(id)) return json({ error: 'Falta id' }, 400);

  const campos: string[] = [];
  const vals: (string | number | null)[] = [];
  if ('estado' in b) {
    const e = String(b.estado);
    if (!IDS.has(e)) return json({ error: 'Paso inválido' }, 400);
    campos.push('reprocann_estado = ?'); vals.push(e);
  }
  if ('codigo' in b) {
    const c = String(b.codigo || '').trim().toUpperCase().replace(/\s/g, '') || null;
    // El código lo genera el paciente en Mi Argentina: son 13 caracteres.
    if (c && c.length !== 13) return json({ error: 'El código de vinculación tiene 13 caracteres' }, 400);
    campos.push('reprocann_codigo = ?'); vals.push(c);
    // cargar el código es, en los hechos, avanzar de paso
    if (c && !('estado' in b)) { campos.push('reprocann_estado = ?'); vals.push('codigo_listo'); }
  }
  if ('tramite' in b) {
    const t = b.tramite ? Number(b.tramite) : null;
    if (t !== null && !Number.isFinite(t)) return json({ error: 'Nº de trámite inválido' }, 400);
    campos.push('reprocann_tramite = ?'); vals.push(t);
  }
  if ('vence' in b) {
    const v = String(b.vence || '').slice(0, 10) || null;
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return json({ error: 'Fecha inválida' }, 400);
    campos.push('reprocann_vence = ?'); vals.push(v);
  }
  if ('nota' in b) { campos.push('reprocann_nota = ?'); vals.push(String(b.nota || '').slice(0, 300) || null); }
  if (!campos.length) return json({ error: 'Nada para cambiar' }, 400);

  await env.DB.prepare(
    `UPDATE socios SET ${campos.join(', ')}, reprocann_actualizado = datetime('now') WHERE id = ?`,
  ).bind(...vals, id).run();
  return json({ ok: true });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireRol(request, env, ['dueno']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;
  if (vista !== 'sincronizar') return json({ error: 'Vista desconocida' }, 404);

  // Lo que se lee de REPROCANN (GET /api/v2/tramites?idOng=342) entra por acá.
  // Viene de la extensión que corre en el navegador con la sesión de la ONG:
  // ningún servidor puede consultar REPROCANN por su cuenta (2FA de Mi Argentina).
  let b: { tramites?: Record<string, unknown>[] };
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const lista = Array.isArray(b.tramites) ? b.tramites : [];
  if (!lista.length) return json({ error: 'Sin trámites para sincronizar' }, 400);

  let actualizados = 0, sinMatch = 0;
  const noMatchean: string[] = [];
  for (const t of lista) {
    const dni = String(t.pacienteDni || '').replace(/\D/g, '');
    const apellido = String(t.pacienteApellido || '').trim();
    const nombre = String(t.pacienteNombre || '').trim();
    const paso = DESDE_REPROCANN[String(t.estado)] || null;
    if (!paso) continue;
    // Match por nombre completo (el padrón no guarda DNI todavía).
    const completo = `${nombre} ${apellido}`.trim();
    const socio = await env.DB.prepare(
      `SELECT id FROM socios WHERE (numero IS NULL OR numero != -1)
        AND (lower(nombre) = lower(?1) OR lower(nombre) = lower(?2)) LIMIT 1`,
    ).bind(completo, `${nombre} ${apellido.charAt(0)}${apellido.slice(1).toLowerCase()}`).first<{ id: number }>();
    if (!socio) { sinMatch++; if (noMatchean.length < 12) noMatchean.push(completo); continue; }
    await env.DB.prepare(
      `UPDATE socios SET reprocann_estado = ?, reprocann_tramite = ?,
              reprocann_vence = COALESCE(?, reprocann_vence),
              reprocann_actualizado = datetime('now')
        WHERE id = ?`,
    ).bind(paso, t.id ? Number(t.id) : null,
           t.finalizacionVigencia ? String(t.finalizacionVigencia).slice(0, 10) : null, socio.id).run();
    actualizados++;
    if (dni) { /* el DNI llega pero el padrón todavía no lo guarda; queda para cuando exista la columna */ }
  }
  return json({ ok: true, actualizados, sinMatch, noMatchean });
};
