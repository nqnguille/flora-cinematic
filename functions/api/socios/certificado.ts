// La "guantera digital" del socio: descarga de SU certificado REPROCANN
// (el PDF oficial emitido por el Ministerio, guardado por el club en KV).
// Solo el dueño de la sesión puede bajar el suyo — nunca el de otro.
//
// POST: la puerta de autoservicio del autocultivador. Sube su propio PDF una
// única vez (si ya hay uno cargado, se reemplaza solo desde el panel), el
// sistema lo lee (texto o visión) para completar los campos VACÍOS de su
// ficha, y si el certificado trae el diagnóstico y él está en el circuito de
// conversión, su declaración jurada de renuncia queda generada al toque:
// sube el PDF y firma en la misma sentada.
import { readSessionEmail } from './_session';
import { leerCertificado } from '../panel/_certpdf';
import { generarDeclaracion } from '../panel/declaracion';
import type { DatosSocio } from '../panel/declaracion';

interface Env {
  DB: D1Database;
  SOCIOS: KVNamespace;
  CERTIFICADOS: KVNamespace;
  GENETICAS: KVNamespace;
  SESSION_SECRET: string;
  NOTIFY_TOKEN?: string;
  AI?: Ai;
  // Medidor central de consumo de IA. Opcional: sin token no se mide y listo.
  CONSUMO_TOKEN?: string;
}

const NOTIFY_URL = 'https://gates-analytics.nqnguille.workers.dev/api/notify';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB: certificados reales pesan < 1 MB

