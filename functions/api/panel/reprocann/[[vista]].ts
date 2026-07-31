// REPROCANN — el embudo del trámite de cada socio, del lado del club.
//   GET  /api/panel/reprocann/embudo     → todos los socios agrupados por paso
//   PATCH /api/panel/reprocann/socio     → mover de paso / cargar código / nº de trámite
//   POST /api/panel/reprocann/sincronizar → volcado del portal (con DNI oficial):
//        actualiza staging + sync automática de los ya vinculados + propone pares
//   GET  /api/panel/reprocann/unificar   → pares por confirmar + sin match
//   POST /api/panel/reprocann/vinculo    → confirmar/rechazar un par (decisión humana)
//
// Por qué existe: el club es responsable del ÚLTIMO paso (vincular al paciente
// como su cultivador con el mismo código). Sin esto no había forma de saber a
// quién había que empujar: el 84 de 156 socios no tenía ni el dato cargado.
import { requireRol, puede } from '../_rol';
import { extraerTramites, agruparPorPersona, pasoDe, emparejar, puntuar } from './_unificar';
import type { TramitePortal } from './_unificar';

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
              s.reprocann_vence, s.reprocann_plantas, s.reprocann_nota, s.reprocann_actualizado,
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

  // Los pares por confirmar y los trámites sin match. Solo presidente: acá
  // se ven los DNI oficiales del padrón del Ministerio.
  if (vista === 'unificar') {
    if (auth.rol !== 'dueno') return json({ error: 'Sin permiso' }, 403);
    const [personas, vinculos, socios] = await Promise.all([
      env.DB.prepare(`SELECT * FROM tramites_portal`).all<Record<string, unknown>>(),
      env.DB.prepare(`SELECT socio_id, dni, estado, senales FROM vinculos_reprocann`).all<{ socio_id: number; dni: string; estado: string; senales: string | null }>(),
      env.DB.prepare(`SELECT id, nombre, email, documento FROM socios WHERE (numero IS NULL OR numero != -1)`).all<{ id: number; nombre: string; email: string | null; documento: string | null }>(),
    ]);
    const porId = new Map(socios.results.map((s) => [s.id, s]));
    const porDni = new Map((personas.results as unknown as TramitePortal[]).map((p) => [p.dni, p]));
    const confirmados = vinculos.results.filter((v) => v.estado === 'confirmado');
    const dnisOcupados = new Set(confirmados.map((v) => v.dni));
    const sociosOcupados = new Set(confirmados.map((v) => v.socio_id));

    const pares = vinculos.results
      .filter((v) => v.estado === 'pendiente' && porDni.has(v.dni) && porId.has(v.socio_id)
        && !dnisOcupados.has(v.dni) && !sociosOcupados.has(v.socio_id))
      .map((v) => {
        const per = porDni.get(v.dni)!;
        const s = porId.get(v.socio_id)!;
        let senales: unknown = null;
        try { senales = v.senales ? JSON.parse(v.senales) : null; } catch { /* legado */ }
        return {
          dni: v.dni, socio_id: v.socio_id,
          socio: { nombre: s.nombre, email: s.email, documento: s.documento },
          persona: { nombre: per.nombre, apellido: per.apellido, estado: per.estado, vence: per.vence, plantas: per.plantas, renovacion: per.renovacion },
          senales,
        };
      });
    // agrupar por persona: si un DNI tiene 2+ candidatos, la UI lo pinta ambiguo
    const porPersona = new Map<string, typeof pares>();
    for (const p of pares) {
      const arr = porPersona.get(p.dni) || [];
      arr.push(p);
      porPersona.set(p.dni, arr);
    }
    const grupos = [...porPersona.values()].map((cands) => ({
      dni: cands[0].dni,
      persona: cands[0].persona,
      candidatos: cands.sort((a, b) => ((b.senales as { puntaje?: number })?.puntaje || 0) - ((a.senales as { puntaje?: number })?.puntaje || 0)),
    })).sort((a, b) => ((b.candidatos[0].senales as { puntaje?: number })?.puntaje || 0) - ((a.candidatos[0].senales as { puntaje?: number })?.puntaje || 0));

    const conPar = new Set(grupos.map((g) => g.dni));
    const sinMatch = (personas.results as unknown as TramitePortal[])
      .filter((p) => !dnisOcupados.has(p.dni) && !conPar.has(p.dni))
      .map((p) => ({ dni: p.dni, nombre: p.nombre, apellido: p.apellido, estado: p.estado, vence: p.vence, plantas: p.plantas, renovacion: p.renovacion }));

    const ultima = await env.DB.prepare(`SELECT MAX(actualizado) m FROM tramites_portal`).first<{ m: string | null }>();
    return json({ ok: true, pares: grupos, sinMatch, vinculados: confirmados.length, ultimaCarga: ultima?.m || null });
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

// La sync de un socio ya vinculado: el portal es la autoridad sobre el estado
// del trámite. Pisa el paso del embudo, completa vencimiento/plantas/documento
// sin destruir nada cargado a mano.
async function sincronizarSocio(env: Env, socioId: number, per: TramitePortal, hoy: string): Promise<boolean> {
  const paso = pasoDe(per, hoy);
  if (!paso) return false;
  await env.DB.prepare(
    `UPDATE socios SET reprocann_estado = ?, reprocann_tramite = ?,
            reprocann_vence = COALESCE(?, reprocann_vence),
            reprocann_plantas = COALESCE(?, reprocann_plantas),
            documento = COALESCE(documento, ?),
            reprocann_actualizado = datetime('now')
      WHERE id = ?`,
  ).bind(paso, per.tramite_id, per.vence, per.plantas, per.dni || null, socioId).run();
  return true;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireRol(request, env, ['dueno']);
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;
  const hoy = new Date().toISOString().slice(0, 10);

  // El volcado del portal (GET /api/v2/tramites?idOng=342) entra por acá.
  // Viene del navegador logueado con la cuenta de la ONG: ningún servidor
  // puede consultar REPROCANN por su cuenta (2FA de Mi Argentina). Acepta el
  // response crudo del portal, el {tramites} de la extensión, o el archivo
  // del capturador — extraerTramites entiende las tres formas.
  if (vista === 'sincronizar') {
    let crudo: unknown;
    try { crudo = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const tramites = extraerTramites(crudo);
    if (!tramites.length) return json({ error: 'No encontré trámites con DNI en ese volcado — ¿es el JSON del portal?' }, 400);
    const personas = agruparPorPersona(tramites, hoy);

    // 1) staging: una fila por persona, el volcado es acumulativo (subir una
    //    página del pageable suma; nadie se marca vencido por no aparecer)
    for (const p of personas) {
      await env.DB.prepare(
        `INSERT INTO tramites_portal (dni, tramite_id, nombre, apellido, estado, autocultivo, plantas, inicio, vence, renovacion, actualizado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(dni) DO UPDATE SET tramite_id = excluded.tramite_id, nombre = excluded.nombre,
           apellido = excluded.apellido, estado = excluded.estado, autocultivo = excluded.autocultivo,
           plantas = excluded.plantas, inicio = excluded.inicio, vence = excluded.vence,
           renovacion = excluded.renovacion, actualizado = datetime('now')`,
      ).bind(p.dni, p.tramite_id, p.nombre, p.apellido, p.estado, p.autocultivo, p.plantas, p.inicio, p.vence, p.renovacion).run();
    }

    // 2) sync continua de los ya vinculados — por vínculo confirmado, o por
    //    documento igual (un DNI cargado a mano vale como vínculo de hecho)
    const [vinculos, socios] = await Promise.all([
      env.DB.prepare(`SELECT socio_id, dni, estado FROM vinculos_reprocann`).all<{ socio_id: number; dni: string; estado: string }>(),
      env.DB.prepare(`SELECT id, nombre, documento FROM socios WHERE (numero IS NULL OR numero != -1)`).all<{ id: number; nombre: string; documento: string | null }>(),
    ]);
    const confirmadoPorDni = new Map(vinculos.results.filter((v) => v.estado === 'confirmado').map((v) => [v.dni, v.socio_id]));
    const socioPorDoc = new Map(socios.results.filter((s) => s.documento).map((s) => [s.documento as string, s.id]));
    let sincronizados = 0;
    const dnisVinculados = new Set<string>();
    const sociosVinculados = new Set<number>(confirmadoPorDni.values());
    for (const p of personas) {
      const socioId = confirmadoPorDni.get(p.dni) ?? socioPorDoc.get(p.dni);
      if (socioId === undefined) continue;
      dnisVinculados.add(p.dni);
      sociosVinculados.add(socioId);
      if (await sincronizarSocio(env, socioId, p, hoy)) sincronizados++;
      // el documento igual pasa a ser vínculo explícito, así queda auditado
      if (!confirmadoPorDni.has(p.dni)) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO vinculos_reprocann (socio_id, dni, estado, senales, decidido_por, decidido)
           VALUES (?, ?, 'confirmado', ?, ?, datetime('now'))`,
        ).bind(socioId, p.dni, JSON.stringify({ match: ['dni'], conflictos: [], puntaje: 100 }), auth.email).run();
      }
    }

    // 3) candidatos nuevos para el resto (decisión humana en la UI)
    const decididos = new Set(vinculos.results.map((v) => `${v.socio_id}:${v.dni}`));
    const { pares, sinMatch } = emparejar(socios.results, personas, decididos, sociosVinculados, dnisVinculados);
    let candidatosNuevos = 0;
    for (const par of pares) {
      for (const c of par.candidatos) {
        const r = await env.DB.prepare(
          `INSERT OR IGNORE INTO vinculos_reprocann (socio_id, dni, estado, senales) VALUES (?, ?, 'pendiente', ?)`,
        ).bind(c.socio_id, par.dni, JSON.stringify({ match: c.puntaje.match, conflictos: c.puntaje.conflictos, puntaje: c.puntaje.puntaje, confianza: c.puntaje.confianza })).run();
        if (r.meta.changes) candidatosNuevos++;
      }
    }

    return json({
      ok: true, recibidos: tramites.length, personas: personas.length,
      sincronizados, candidatosNuevos, sinMatch: sinMatch.length,
    });
  }

  // Confirmar o rechazar un par. Nunca automático: este endpoint ES el click.
  if (vista === 'vinculo') {
    let b: Record<string, unknown>;
    try { b = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const dni = String(b.dni || '').replace(/\D/g, '');
    if (!dni) return json({ error: 'Falta el DNI' }, 400);

    // "Ninguno de estos": rechaza todos los candidatos mostrados de una
    if (Array.isArray(b.rechazar_socio_ids)) {
      for (const sid of b.rechazar_socio_ids.map(Number).filter(Number.isFinite)) {
        await env.DB.prepare(
          `UPDATE vinculos_reprocann SET estado = 'rechazado', decidido_por = ?, decidido = datetime('now')
            WHERE socio_id = ? AND dni = ? AND estado = 'pendiente'`,
        ).bind(auth.email, sid, dni).run();
      }
      return json({ ok: true, rechazados: b.rechazar_socio_ids.length });
    }

    const socioId = Number(b.socio_id);
    if (!Number.isFinite(socioId)) return json({ error: 'Falta socio_id' }, 400);

    if (!b.aceptar) {
      await env.DB.prepare(
        `UPDATE vinculos_reprocann SET estado = 'rechazado', decidido_por = ?, decidido = datetime('now')
          WHERE socio_id = ? AND dni = ?`,
      ).bind(auth.email, socioId, dni).run();
      return json({ ok: true, rechazado: true });
    }

    // Confirmar: 1:1 estricto — ni el socio ni el DNI pueden estar ya tomados
    const ocupado = await env.DB.prepare(
      `SELECT v.socio_id, v.dni, s.nombre FROM vinculos_reprocann v JOIN socios s ON s.id = v.socio_id
        WHERE v.estado = 'confirmado' AND (v.socio_id = ? OR v.dni = ?)`,
    ).bind(socioId, dni).first<{ nombre: string }>();
    if (ocupado) return json({ error: `Ya hay un vínculo confirmado con ${ocupado.nombre}` }, 409);

    const per = await env.DB.prepare(`SELECT * FROM tramites_portal WHERE dni = ?`).bind(dni).first<Record<string, unknown>>();
    if (!per) return json({ error: 'Ese DNI no está en el último volcado' }, 404);

    const pendiente = await env.DB.prepare(
      `SELECT senales FROM vinculos_reprocann WHERE socio_id = ? AND dni = ?`,
    ).bind(socioId, dni).first<{ senales: string | null }>();

    // Si el socio ya tiene OTRO documento cargado, no se pisa: el conflicto
    // queda en señales y la sync futura entra por el vínculo, no por el DNI.
    const socio = await env.DB.prepare(`SELECT documento, nombre FROM socios WHERE id = ?`).bind(socioId).first<{ documento: string | null; nombre: string }>();
    if (!socio) return json({ error: 'Socio inexistente' }, 404);
    const otroConEseDni = await env.DB.prepare(`SELECT nombre FROM socios WHERE documento = ? AND id != ?`).bind(dni, socioId).first<{ nombre: string }>();

    await env.DB.prepare(
      `INSERT INTO vinculos_reprocann (socio_id, dni, estado, senales, decidido_por, decidido)
       VALUES (?, ?, 'confirmado', COALESCE(?, '{}'), ?, datetime('now'))
       ON CONFLICT(socio_id, dni) DO UPDATE SET estado = 'confirmado', decidido_por = excluded.decidido_por, decidido = datetime('now')`,
    ).bind(socioId, dni, pendiente?.senales || null, auth.email).run();

    // el COALESCE de documento nunca pisa un DNI ya cargado; y si el DNI del
    // portal ya es de OTRO socio (índice único), no se copia y se avisa
    await sincronizarSocio(env, socioId, { ...(per as unknown as TramitePortal), dni: otroConEseDni ? '' : dni }, hoy);

    // limpiar: los demás candidatos pendientes de este DNI y de este socio
    await env.DB.prepare(
      `DELETE FROM vinculos_reprocann WHERE estado = 'pendiente' AND (dni = ? OR socio_id = ?)`,
    ).bind(dni, socioId).run();

    return json({
      ok: true, confirmado: true,
      avisoDni: otroConEseDni ? `El DNI del portal ya pertenece a ${otroConEseDni.nombre} en el padrón — no se copió, revisalo` :
        (socio.documento && socio.documento !== dni ? 'El socio tenía otro DNI cargado — se conservó el suyo' : null),
    });
  }

  return json({ error: 'Vista desconocida' }, 404);
};
