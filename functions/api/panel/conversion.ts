// Asistente «Convertir autocultivador»: del PDF del certificado REPROCANN a
// la declaración jurada lista para firmar, en UN solo lugar. Hasta hoy Sofi
// hacía este circuito saltando entre pantallas: subir el certificado en la
// ficha (si la ficha existía), completar los datos a mano, generar la DDJJ
// desde otra solapa y armar el WhatsApp aparte. Este endpoint encadena las
// piezas que ya existen — leerCertificado(), el guardado de certificado.ts y
// generarDeclaracion() — sin duplicar su lógica de negocio.
//
//   POST /api/panel/conversion   (cap: reprocann_editar)
//     { pdf_base64 }                          → lee el PDF; si el DNI matchea
//                                               un socio sigue derecho; si no,
//                                               { paso:'revisar', leido }
//     { lead_email }                          → modo lead (aspirante que subió
//                                               su credencial desde el portal):
//                                               el PDF se lee de SOLICITUDES
//                                               archivo:<email> y el email —
//                                               verificado por Google — queda
//                                               en la ficha y abre el acceso
//                                               al portal (KV SOCIOS) para que
//                                               pueda entrar a firmar. El lead
//                                               (INTENTOS) se limpia al final.
//     { pdf_base64 | lead_email, confirmar_creacion, nombre, documento, … }
//                                             → usa o crea la ficha y sigue
//     { socio_id, diagnostico, telefono?, domicilio? }
//                                             → completa lo que faltaba
//   Respuesta final: { ok, paso:'listo', socio:{id,nombre,telefono,creado},
//                      declaracion_id, ya_firmada? }
//   Idempotente: con una declaración activa (estado != 'anulada') no genera
//   otra; si ya estaba firmada/verificada avisa con ya_firmada:true.
import { requireCap, type RolCheck } from './_rol';
import { leerCertificado, type DatosCertificado } from './_certpdf';
import { generarDeclaracion } from './declaracion';