// Estados en los que tiene sentido que el socio suba su certificado él mismo:
// autocultivadores en conversión y gente cuyo trámite todavía no arrancó.
// Con el trámite ya en manos del club, el PDF lo maneja el panel.
const ESTADOS_PUEDE_SUBIR = ['autocultivo', 'ddjj_pendiente', 'sin_iniciar', 'revisar', 'esperando_codigo'];
// Y de esos, los que están en el circuito de la renuncia al autocultivo:
// solo ahí la DDJJ se genera sola (mismo criterio que ../socios/ddjj.ts).
const ESTADOS_DDJJ = ['autocultivo', 'ddjj_pendiente'];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// El aviso al equipo jamás bloquea la subida (mismo patrón que ddjj.ts).
async function avisar(env: Env, text: string): Promise<void> {
  if (!env.NOTIFY_TOKEN) return;
  try {
    await fetch(NOTIFY_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'flora-reprocann', token: env.NOTIFY_TOKEN, text }),
    });
  } catch { /* el aviso nunca bloquea */ }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return Response.json({ error: 'Sin sesión' }, { status: 401 });
  const esSocio = await env.SOCIOS.get(email.toLowerCase());
  if (!esSocio) return Response.json({ error: 'Sin acceso' }, { status: 403 });

  const s = await env.DB.prepare(
    `SELECT id, nombre FROM socios WHERE email = ? AND (numero IS NULL OR numero != -1)`,
  ).bind(email.toLowerCase()).first<{ id: number; nombre: string }>();
  if (!s) return Response.json({ error: 'Tu cuenta no está vinculada al padrón' }, { status: 404 });

  const pdf = await env.CERTIFICADOS.get(`cert:${s.id}`, 'arrayBuffer');
  if (!pdf) return Response.json({ error: 'Todavía no tenemos tu certificado cargado' }, { status: 404 });

  const nombreArchivo = `REPROCANN ${s.nombre}.pdf`.replace(/[^\w\s.\-áéíóúÁÉÍÓÚñÑ]/g, '');
  return new Response(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
      'Cache-Control': 'private, no-store',
    },
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return json({ error: 'Sin sesión' }, 401);
  const esSocio = await env.SOCIOS.get(email.toLowerCase());
  if (!esSocio) return json({ error: 'Sin acceso' }, 403);

  let body: { pdf_base64?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'Datos inválidos' }, 400); }

  const socio = await env.DB.prepare(
    `SELECT id, nombre, documento, domicilio, localidad, provincia, reprocann_estado
       FROM socios WHERE email = ? AND (numero IS NULL OR numero != -1)`,
  ).bind(email.toLowerCase()).first<DatosSocio & { id: number; reprocann_estado: string }>();
  if (!socio) return json({ error: 'Tu cuenta todavía no está en el padrón del club — escribinos.' }, 403);

  if (!ESTADOS_PUEDE_SUBIR.includes(socio.reprocann_estado)) {
    return json({ error: 'Tu trámite ya está en marcha: si hay que actualizar tu certificado, escribinos.' }, 409);
  }

  // Una sola subida por socio: si ya hay certificado, el reemplazo es una
  // decisión del club (panel), no un click más del portal.
  let yaHay = !!(await env.CERTIFICADOS.get(`cert:${socio.id}:meta`));
  if (!yaHay) {
    const prev = await env.CERTIFICADOS.get(`cert:${socio.id}`, 'stream');
    if (prev) { yaHay = true; try { await prev.cancel(); } catch { /* ya cerrado */ } }
  }
  if (yaHay) return json({ error: 'Ya tenemos tu certificado; si hay que reemplazarlo escribinos.' }, 409);

  // ── Validación del PDF: idéntica a la del panel ──
  const b64 = String(body.pdf_base64 || '').replace(/^data:application\/pdf;base64,/, '');
  if (!b64) return json({ error: 'Falta el PDF' }, 400);
  let bytes: Uint8Array;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return json({ error: 'El archivo no se pudo leer' }, 400);
  }
  if (bytes.length > MAX_BYTES) return json({ error: 'El PDF es muy pesado (máx. 8 MB)' }, 400);
  // firma %PDF- al principio: que sea un PDF de verdad
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return json({ error: 'El archivo no es un PDF' }, 400);
  }

  await env.CERTIFICADOS.put(`cert:${socio.id}`, bytes.buffer as ArrayBuffer);
  await env.CERTIFICADOS.put(`cert:${socio.id}:meta`, JSON.stringify({
    nombre: socio.nombre, bytes: bytes.length,
    subido: new Date().toISOString(), por: email,
  }));

  // ── Leer el PDF y completar SOLO los campos vacíos de la ficha ──
  // (misma regla de oro del panel: nunca pisa lo escrito a mano)
  const leido: Record<string, string> = {};
  let diagnostico = '';
  let advertencia: string | null = null;
  try {
    const datos = await leerCertificado(bytes.buffer as ArrayBuffer, env.AI, { env, esperar: waitUntil });
    // Guardia de identidad: si el PDF trae un DNI y la ficha YA tiene otro,
    // acá hay un certificado ajeno o una ficha mal cargada. El PDF ya quedó
    // guardado (evidencia), pero no se completa nada ni se genera la DDJJ:
    // lo mira una persona.
    const dniFicha = String(socio.documento || '').replace(/\D/g, '');
    if (datos.dni && dniFicha && datos.dni !== dniFicha) {
      advertencia = 'El DNI del certificado no coincide con el que tenemos en tu ficha. Lo vamos a revisar y te escribimos.';
    } else {
      diagnostico = String(datos.diagnostico || '').trim().slice(0, 300);
      const campos: Array<[string, string | undefined]> = [
        ['documento', datos.dni], ['domicilio', datos.domicilio],
        ['localidad', datos.localidad], ['provincia', datos.provincia],
        ['reprocann_vence', datos.vence],
      ];
      for (const [col, val] of campos) {
        if (!val) continue;
        try {
          const r = await env.DB.prepare(
            `UPDATE socios SET ${col} = ?, actualizado = datetime('now') WHERE id = ? AND (${col} IS NULL OR ${col} = '')`,
          ).bind(val, socio.id).run();
          if (r.meta.changes) leido[col] = val;
        } catch (e) {
          // un campo que no entra (ej: el DNI del PDF ya es de OTRA ficha,
          // documento es UNIQUE) no voltea los demás ni la subida
          console.error(`socios/certificado: no se pudo completar ${col}:`, e);
        }
      }
    }
  } catch (e) {
    // leer el PDF nunca rompe la subida — pero que quede en el log del deploy
    console.error('socios/certificado: fallo la lectura del PDF:', e);
  }

  if (advertencia) {
    await avisar(env,
      `⚠️ CERTIFICADO SUBIDO EN EL PORTAL — DNI NO COINCIDE\n👤 ${socio.nombre}\n📧 ${email}\n` +
      `El DNI que figura en el PDF no es el de su ficha. El PDF quedó guardado; revisarlo en el panel antes de seguir.\nhttps://floraong.ar/admin/`);
    return json({ ok: true, leido, ddjj_generada: false, advertencia });
  }

  // ── Si está en el circuito de conversión y no hay declaración viva, la
  //    DDJJ se genera sola con el diagnóstico OFICIAL (el del PDF) ──
  let ddjjGenerada = false;
  let faltoDiagnostico = false;
  if (ESTADOS_DDJJ.includes(socio.reprocann_estado)) {
    const decViva = await env.DB.prepare(
      `SELECT id FROM declaraciones WHERE socio_id = ? AND estado != 'anulada' ORDER BY id DESC LIMIT 1`,
    ).bind(socio.id).first<{ id: number }>();
    if (!decViva) {
      // los datos frescos: la ficha más lo que el PDF acaba de completar
      const datosDec: DatosSocio = {
        nombre: socio.nombre,
        documento: socio.documento || leido.documento || null,
        domicilio: socio.domicilio || leido.domicilio || null,
        localidad: socio.localidad || leido.localidad || null,
        provincia: socio.provincia || leido.provincia || null,
      };
      if (diagnostico && datosDec.documento && datosDec.domicilio) {
        try {
          await generarDeclaracion(env, socio.id, datosDec, diagnostico, 'portal:' + email);
          ddjjGenerada = true;
        } catch { faltoDiagnostico = true; /* la genera el panel; el aviso de abajo lo cuenta */ }
      } else {
        faltoDiagnostico = true;
      }
    }
  }

  await avisar(env, ddjjGenerada
    ? `📄 CERTIFICADO SUBIDO EN EL PORTAL\n👤 ${socio.nombre}\n📧 ${email}\n` +
      `Se leyó el PDF y su declaración jurada quedó generada: le toca firmarla en Mi cuenta.\nhttps://floraong.ar/admin/`
    : faltoDiagnostico
      ? `📄 CERTIFICADO SUBIDO EN EL PORTAL\n👤 ${socio.nombre}\n📧 ${email}\n` +
        `Falta el diagnóstico (o un dato de la ficha) para la DDJJ de ${socio.nombre}: generarla desde el panel.\nhttps://floraong.ar/admin/`
      : `📄 CERTIFICADO SUBIDO EN EL PORTAL\n👤 ${socio.nombre}\n📧 ${email}\nQuedó guardado en su ficha.\nhttps://floraong.ar/admin/`);

  return json({ ok: true, leido, ddjj_generada: ddjjGenerada });
};
