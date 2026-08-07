// La declaración jurada de renuncia al autocultivo, del lado del SOCIO.
//
// El panel la GENERA (functions/api/panel/declaracion.ts, que es el dueño de
// la plantilla, el texto y el hash — de ahí se importan las mismas funciones,
// sin duplicar nada). Acá el socio autocultivador entra a Mi cuenta con su
// Google, LEE su declaración pendiente y la FIRMA tipeando su nombre completo
// y su DNI. El server sella el documento con la evidencia (nombre tal como lo
// tipeó, DNI confirmado, email de la cuenta, fecha y hora, IP, user agent y
// el hash del texto) y lo guarda en KV CERTIFICADOS bajo la misma clave que
// usa el panel (`ddjj:<id>`).
//
//   GET  → estado de su última declaración no anulada; si está `generada`,
//          el texto completo para leer y los datos que va a confirmar.
//          Si no aplica (sin declaración, o ya fuera del circuito de
//          autocultivo) → { ok: true, aplica: false }.
//   POST {nombre_tipeado, dni_tipeado, acepto: true} → firma y sella.
//
// La VERIFICACIÓN sigue siendo un acto del panel (doble control): acá no se
// toca. Recién la verificada devuelve al socio al embudo normal.
import { readSessionEmail } from './_session';
import { leerPlantilla, armarTexto, documentoHtml, esc } from '../panel/declaracion';
import type { DatosSocio } from '../panel/declaracion';

interface Env {
  DB: D1Database;
  SOCIOS: KVNamespace;
  GENETICAS: KVNamespace;
  CERTIFICADOS: KVNamespace;
  SESSION_SECRET: string;
  NOTIFY_TOKEN?: string;
}

const NOTIFY_URL = 'https://gates-analytics.nqnguille.workers.dev/api/notify';

// Estados del socio en los que la declaración `generada` todavía es SU paso:
// mismo criterio que usa el panel al sellar la firma.
const ESTADOS_AUTOCULTIVO = ['autocultivo', 'ddjj_pendiente'];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

type SocioRow = DatosSocio & { id: number; reprocann_estado: string };

async function buscarSocio(env: Env, email: string): Promise<SocioRow | null> {
  return env.DB.prepare(
    `SELECT id, nombre, documento, domicilio, localidad, provincia, reprocann_estado
       FROM socios WHERE email = ? AND (numero IS NULL OR numero != -1)`,
  ).bind(email.toLowerCase()).first<SocioRow>();
}

interface DecRow {
  id: number; estado: string; version: string; texto_hash: string;
  generada: string; firmada: string | null; verificada: string | null; nota: string | null;
}

async function ultimaDeclaracion(env: Env, socioId: number): Promise<DecRow | null> {
  return env.DB.prepare(
    `SELECT id, estado, version, texto_hash, generada, firmada, verificada, nota
       FROM declaraciones WHERE socio_id = ? AND estado != 'anulada'
       ORDER BY id DESC LIMIT 1`,
  ).bind(socioId).first<DecRow>();
}

