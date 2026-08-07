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
//     { pdf_base64, confirmar_creacion, nombre, documento, … }
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
  telefono: string | null;
  documento: string | null;
  domicilio: string | null;
  localidad: string | null;
  provincia: string | null;
  reprocann_vence: string | null;
}

const CAMPOS_SOCIO = 'id, nombre, telefono, documento, domicilio, localidad, provincia, reprocann_vence';

// El DNI es la llave (convención de alta.ts / migración 0010). Se excluye la
// fila técnica numero = -1, igual que socio.ts.
function porDocumento(env: Env, documento: string): Promise<SocioRow | null> {
  return env.DB.prepare(
    `SELECT ${CAMPOS_SOCIO} FROM socios WHERE documento = ? AND (numero IS NULL OR numero != -1) LIMIT 1`,
  ).bind(documento).first<SocioRow>();
}

// Datos del certificado que viajan del PDF (o del formulario de revisión) a
// la ficha. Solo llenan campos VACÍOS: nunca pisan lo escrito a mano
// (la regla de oro de certificado.ts).
interface DatosPdf {
  domicilio?: string | null;
  localidad?: string | null;
  provincia?: string | null;
  vence?: string | null;
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
  opts: { bytes: Uint8Array | null; datos: DatosPdf; diagnostico: string | null; telefono: string | null; creado: boolean },
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

  const respuestaSocio = { id: socio.id, nombre: socio.nombre, telefono: socio.telefono, creado: opts.creado };

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

  // ---- reenvío sobre un socio ya resuelto (paso falta_diagnostico) ----
  const socioId = Number(b.socio_id);
  if (b.socio_id != null && b.socio_id !== '' && Number.isFinite(socioId) && socioId > 0) {
    const socio = await env.DB.prepare(`SELECT ${CAMPOS_SOCIO} FROM socios WHERE id = ?`)
      .bind(socioId).first<SocioRow>();
    if (!socio) return json({ error: 'El socio no existe' }, 404);
    const datos: DatosPdf = { domicilio: String(b.domicilio || '').trim().slice(0, 200) || null };
    return convertir(env, auth, socio, { bytes, datos, diagnostico, telefono, creado: false });
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
    return convertir(env, auth, socio, { bytes, datos, diagnostico, telefono, creado });
  }

  // ---- arranque: el PDF habla primero ----
  if (!bytes) return json({ error: 'Falta el PDF del certificado' }, 400);

  let leido: DatosCertificado = {};
  try { leido = await leerCertificado(bytes.buffer as ArrayBuffer, env.AI); } catch { /* PDF ilegible: se revisa a mano */ }
  const { texto: _texto, ...leidoSinTexto } = leido;

  const dni = String(leido.dni || '').replace(/\D/g, '');
  const socio = dni.length >= 7 && dni.length <= 8 ? await porDocumento(env, dni) : null;
  if (!socio) {
    // sin DNI legible o sin socio con ese DNI: que el panel confirme o
    // corrija antes de crear a nadie
    return json({ ok: true, paso: 'revisar', leido: leidoSinTexto });
  }

  return convertir(env, auth, socio, {
    bytes,
    datos: { domicilio: leido.domicilio, localidad: leido.localidad, provincia: leido.provincia, vence: leido.vence },
    diagnostico: diagnostico || (leido.diagnostico ? leido.diagnostico.slice(0, 300) : null),
    telefono,
    creado: false,
  });
};