interface Env {
  DB: D1Database;
  CERTIFICADOS: KVNamespace;
  GENETICAS: KVNamespace;
  SOCIOS: KVNamespace;       // acceso al portal (modo lead)
  SOLICITUDES: KVNamespace;  // archivo:<email> con la credencial del aspirante
  INTENTOS: KVNamespace;     // el lead enriquecido; se borra al convertir
  AI: Ai;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

const MAX_BYTES = 8 * 1024 * 1024; // mismo tope que certificado.ts

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

interface SocioRow {
  id: number;
  nombre: string;
  email: string | null;
  telefono: string | null;
  documento: string | null;
  domicilio: string | null;
  localidad: string | null;
  provincia: string | null;
  reprocann_vence: string | null;
}

const CAMPOS_SOCIO = 'id, nombre, email, telefono, documento, domicilio, localidad, provincia, reprocann_vence';

// El DNI es la llave (convención de alta.ts / migración 0010). Se excluye la
// fila técnica numero = -1, igual que socio.ts.
function porDocumento(env: Env, documento: string): Promise<SocioRow | null> {
  return env.DB.prepare(
    `SELECT ${CAMPOS_SOCIO} FROM socios WHERE documento = ? AND (numero IS NULL OR numero != -1) LIMIT 1`,
  ).bind(documento).first<SocioRow>();
}

// Segunda llave del modo lead: el email exacto (viene verificado por Google,
// no tipeado). Solo se usa cuando el DNI no resolvió.
function porEmail(env: Env, email: string): Promise<SocioRow | null> {
  return env.DB.prepare(
    `SELECT ${CAMPOS_SOCIO} FROM socios WHERE email = ? AND (numero IS NULL OR numero != -1) LIMIT 1`,
  ).bind(email).first<SocioRow>();
}

// Lo que el modo lead sabe del aspirante (INTENTOS + el body del panel).
interface LeadInfo {
  email: string;
  telefono: string | null;
  nombre: string | null;
  reprocann: Record<string, unknown>;
}

// Datos del certificado que viajan del PDF (o del formulario de revisión) a
// la ficha. Solo llenan campos VACÍOS: nunca pisan lo escrito a mano
// (la regla de oro de certificado.ts).
interface DatosPdf {
  domicilio?: string | null;
  localidad?: string | null;
  provincia?: string | null;
  vence?: string | null;
  tramite?: string | null;
  plantas?: number | null;
}

async function completarFicha(env: Env, socio: SocioRow, datos: DatosPdf): Promise<void> {
  const campos: Array<['domicilio' | 'localidad' | 'provincia' | 'reprocann_vence' | 'reprocann_tramite' | 'reprocann_plantas', string | number | null | undefined]> = [
    ['reprocann_tramite', datos.tramite], ['reprocann_plantas', datos.plantas],
    ['domicilio', datos.domicilio], ['localidad', datos.localidad],
    ['provincia', datos.provincia], ['reprocann_vence', datos.vence],
  ];
  for (const [col, val] of campos) {
    if (!val) continue;
    const r = await env.DB.prepare(
      `UPDATE socios SET ${col} = ?, actualizado = datetime('now') WHERE id = ? AND (${col} IS NULL OR ${col} = '')`,
    ).bind(val, socio.id).run();
    if (r.meta.changes && col !== 'reprocann_vence') socio[col] = val;
    if (r.meta.changes && col === 'reprocann_vence') socio.reprocann_vence = val;
  }
}

// El tramo común de todos los caminos: guardar el PDF, completar la ficha,
// el teléfono si faltaba, y la declaración (o pedir lo que falte para ella).
async function convertir(
  env: Env,
  auth: Extract<RolCheck, { status: 200 }>,
  socio: SocioRow,
  opts: { bytes: Uint8Array | null; datos: DatosPdf; diagnostico: string | null; telefono: string | null; creado: boolean; lead?: LeadInfo | null },
): Promise<Response> {
  // c) el PDF a KV, con las mismas claves y meta que certificado.ts
  if (opts.bytes) {
    await env.CERTIFICADOS.put(`cert:${socio.id}`, opts.bytes.buffer as ArrayBuffer);
    await env.CERTIFICADOS.put(`cert:${socio.id}:meta`, JSON.stringify({
      nombre: socio.nombre, bytes: opts.bytes.length,
      subido: new Date().toISOString(), por: auth.email,
    }));
  }

  await completarFicha(env, socio, opts.datos);

  // e) teléfono: solo si la ficha no tenía
  if (opts.telefono && !socio.telefono) {
    await env.DB.prepare(
      `UPDATE socios SET telefono = ?, actualizado = datetime('now') WHERE id = ? AND (telefono IS NULL OR telefono = '')`,
    ).bind(opts.telefono, socio.id).run();
    socio.telefono = opts.telefono;
  }

  // extras del modo lead: acá el email ES confiable (lo verificó Google en
  // aspirante.ts), así que la ficha lo adopta si no tenía, y con el email en
  // la ficha se abre el acceso al portal — sin eso no puede entrar a firmar.
  if (opts.lead) {
    const lemail = opts.lead.email;
    if (!socio.email) {
      // dos fichas no comparten email (misma regla que alta.ts): si ya es de
      // otro socio, esta ficha sigue sin email y el acceso no se abre.
      const otro = await env.DB.prepare(`SELECT id FROM socios WHERE email = ? AND id != ?`)
        .bind(lemail, socio.id).first<{ id: number }>();
      if (!otro) {
        await env.DB.prepare(
          `UPDATE socios SET email = ?, actualizado = datetime('now') WHERE id = ? AND (email IS NULL OR email = '')`,
        ).bind(lemail, socio.id).run();
        socio.email = lemail;
      }
    }
    if (socio.email === lemail) {
      // Acceso a la carta/portal (KV SOCIOS): la MISMA convención de shape
      // que el alta del panel (alta.ts §3) — merge sobre lo previo,
      // permanente (temporal:false), sin campos inventados.
      let previo: Record<string, unknown> = {};
      try {
        const crudo = await env.SOCIOS.get(lemail);
        if (crudo && crudo !== 'ok') previo = JSON.parse(crudo);
      } catch { /* valor legado "ok": ficha nueva */ }
      await env.SOCIOS.put(lemail, JSON.stringify({
        ...previo,
        nota: previo.nota || null,
        telefono: socio.telefono || previo.telefono || null,
        name: previo.name || socio.nombre,
        alta: previo.alta || new Date().toISOString(),
        temporal: false,
        tempExpiraEn: null,
      }));
    }
    // El lead ya cumplió: fuera del embudo. El registro INTENTOS se borra
    // (el adjunto queda en SOLICITUDES y el cert ya está en CERTIFICADOS);
    // la fila del tablero pasa a convertido, igual que hace alta.ts.
    await env.INTENTOS.delete(lemail).catch(() => { /* puede no existir */ });
    await env.DB.prepare(
      `UPDATE leads SET etapa = 'convertido', socio_id = ?, etapa_desde = datetime('now'), actualizado = datetime('now')
        WHERE email = ? AND etapa NOT IN ('convertido')`,
    ).bind(socio.id, lemail).run().catch(() => { /* sin lead no pasa nada */ });
  }

  const respuestaSocio = { id: socio.id, nombre: socio.nombre, telefono: socio.telefono, email: socio.email || null, creado: opts.creado };

  // d/f) declaración: si ya hay una activa, no se genera otra (idempotente)
  const dec = await env.DB.prepare(
    `SELECT id, estado FROM declaraciones WHERE socio_id = ? AND estado != 'anulada' ORDER BY id DESC LIMIT 1`,
  ).bind(socio.id).first<{ id: number; estado: string }>();
  if (dec) {
    return json({
      ok: true, paso: 'listo', socio: respuestaSocio, declaracion_id: dec.id,
      ya_firmada: dec.estado === 'firmada' || dec.estado === 'verificada',
    });
  }

  // sin diagnóstico no hay DDJJ (es lo que funda la prescripción); y sin
  // domicilio el papel sale incompleto — se piden juntos en un solo paso
  if (!opts.diagnostico || !socio.domicilio) {
    return json({
      ok: true, paso: 'falta_diagnostico', socio_id: socio.id, socio: respuestaSocio,
      diagnostico: opts.diagnostico || null,
      falta_telefono: !socio.telefono,
      falta_domicilio: !socio.domicilio,
    });
  }

  const res = await generarDeclaracion(env, socio.id, {
    nombre: socio.nombre, documento: socio.documento,
    domicilio: socio.domicilio, localidad: socio.localidad, provincia: socio.provincia,
  }, opts.diagnostico, auth.email);

  return json({ ok: true, paso: 'listo', socio: respuestaSocio, declaracion_id: res.declaracion_id, ya_firmada: false });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'reprocann_editar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);

  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const telefono = String(b.telefono || '').trim().slice(0, 30) || null;
  const diagnostico = String(b.diagnostico || '').trim() || null;
  if (diagnostico && diagnostico.length > 300) return json({ error: 'El diagnóstico es muy largo (máx. 300)' }, 400);

  // ---- decodificar el PDF si vino (mismas validaciones que certificado.ts) ----
  let bytes: Uint8Array | null = null;
  if (b.pdf_base64) {
    const b64 = String(b.pdf_base64).replace(/^data:application\/pdf;base64,/, '');
    try {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch { return json({ error: 'El archivo no se pudo leer' }, 400); }
    if (!bytes.length) return json({ error: 'El archivo está vacío' }, 400);
    if (bytes.length > MAX_BYTES) return json({ error: 'El PDF es muy pesado (máx. 8 MB)' }, 400);
    if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      return json({ error: 'El archivo no es un PDF' }, 400);
    }
  }

  // ---- modo lead: la credencial ya está en SOLICITUDES (la subió el
  // aspirante desde el portal, con su email verificado por Google) ----
  let lead: LeadInfo | null = null;
  const leadEmail = String(b.lead_email || '').trim().toLowerCase();
  if (leadEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadEmail)) return json({ error: 'lead_email inválido' }, 400);
    let reg: Record<string, unknown> | null = null;
    try { reg = await env.INTENTOS.get(leadEmail, 'json') as Record<string, unknown> | null; } catch { reg = null; }
    const rc = reg && reg.reprocann && typeof reg.reprocann === 'object'
      ? reg.reprocann as Record<string, unknown> : {};
    lead = {
      email: leadEmail,
      telefono: telefono || (reg && reg.telefono ? String(reg.telefono).slice(0, 30) : null),
      nombre: reg && reg.name ? String(reg.name) : null,
      reprocann: rc,
    };
    if (!bytes) {
      const buf = await env.SOLICITUDES.get(`archivo:${leadEmail}`, 'arrayBuffer');
      if (!buf || !buf.byteLength) {
        return json({ error: 'Ese lead no tiene la credencial adjunta: pedile el PDF y usá el asistente subiéndolo a mano' }, 404);
      }
      if (buf.byteLength > MAX_BYTES) return json({ error: 'El PDF adjunto es muy pesado (máx. 8 MB)' }, 400);
      bytes = new Uint8Array(buf);
      if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
        return json({ error: 'El adjunto del lead no es un PDF: pedile el PDF de la credencial y subilo a mano' }, 400);
      }
    }
  }

  // ---- reenvío sobre un socio ya resuelto (paso falta_diagnostico) ----
  const socioId = Number(b.socio_id);
  if (b.socio_id != null && b.socio_id !== '' && Number.isFinite(socioId) && socioId > 0) {
    const socio = await env.DB.prepare(`SELECT ${CAMPOS_SOCIO} FROM socios WHERE id = ?`)
      .bind(socioId).first<SocioRow>();
    if (!socio) return json({ error: 'El socio no existe' }, 404);
    const datos: DatosPdf = { domicilio: String(b.domicilio || '').trim().slice(0, 200) || null };
    return convertir(env, auth, socio, {
      bytes, datos, diagnostico,
      telefono: telefono || (lead && lead.telefono) || null,
      creado: false, lead,
    });
  }

  // ---- confirmación del paso 'revisar': usar o crear la ficha ----
  if (b.confirmar_creacion) {
    const nombre = String(b.nombre || '').trim().slice(0, 120);
    const documento = String(b.documento || '').replace(/\D/g, '');
    if (!nombre) return json({ error: 'Falta el nombre' }, 400);
    if (documento.length < 7 || documento.length > 8) return json({ error: 'El DNI tiene 7 u 8 números' }, 400);
    const datos: DatosPdf = {
      domicilio: String(b.domicilio || '').trim().slice(0, 200) || null,
      localidad: String(b.localidad || '').trim().slice(0, 80) || null,
      provincia: String(b.provincia || '').trim().slice(0, 80) || null,
      vence: String(b.vence || b.reprocann_vence || '').slice(0, 10) || null,
    };

    let socio = await porDocumento(env, documento);
    let creado = false;
    if (!socio) {
      // ¿ficha previa de la misma persona sin DNI? (los socios del Excel):
      // se reusa en vez de duplicar, la misma convención que alta.ts usa
      // con el email. Revive de la papelera y marca de dónde viene.
      const porNombre = await env.DB.prepare(
        `SELECT ${CAMPOS_SOCIO} FROM socios WHERE (documento IS NULL OR documento = '')
           AND lower(nombre) = lower(?) AND (numero IS NULL OR numero != -1) LIMIT 1`,
      ).bind(nombre).first<SocioRow>();
      if (porNombre) {
        await env.DB.prepare(
          `UPDATE socios SET documento = ?, reprocann_estado = 'autocultivo',
                  reprocann_actualizado = datetime('now'), estado = 'activo', papelera = NULL,
                  actualizado = datetime('now') WHERE id = ?`,
        ).bind(documento, porNombre.id).run();
        socio = { ...porNombre, documento };
      } else {
        // ficha mínima, con las columnas que setea alta.ts (numero queda NULL,
        // el email llega después cuando la persona entre a la carta)
        const r = await env.DB.prepare(
          `INSERT INTO socios (nombre, telefono, documento, estado, alta,
                   reprocann_estado, reprocann_vence, reprocann_actualizado)
           VALUES (?, ?, ?, 'activo', date('now'), 'autocultivo', ?, datetime('now'))`,
        ).bind(nombre, telefono, documento, datos.vence).run();
        socio = {
          id: Number(r.meta.last_row_id), nombre, telefono, documento,
          domicilio: null, localidad: null, provincia: null, reprocann_vence: datos.vence,
        };
        creado = true;
      }
    }
    return convertir(env, auth, socio, {
      bytes, datos, diagnostico,
      telefono: telefono || (lead && lead.telefono) || null,
      creado, lead,
    });
  }

  // ---- arranque: el PDF habla primero ----
  if (!bytes) return json({ error: 'Falta el PDF del certificado' }, 400);

  let leido: DatosCertificado = {};
  try { leido = await leerCertificado(bytes.buffer as ArrayBuffer, env.AI); } catch { /* PDF ilegible: se revisa a mano */ }
  const { texto: _texto, ...leidoSinTexto } = leido;

  // lo que aspirante.ts ya había leído del mismo PDF suple lo que esta
  // pasada no saque (p. ej. cupo de visión agotado hoy)
  const rcStr = (k: string) => { const v = lead ? lead.reprocann[k] : null; return v == null ? null : String(v); };
  const rcPlantas = () => { const v = lead ? Number(lead.reprocann.plantas) : NaN; return Number.isFinite(v) ? v : null; };

  // matcheo: primero por documento (el DNI del lead o el leído del PDF),
  // después — solo en modo lead — por email exacto (verificado por Google)
  const dniLead = String(rcStr('dni') || '').replace(/\D/g, '');
  const dni = dniLead.length >= 7 && dniLead.length <= 8 ? dniLead : String(leido.dni || '').replace(/\D/g, '');
  let socio = dni.length >= 7 && dni.length <= 8 ? await porDocumento(env, dni) : null;
  if (!socio && lead) socio = await porEmail(env, lead.email);
  if (!socio) {
    // sin DNI legible o sin socio con ese DNI: que el panel confirme o
    // corrija antes de crear a nadie
    const leidoFinal = lead ? {
      ...leidoSinTexto,
      nombre: leidoSinTexto.nombre || lead.nombre || undefined,
      dni: leidoSinTexto.dni || rcStr('dni') || undefined,
      domicilio: leidoSinTexto.domicilio || rcStr('domicilio') || undefined,
      localidad: leidoSinTexto.localidad || rcStr('localidad') || undefined,
      provincia: leidoSinTexto.provincia || rcStr('provincia') || undefined,
      vence: leidoSinTexto.vence || rcStr('vence') || undefined,
    } : leidoSinTexto;
    return json({ ok: true, paso: 'revisar', leido: leidoFinal });
  }

  return convertir(env, auth, socio, {
    bytes,
    datos: {
      domicilio: leido.domicilio || rcStr('domicilio'), localidad: leido.localidad || rcStr('localidad'),
      provincia: leido.provincia || rcStr('provincia'), vence: leido.vence || rcStr('vence'),
      tramite: leido.tramite || rcStr('tramite'), plantas: leido.plantas ?? rcPlantas(),
    },
    diagnostico: diagnostico || (leido.diagnostico ? leido.diagnostico.slice(0, 300) : null),
    telefono: telefono || (lead && lead.telefono) || null,
    creado: false,
    lead,
  });
};