// La fecha del documento es la de GENERACIÓN (la misma que usó el panel):
// así el texto reconstruido acá es letra por letra el que respalda el hash.
function fechaGeneracion(dec: DecRow): Date {
  return new Date(String(dec.generada).replace(' ', 'T') + 'Z');
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return json({ error: 'Sin sesión' }, 401);
  const esSocio = await env.SOCIOS.get(email.toLowerCase());
  if (!esSocio) return json({ error: 'Sin acceso' }, 403);

  const socio = await buscarSocio(env, email);
  if (!socio) return json({ ok: true, aplica: false });

  const dec = await ultimaDeclaracion(env, socio.id);
  if (!dec) return json({ ok: true, aplica: false });

  if (dec.estado === 'generada') {
    // Pendiente de firma: solo es un paso del socio mientras siga en el
    // circuito de autocultivo. Si el padrón ya lo movió a otro lado, la
    // tarjeta no aparece (que nadie firme una renuncia que ya no corresponde).
    if (!ESTADOS_AUTOCULTIVO.includes(socio.reprocann_estado)) return json({ ok: true, aplica: false });
    const p = await leerPlantilla(env);
    const texto = armarTexto(p, socio, dec.nota || '', fechaGeneracion(dec));
    return json({
      ok: true, aplica: true, estado: 'generada', declaracion_id: dec.id,
      socio: { nombre: socio.nombre, documento: socio.documento || null },
      documento: {
        titulo: p.titulo, subtitulo: p.subtitulo, entidad: p.entidad,
        version: dec.version, parrafos: texto.parrafos, cierre: texto.cierre,
        hash: dec.texto_hash,
      },
    });
  }

  // firmada | verificada: la tarjeta muestra en qué quedó, sin el texto
  return json({
    ok: true, aplica: true, estado: dec.estado, declaracion_id: dec.id,
    firmada: dec.firmada || null, verificada: dec.verificada || null,
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return json({ error: 'Sin sesión' }, 401);
  const esSocio = await env.SOCIOS.get(email.toLowerCase());
  if (!esSocio) return json({ error: 'Sin acceso' }, 403);

  let body: { nombre_tipeado?: unknown; dni_tipeado?: unknown; acepto?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'Datos inválidos' }, 400); }

  if (body.acepto !== true) return json({ error: 'Falta marcar que leíste y aceptás la declaración.' }, 400);
  // el nombre se guarda TAL CUAL lo tipeó: es su firma
  const nombre = String(body.nombre_tipeado ?? '');
  if (!nombre.trim()) return json({ error: 'Escribí tu nombre completo, como figura en tu DNI.' }, 400);
  if (nombre.length > 200) return json({ error: 'El nombre es demasiado largo.' }, 400);
  const dni = String(body.dni_tipeado ?? '').replace(/\D/g, '');
  if (!dni) return json({ error: 'Escribí tu DNI (solo números).' }, 400);

  const socio = await buscarSocio(env, email);
  if (!socio) return json({ error: 'Tu cuenta todavía no está en el padrón del club — escribinos.' }, 403);
  if (!socio.documento) return json({ error: 'Tu ficha no tiene DNI cargado. Escribinos y lo resolvemos antes de firmar.' }, 409);
  if (dni !== String(socio.documento).replace(/\D/g, '')) {
    return json({ error: 'El DNI no coincide con el que figura en tu ficha. Revisalo y probá de nuevo.' }, 400);
  }

  const dec = await ultimaDeclaracion(env, socio.id);
  if (!dec) return json({ error: 'No hay ninguna declaración para firmar.' }, 404);
  if (dec.estado === 'firmada' || dec.estado === 'verificada') {
    return json({ error: 'Esta declaración ya está firmada. Si algo no cierra, escribinos.' }, 409);
  }
  if (dec.estado !== 'generada') return json({ error: 'La declaración no está lista para firmar.' }, 409);

  // ── Sellar: el mismo documento que leyó, más el bloque de firma electrónica ──
  const p = await leerPlantilla(env);
  const texto = armarTexto(p, socio, dec.nota || '', fechaGeneracion(dec));
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';
  const cuando = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const firmaHtml = `<div class="firma-e">
    <div class="fe-tit">FIRMA ELECTRÓNICA</div>
    Firmado en el portal de socios por: <b>${esc(nombre)}</b><br />
    DNI confirmado: <b>${esc(dni)}</b> · Cuenta: ${esc(email)}<br />
    Fecha y hora: ${esc(cuando)}<br />
    IP: ${esc(ip)} · Navegador: ${esc(ua)}
    <div class="fe-hash">SHA-256 del texto firmado: ${esc(dec.texto_hash)}</div>
  </div>`;
  const html = documentoHtml(p, texto, dec.texto_hash, firmaHtml);
  const bytes = new TextEncoder().encode(html);
  await env.CERTIFICADOS.put(`ddjj:${dec.id}`, bytes.buffer as ArrayBuffer);

  await env.DB.prepare(
    `UPDATE declaraciones SET estado = 'firmada', firmada = datetime('now'), firmada_por = ?,
        firma_texto = ?, firma_ip = ?, firma_ua = ?, archivo_bytes = ?, archivo_tipo = 'text/html'
      WHERE id = ? AND estado = 'generada'`,
  ).bind(email, nombre, ip, ua, bytes.length, dec.id).run();
  // el trámite avanza solo: ya no espera al paciente, ahora nos toca a nosotros
  await env.DB.prepare(
    `UPDATE socios SET reprocann_estado = 'ddjj_firmada', reprocann_actualizado = datetime('now')
      WHERE id = ? AND reprocann_estado IN ('autocultivo', 'ddjj_pendiente')`,
  ).bind(socio.id).run();

  // Avisar al club: queda pendiente la verificación en el panel (nunca bloquea).
  if (env.NOTIFY_TOKEN) {
    try {
      await fetch(NOTIFY_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: 'flora-reprocann', token: env.NOTIFY_TOKEN,
          text: `✍️ DDJJ FIRMADA EN EL PORTAL\n👤 ${socio.nombre}\n📧 ${email}\nQueda pendiente verificarla en el panel.\nhttps://floraong.ar/admin/`,
        }),
      });
    } catch { /* el aviso nunca bloquea */ }
  }

  return json({ ok: true });
};
