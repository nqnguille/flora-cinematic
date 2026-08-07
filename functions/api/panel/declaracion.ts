// Declaración jurada de vinculación — el papel con el que un autocultivador
// se pasa a Flora. La Res. 1780/2025 hace excluyentes las modalidades: para
// vincularse a la asociación tiene que renunciar al autocultivo, y eso es lo
// que declara y firma.
//
// El flujo real es de papel, así que el sistema hace las dos puntas:
//   1) GENERA el documento con los datos del socio ya puestos (se imprime o
//      se manda como PDF desde el navegador),
//   2) GUARDA el papel firmado que vuelve, y deja el trámite en el paso que
//      corresponde.
//
//   GET    ?socio_id=X              → última declaración + datos para prellenar
//   GET    ?socio_id=X&ver=1        → el documento listo para imprimir (HTML)
//   GET    ?declaracion_id=X&firmada=1 → baja el papel firmado
//   POST   {socio_id, diagnostico, domicilio?} → genera y registra
//   POST   {declaracion_id, archivo_base64, archivo_tipo} → adjunta la firmada
//   DELETE {declaracion_id}         → anula
import { requireCap } from './_rol';

interface Env {
  DB: D1Database;
  GENETICAS: KVNamespace;
  CERTIFICADOS: KVNamespace;
  SOLICITUDES: KVNamespace;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

const MAX_BYTES = 8 * 1024 * 1024;
const TIPOS_OK = ['application/pdf', 'image/jpeg', 'image/png'];

// La plantilla es editable desde KV (clave `ddjj_plantilla` en GENETICAS) para
// que se pueda corregir sin tocar código cuando la abogada revise el texto.
// Esto de acá es el default: la plantilla del estudio, adaptada a Flora.
const PLANTILLA_DEFAULT = {
  version: '2026-08-04b',
  titulo: 'DECLARACIÓN JURADA DEL PACIENTE',
  subtitulo: 'Res. 1780/2025 · Ministerio de Salud de la Nación',
  entidad: 'ASOCIACIÓN CIVIL CANN DE CANNABIS MEDICINAL',
  cuit: '30-71827609-4',
  medico: 'Dr. Ezequiel Kalb',
  matricula: 'MN 191182',
  ciudad: 'Neuquén',
  cuerpo: [
    'Yo, {nombre}, DNI N° {dni}, con domicilio en {domicilio}, declaro bajo juramento lo siguiente:',
    'Que me encuentro bajo tratamiento médico supervisado por {medico}, Matrícula Profesional N° {matricula}, en su carácter de Director Médico de la {entidad}, quien ha prescripto el uso de cannabis medicinal con fines terapéuticos y/o paliativos del dolor, en virtud de un diagnóstico fundado que acredita la existencia de {diagnostico}, conforme a lo previsto por la Ley N° 27.350 y su normativa reglamentaria.',
    'Que he otorgado al referido profesional mi consentimiento informado, habiendo sido debidamente asesorado respecto de los alcances, beneficios, limitaciones y riesgos del tratamiento prescripto, en cumplimiento de los principios de autonomía y acceso informado a terapias reguladas por el Estado Nacional.',
    'Que, en virtud de lo anterior, he solicitado voluntariamente ser incorporado como usuario vinculado a la {entidad}, CUIT N° {cuit}, organización inscripta en el REPROCANN y dedicada al acompañamiento de pacientes que requieren cannabis medicinal.',
    'Que presto mi conformidad expresa para que dicha organización solicite mi vinculación como paciente ante el REPROCANN, y renuncio de manera voluntaria e informada a ejercer el rol de autocultivador, así como a delegar el cultivo en otro sujeto autorizado por ley, distinto de la organización mencionada.',
    'Que presto mi consentimiento expreso e informado para que la presente declaración, así como los antecedentes médicos pertinentes vinculados a mi tratamiento, sean presentados por la {entidad} ante la autoridad competente, a efectos de la tramitación de mi vinculación, garantizando así la continuidad del tratamiento indicado y el pleno ejercicio de mis derechos.',
  ],
  cierre: 'En prueba de conformidad, firmo la presente declaración jurada en la ciudad de {ciudad}, a los {dia} días del mes de {mes} del año {anio}.',
};

type Plantilla = typeof PLANTILLA_DEFAULT;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

async function leerPlantilla(env: Env): Promise<Plantilla> {
  try {
    const guardada = await env.GENETICAS.get('ddjj_plantilla', 'json');
    if (guardada && typeof guardada === 'object') return { ...PLANTILLA_DEFAULT, ...(guardada as object) } as Plantilla;
  } catch { /* si el KV falla, vale el default */ }
  return PLANTILLA_DEFAULT;
}

async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface DatosSocio {
  nombre: string; documento?: string | null;
  domicilio?: string | null; localidad?: string | null; provincia?: string | null;
}

// Arma el texto final. Devuelve los párrafos ya resueltos: es lo que se
// imprime y lo que se hashea, así el hash prueba exactamente qué firmó.
function armarTexto(p: Plantilla, s: DatosSocio, diagnostico: string, fecha: Date) {
  const domicilioCompleto = [s.domicilio, s.localidad, s.provincia].filter(Boolean).join(', ');
  const vars: Record<string, string> = {
    nombre: s.nombre || '',
    dni: s.documento || '',
    domicilio: domicilioCompleto,
    diagnostico: diagnostico,
    medico: p.medico,
    matricula: p.matricula,
    entidad: p.entidad,
    cuit: p.cuit,
    ciudad: p.ciudad,
    dia: String(fecha.getUTCDate()).padStart(2, '0'),
    mes: MESES[fecha.getUTCMonth()],
    anio: String(fecha.getUTCFullYear()),
  };
  const resolver = (t: string) => t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
  return {
    parrafos: p.cuerpo.map(resolver),
    cierre: resolver(p.cierre),
    vars,
  };
}

function documentoHtml(p: Plantilla, texto: ReturnType<typeof armarTexto>, hash: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8" />
<title>Declaración jurada · ${esc(texto.vars.nombre)}</title>
<style>
  @page { size: A4; margin: 22mm 20mm; }
  body { font-family: Georgia, "Times New Roman", serif; font-size: 11.5pt; line-height: 1.6; color: #111; margin: 0; }
  .hoja { max-width: 700px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 13pt; letter-spacing: .06em; text-align: center; margin: 0 0 4px; }
  .sub { text-align: center; font-size: 9.5pt; color: #555; margin: 0 0 28px; }
  p { margin: 0 0 13px; text-align: justify; }
  .cierre { margin-top: 24px; }
  .firmas { margin-top: 52px; line-height: 2.4; }
  .pie { margin-top: 34px; padding-top: 8px; border-top: 1px solid #ccc; font-size: 7.5pt; color: #888; font-family: ui-monospace, monospace; }
  .barra { position: sticky; top: 0; background: #f4f2f7; border-bottom: 1px solid #ddd; padding: 10px 16px; text-align: center; font-family: system-ui, sans-serif; font-size: 13px; }
  .barra button { font: inherit; padding: 6px 14px; border: 1px solid #381f56; background: #381f56; color: #fff; border-radius: 3px; cursor: pointer; }
  @media print { .barra { display: none; } .hoja { padding: 0; } }
</style></head><body>
<div class="barra">Imprimí o guardá como PDF, y hacela firmar. <button onclick="window.print()" type="button">Imprimir</button></div>
<div class="hoja">
  <h1>${esc(p.titulo)}</h1>
  <p class="sub">${esc(p.subtitulo)}</p>
  ${texto.parrafos.map((t) => `<p>${esc(t)}</p>`).join('\n  ')}
  <p class="cierre">${esc(texto.cierre)}</p>
  <div class="firmas">
    Firma del paciente: ......................................................<br />
    Aclaración: ..............................................................<br />
    DNI: .....................................................................
  </div>
  <p class="pie">${esc(p.entidad)} · CUIT ${esc(p.cuit)} · plantilla ${esc(p.version)} · ${esc(hash.slice(0, 16))}</p>
</div></body></html>`;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'padron_ver');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const url = new URL(request.url);

  // bajar el papel firmado
  const decId = Number(url.searchParams.get('declaracion_id'));
  if (url.searchParams.get('firmada') && Number.isFinite(decId)) {
    const d = await env.DB.prepare(
      `SELECT d.archivo_tipo, s.nombre FROM declaraciones d JOIN socios s ON s.id = d.socio_id WHERE d.id = ?`,
    ).bind(decId).first<{ archivo_tipo: string; nombre: string }>();
    if (!d) return json({ error: 'No existe' }, 404);
    const bin = await env.CERTIFICADOS.get(`ddjj:${decId}`, 'arrayBuffer');
    if (!bin) return json({ error: 'Sin archivo' }, 404);
    const ext = d.archivo_tipo === 'application/pdf' ? 'pdf' : d.archivo_tipo === 'image/png' ? 'png' : 'jpg';
    const nombreArchivo = `DDJJ ${d.nombre}.${ext}`.replace(/[^\w\s.\-áéíóúÁÉÍÓÚñÑ]/g, '');
    return new Response(bin, {
      headers: {
        'Content-Type': d.archivo_tipo || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${nombreArchivo}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  // Desde un LEAD: todavía no hay ficha, así que el papel se arma con lo que
  // cargó al inscribirse. Sirve para mandárselo y que lo devuelva firmado; la
  // declaración se registra recién cuando la persona tiene ficha.
  // Number(null) es 0 y 0 es finito: con el guard viejo, TODO GET con
  // socio_id se desviaba a buscar el lead id 0 y moría en "El lead no
  // existe" (para el 100% de los socios; la rama de socio era código
  // muerto). El parámetro tiene que EXISTIR para entrar acá.
  const leadParam = url.searchParams.get('lead_id');
  const leadId = Number(leadParam);
  if (leadParam !== null && Number.isFinite(leadId)) {
    const lead = await env.DB.prepare(
      `SELECT id, nombre, email, telefono, nota FROM leads WHERE id = ?`,
    ).bind(leadId).first<{ id: number; nombre: string; email: string | null; telefono: string | null; nota: string | null }>();
    if (!lead) return json({ error: 'El lead no existe' }, 404);

    let dni: string | null = null;
    let tieneAdjunto = false;
    if (lead.email) {
      const mail = String(lead.email).toLowerCase();
      try {
        const sol = await env.SOLICITUDES.get(mail, 'json') as Record<string, unknown> | null;
        if (sol && sol.dni) dni = String(sol.dni).replace(/\D/g, '') || null;
      } catch { /* sin solicitud, se completa a mano */ }
      try {
        const adj = await env.SOLICITUDES.getWithMetadata(`archivo:${mail}`, 'stream');
        if (adj?.value) { tieneAdjunto = true; try { await adj.value.cancel(); } catch { /* ya cerrado */ } }
      } catch { /* sin adjunto */ }
    }
    const p = await leerPlantilla(env);
    return json({
      ok: true,
      lead: { id: lead.id, nombre: lead.nombre, email: lead.email, telefono: lead.telefono, dni, tieneAdjunto },
      plantilla: { version: p.version, medico: p.medico, matricula: p.matricula, entidad: p.entidad },
    });
  }

  const socioId = Number(url.searchParams.get('socio_id'));
  if (!Number.isFinite(socioId)) return json({ error: 'Falta socio_id o lead_id' }, 400);

  const socio = await env.DB.prepare(
    `SELECT id, nombre, documento, domicilio, localidad, provincia, reprocann_estado FROM socios WHERE id = ?`,
  ).bind(socioId).first<DatosSocio & { id: number; reprocann_estado: string }>();
  if (!socio) return json({ error: 'El socio no existe' }, 404);

  // ver el documento de una declaración ya generada, para reimprimir
  if (url.searchParams.get('ver')) {
    const dec = await env.DB.prepare(
      `SELECT id, texto_hash, generada, nota FROM declaraciones
        WHERE socio_id = ? AND estado != 'anulada' ORDER BY id DESC LIMIT 1`,
    ).bind(socioId).first<{ id: number; texto_hash: string; generada: string; nota: string | null }>();
    if (!dec) return json({ error: 'Todavía no se generó ninguna' }, 404);
    const p = await leerPlantilla(env);
    // el diagnóstico se guarda en `nota` porque es el único dato clínico que
    // toca el club, y solo para poder reimprimir el mismo papel
    const texto = armarTexto(p, socio, dec.nota || '', new Date(String(dec.generada).replace(' ', 'T') + 'Z'));
    return new Response(documentoHtml(p, texto, dec.texto_hash), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
    });
  }

  const dec = await env.DB.prepare(
    `SELECT id, estado, version, texto_hash, generada, generada_por, firmada, firmada_por,
            archivo_bytes, archivo_tipo, verificada, verificada_por, firma_texto
       FROM declaraciones WHERE socio_id = ? ORDER BY id DESC LIMIT 1`,
  ).bind(socioId).first();
  const p = await leerPlantilla(env);

  return json({
    ok: true,
    socio: {
      nombre: socio.nombre, documento: socio.documento || null,
      domicilio: socio.domicilio || null, localidad: socio.localidad || null, provincia: socio.provincia || null,
      reprocann_estado: socio.reprocann_estado,
    },
    declaracion: dec || null,
    plantilla: { version: p.version, medico: p.medico, matricula: p.matricula, entidad: p.entidad },
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'reprocann_editar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // ---- adjuntar el papel firmado ----
  if (body.archivo_base64) {
    const decId = Number(body.declaracion_id);
    if (!Number.isFinite(decId)) return json({ error: 'Falta declaracion_id' }, 400);
    const dec = await env.DB.prepare(`SELECT id, socio_id, estado FROM declaraciones WHERE id = ?`)
      .bind(decId).first<{ id: number; socio_id: number; estado: string }>();
    if (!dec) return json({ error: 'La declaración no existe' }, 404);
    if (dec.estado === 'anulada') return json({ error: 'Esa declaración está anulada' }, 409);

    const tipo = String(body.archivo_tipo || '');
    if (!TIPOS_OK.includes(tipo)) return json({ error: 'Subí un PDF o una foto (JPG o PNG)' }, 400);

    const b64 = String(body.archivo_base64).replace(/^data:[^;]+;base64,/, '');
    let bytes: Uint8Array;
    try {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch { return json({ error: 'El archivo no se pudo leer' }, 400); }
    if (!bytes.length) return json({ error: 'El archivo está vacío' }, 400);
    if (bytes.length > MAX_BYTES) return json({ error: 'El archivo es muy pesado (máx. 8 MB)' }, 400);
    if (tipo === 'application/pdf' && !(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      return json({ error: 'Ese archivo no es un PDF' }, 400);
    }

    await env.CERTIFICADOS.put(`ddjj:${decId}`, bytes.buffer as ArrayBuffer);
    await env.DB.prepare(
      `UPDATE declaraciones SET estado = 'firmada', firmada = datetime('now'), firmada_por = ?,
        archivo_bytes = ?, archivo_tipo = ? WHERE id = ?`,
    ).bind(auth.email, bytes.length, tipo, decId).run();
    // el trámite avanza solo: ya no espera al paciente, ahora nos toca a nosotros
    await env.DB.prepare(
      `UPDATE socios SET reprocann_estado = 'ddjj_firmada', reprocann_actualizado = datetime('now')
        WHERE id = ? AND reprocann_estado IN ('autocultivo', 'ddjj_pendiente')`,
    ).bind(dec.socio_id).run();
    return json({ ok: true, bytes: bytes.length });
  }

  // ---- verificar la firmada (el proceso interno de doble control) ----
  // Es un acto SEPARADO de subir el archivo, con su propio registro de quién
  // y cuándo. En una organización chica puede verificar la misma persona que
  // subió: lo que importa es que sea una decisión explícita y quede firmado
  // el rastro. Recién la declaración VERIFICADA devuelve al ex-autocultivador
  // al embudo normal (esperando_codigo), que es lo que le abre el débito.
  if (body.verificar) {
    const decId = Number(body.declaracion_id);
    if (!Number.isFinite(decId)) return json({ error: 'Falta declaracion_id' }, 400);
    const dec = await env.DB.prepare(`SELECT id, socio_id, estado FROM declaraciones WHERE id = ?`)
      .bind(decId).first<{ id: number; socio_id: number; estado: string }>();
    if (!dec) return json({ error: 'La declaración no existe' }, 404);
    if (dec.estado !== 'firmada') return json({ error: 'Primero tiene que estar firmada' }, 409);
    await env.DB.prepare(
      `UPDATE declaraciones SET estado = 'verificada', verificada = datetime('now'), verificada_por = ? WHERE id = ?`,
    ).bind(auth.email, decId).run();
    await env.DB.prepare(
      `UPDATE socios SET reprocann_estado = 'esperando_codigo', reprocann_actualizado = datetime('now')
        WHERE id = ? AND reprocann_estado IN ('autocultivo', 'ddjj_pendiente', 'ddjj_firmada')`,
    ).bind(dec.socio_id).run();
    return json({ ok: true, verificada: true });
  }

  const diagnostico = String(body.diagnostico || '').trim();
  if (!diagnostico) return json({ error: 'Falta el diagnóstico: es lo que funda la prescripción' }, 400);
  if (diagnostico.length > 300) return json({ error: 'El diagnóstico es muy largo (máx. 300)' }, 400);

  // ---- generar desde un LEAD (todavía sin ficha) ----
  // Devuelve el papel para mandárselo y nada más: no hay a quién colgarle el
  // registro. Queda anotado cuando vuelva firmada, ya con ficha.
  const leadId = Number(body.lead_id);
  if (Number.isFinite(leadId)) {
    const lead = await env.DB.prepare(`SELECT id, nombre FROM leads WHERE id = ?`)
      .bind(leadId).first<{ id: number; nombre: string }>();
    if (!lead) return json({ error: 'El lead no existe' }, 404);

    const nombre = String(body.nombre || lead.nombre || '').trim();
    const dni = String(body.dni || '').replace(/\D/g, '');
    const domicilio = String(body.domicilio || '').trim().slice(0, 200);
    if (!nombre) return json({ error: 'Falta el nombre' }, 400);
    if (dni.length < 7 || dni.length > 8) return json({ error: 'El DNI tiene 7 u 8 números' }, 400);
    if (!domicilio) return json({ error: 'Falta el domicilio' }, 400);

    const p = await leerPlantilla(env);
    const datos: DatosSocio = {
      nombre, documento: dni, domicilio,
      localidad: String(body.localidad || '').trim().slice(0, 80),
      provincia: String(body.provincia || '').trim().slice(0, 80),
    };
    const texto = armarTexto(p, datos, diagnostico, new Date());
    const hash = await sha256([p.version, ...texto.parrafos, texto.cierre].join('\n'));
    return json({ ok: true, declaracion_id: null, hash, html: documentoHtml(p, texto, hash) });
  }

  // ---- generar para un socio con ficha ----
  const socioId = Number(body.socio_id);
  if (!Number.isFinite(socioId)) return json({ error: 'Falta socio_id o lead_id' }, 400);

  const socio = await env.DB.prepare(
    `SELECT id, nombre, documento, domicilio, localidad, provincia FROM socios WHERE id = ?`,
  ).bind(socioId).first<DatosSocio & { id: number }>();
  if (!socio) return json({ error: 'El socio no existe' }, 404);

  // el domicilio puede llegar en la misma llamada (se completa al generar)
  const domicilio = 'domicilio' in body ? String(body.domicilio || '').trim().slice(0, 200) : (socio.domicilio || '');
  const localidad = 'localidad' in body ? String(body.localidad || '').trim().slice(0, 80) : (socio.localidad || '');
  const provincia = 'provincia' in body ? String(body.provincia || '').trim().slice(0, 80) : (socio.provincia || '');
  if (!domicilio) return json({ error: 'Falta el domicilio del socio' }, 400);
  if (!socio.documento) return json({ error: 'El socio no tiene DNI cargado: sin eso la declaración no sirve' }, 400);

  if ('domicilio' in body || 'localidad' in body || 'provincia' in body) {
    await env.DB.prepare(
      `UPDATE socios SET domicilio = ?, localidad = ?, provincia = ?, actualizado = datetime('now') WHERE id = ?`,
    ).bind(domicilio || null, localidad || null, provincia || null, socioId).run();
  }

  const p = await leerPlantilla(env);
  const ahora = new Date();
  const datos: DatosSocio = { ...socio, domicilio, localidad, provincia };
  const texto = armarTexto(p, datos, diagnostico, ahora);
  const hash = await sha256([p.version, ...texto.parrafos, texto.cierre].join('\n'));

  const ins = await env.DB.prepare(
    `INSERT INTO declaraciones (socio_id, tipo, version, texto_hash, estado, generada_por, nota)
      VALUES (?, 'vinculacion', ?, ?, 'generada', ?, ?)`,
  ).bind(socioId, p.version, hash, auth.email, diagnostico).run();
  const decId = Number(ins.meta?.last_row_id);

  // queda esperando la firma del paciente
  await env.DB.prepare(
    `UPDATE socios SET reprocann_estado = 'ddjj_pendiente', reprocann_actualizado = datetime('now')
      WHERE id = ? AND reprocann_estado IN ('autocultivo', 'sin_iniciar', 'revisar')`,
  ).bind(socioId).run();

  return json({ ok: true, declaracion_id: decId, hash, html: documentoHtml(p, texto, hash) });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'reprocann_editar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  let body: { declaracion_id?: number };
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const decId = Number(body.declaracion_id);
  if (!Number.isFinite(decId)) return json({ error: 'Falta declaracion_id' }, 400);
  // se anula, no se borra: el registro de que existió es parte de la evidencia
  await env.DB.prepare(`UPDATE declaraciones SET estado = 'anulada' WHERE id = ?`).bind(decId).run();
  await env.CERTIFICADOS.delete(`ddjj:${decId}`);
  return json({ ok: true });
};
