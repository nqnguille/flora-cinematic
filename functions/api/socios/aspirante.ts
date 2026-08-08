import { verifyGoogleIdToken } from './_google';
import { leerCertificado, type DatosCertificado } from '../panel/_certpdf';

interface Env {
  SOCIOS: KVNamespace;
  INTENTOS: KVNamespace;
  SOLICITUDES: KVNamespace;
  AI: Ai;
  GOOGLE_CLIENT_ID: string;
  NOTIFY_TOKEN?: string;
}

const NOTIFY_URL = 'https://gates-analytics.nqnguille.workers.dev/api/notify';

// 8 MB de PDF; en base64 eso son ~10,7 MB de caracteres. El tope de chars se
// chequea ANTES de decodificar para no armar un buffer gigante al pedo.
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_B64_CHARS = Math.ceil(MAX_BYTES / 3) * 4 + 64;

// La puerta de entrada del AUTOCULTIVADOR con REPROCANN aprobado: alguien que
// probó entrar con Google al portal, no está en el padrón (403 del login) y en
// vez de irse con un rechazo seco sube su credencial ahí mismo. La identidad
// ya viene verificada por Google (mismo credential del login), el PDF queda en
// SOLICITUDES como cualquier adjunto de solicitud, y el registro de INTENTOS
// (el que alimenta el tablero de Leads del panel) se enriquece con lo que la
// lectura del certificado haya podido sacar — queda como lead "listo para
// convertir". Si la lectura falla o el cupo de Workers AI está agotado, NO es
// error: el archivo ya está guardado y el panel lo relee después.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let credential = '';
  let pdfB64 = '';
  let telefono = '';
  try {
    const body = await request.json();
    credential = String(body?.credential || '');
    pdfB64 = String(body?.pdf_base64 || '');
    telefono = String(body?.telefono || '').trim().slice(0, 40);
  } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }
  if (!credential) {
    return Response.json({ ok: false, error: 'falta el credential de Google' }, { status: 400 });
  }
  if (!pdfB64) {
    return Response.json({ ok: false, error: 'falta el PDF de la credencial' }, { status: 400 });
  }

  // Identidad: el mismo ID token que acaba de rebotar en el login. Nada de
  // emails tipeados a mano — el email sale verificado de Google.
  let email: string;
  let payload: Awaited<ReturnType<typeof verifyGoogleIdToken>>;
  try {
    payload = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID);
    email = payload.email.toLowerCase();
  } catch (err: any) {
    return Response.json({ ok: false, error: `token de Google inválido: ${err.message}` }, { status: 401 });
  }

  // Un socio del padrón no pasa por acá: su certificado vive en Mi cuenta.
  const yaSocio = await env.SOCIOS.get(email);
  if (yaSocio !== null) {
    return Response.json(
      { ok: false, error: 'Ya sos socio: entrá y subilo desde Mi cuenta.' },
      { status: 409 }
    );
  }

  // Rate-limit mínimo: una credencial ya recibida y leída no se re-sube — el
  // equipo ya tiene todo para contactarlo (y esto corta reintentos en loop).
  const prevRaw = await env.INTENTOS.get(email);
  let prev: any = {};
  try { prev = prevRaw ? JSON.parse(prevRaw) : {}; } catch { prev = {}; }
  if (typeof prev !== 'object' || prev === null) prev = {};
  if (prev.reprocannLeido) {
    const yaTieneArchivo = await env.SOLICITUDES.get(`archivo:${email}`, { type: 'stream' });
    if (yaTieneArchivo !== null) {
      return Response.json(
        { ok: false, error: 'Ya recibimos tu credencial, te contactamos en breve.' },
        { status: 409 }
      );
    }
  }

  // El PDF viaja en base64 dentro del JSON (mismo credential + archivo en un
  // solo POST). Se tolera que venga como data URI.
  const b64 = pdfB64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (b64.length > MAX_B64_CHARS) {
    return Response.json({ ok: false, error: 'el archivo supera los 8 MB' }, { status: 413 });
  }
  let bytes: Uint8Array;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return Response.json({ ok: false, error: 'el archivo llegó dañado, probá de nuevo' }, { status: 400 });
  }
  if (bytes.byteLength > MAX_BYTES) {
    return Response.json({ ok: false, error: 'el archivo supera los 8 MB' }, { status: 413 });
  }
  // %PDF- al inicio: acá solo se acepta PDF (la credencial oficial se
  // descarga en PDF; una foto no trae capa de texto ni imágenes extraíbles).
  const cabecera = String.fromCharCode(...bytes.subarray(0, 5));
  if (cabecera !== '%PDF-') {
    return Response.json({ ok: false, error: 'subí el PDF de tu credencial REPROCANN (no una foto)' }, { status: 415 });
  }

  const now = new Date().toISOString();

  // El binario va a SOLICITUDES con el mismo formato que un adjunto de
  // solicitud (ver solicitud-adjunto.ts): documento con datos personales, NO
  // va al KV público de fotos; se sirve solo desde el panel con super admin.
  const buf = bytes.buffer as ArrayBuffer;
  await env.SOLICITUDES.put(`archivo:${email}`, buf, {
    metadata: { contentType: 'application/pdf', filename: 'reprocann.pdf', size: bytes.byteLength },
  });

  // Registro de solicitud (clave = email) para que el panel vea el adjunto y
  // el contexto sin pedir el binario. Merge sobre lo que ya haya — si mandó
  // el formulario de solicitud antes, no se le pisa nada.
  try {
    const solRaw = await env.SOLICITUDES.get(email);
    let sol: any = {};
    try { sol = solRaw ? JSON.parse(solRaw) : {}; } catch { sol = {}; }
    if (typeof sol !== 'object' || sol === null) sol = {};
    sol.name = sol.name || payload.name || '';
    if (telefono && !sol.phone) sol.phone = telefono;
    sol.intent = sol.intent || 'acceso';
    sol.aspirante = true;
    sol.tieneAdjunto = true;
    sol.creado = sol.creado || now;
    sol.actualizado = now;
    await env.SOLICITUDES.put(email, JSON.stringify(sol));
  } catch {
    /* el registro acompaña, el archivo ya quedó guardado */
  }

  // Lectura del certificado (texto + visión de Workers AI). Puede volver
  // vacía — PDF escaneado, cupo diario gratis agotado (error 4006)... — y no
  // pasa nada: el flujo sigue y el panel relee cuando lo convierte.
  let datos: DatosCertificado = {};
  try {
    datos = await leerCertificado(buf, env.AI);
  } catch (e) {
    console.error('aspirante: fallo leerCertificado:', e);
    datos = {};
  }

  // El lead del tablero (INTENTOS, mismo shape que escribe login.ts en el
  // 403) se enriquece con merge: se preserva lo que ya había y se suman solo
  // las claves con valor.
  try {
    const reprocann: Record<string, unknown> = {};
    if (datos.dni) reprocann.dni = datos.dni;
    if (datos.vence) reprocann.vence = datos.vence;
    if (datos.tramite) reprocann.tramite = datos.tramite;
    if (datos.plantas !== undefined) reprocann.plantas = datos.plantas;
    if (datos.modalidad) reprocann.modalidad = datos.modalidad;
    if (datos.domicilio) reprocann.domicilio = datos.domicilio;
    if (datos.localidad) reprocann.localidad = datos.localidad;
    if (datos.provincia) reprocann.provincia = datos.provincia;

    const rec: any = {
      ...prev,
      name: payload.name || prev.name || '',
      picture: payload.picture || prev.picture || '',
      locale: payload.locale || prev.locale || '',
      firstAttempt: prev.firstAttempt || now,
      lastAttempt: now,
      attempts: prev.attempts || 0,
      aspirante: true,
      reprocannLeido: now,
    };
    if (telefono) rec.telefono = telefono;
    if (Object.keys(reprocann).length) rec.reprocann = { ...(prev.reprocann || {}), ...reprocann };
    await env.INTENTOS.put(email, JSON.stringify(rec));
  } catch {
    /* el lead enriquecido es lo deseable, no condición del OK: el PDF ya está */
  }

  await notificarAspirante(env, {
    name: payload.name || email,
    email,
    modalidad: datos.modalidad,
    vence: datos.vence,
  });

  // Al usuario se le devuelve SOLO lo legible de lo que él mismo subió —
  // para el "¡listo!" con resumen. Sin texto crudo ni diagnóstico.
  const leido: Record<string, unknown> = {};
  if (datos.nombre) leido.nombre = datos.nombre;
  if (datos.dni) leido.dni = datos.dni;
  if (datos.vence) leido.vence = datos.vence;
  if (datos.modalidad) leido.modalidad = datos.modalidad;
  if (datos.plantas !== undefined) leido.plantas = datos.plantas;
  if (datos.tramite) leido.tramite = datos.tramite;
  return Response.json({ ok: true, leido });
};

// Aviso por el hub central (mismo patrón que login.ts, topic 'flora-intento':
// es el canal de los leads del tablero). Nunca bloquea la subida.
async function notificarAspirante(
  env: Env,
  p: { name: string; email: string; modalidad?: string; vence?: string }
) {
  if (!env.NOTIFY_TOKEN) return;
  const detalle = [p.modalidad, p.vence ? `vence ${p.vence}` : ''].filter(Boolean).join(', ');
  const text =
    `🌱 ASPIRANTE AUTOCULTIVADOR — ${p.name} subió su credencial REPROCANN` +
    (detalle ? ` (${detalle}).` : '.') + `\n` +
    `📧 ${p.email}\n` +
    `Convertilo desde Leads: https://floraong.ar/admin/`;
  try {
    await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, token: env.NOTIFY_TOKEN, topic: 'flora-intento' }),
    });
  } catch {
    /* el aviso nunca bloquea */
  }
}
