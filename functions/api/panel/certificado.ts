// Certificados REPROCANN desde el panel (ficha 360°): subir, ver y quitar
// el PDF oficial de cada socio. El PDF vive en KV CERTIFICADOS con dos
// claves: `cert:<id>` (el binario) y `cert:<id>:meta` (JSON chico para
// chequear existencia sin leer el PDF entero).
//   GET    ?socio_id=X            → {existe, meta} | con &descargar=1 baja el PDF
//   POST   {socio_id, pdf_base64} → guarda (valida %PDF y tamaño)
//   DELETE {socio_id}             → borra
import { requireCap } from './_rol';
import { leerCertificado } from './_certpdf';

interface Env {
  AI?: Ai;
  DB: D1Database;
  CERTIFICADOS: KVNamespace;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
}

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB: certificados reales pesan < 1 MB

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'padron_ver');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  const url = new URL(request.url);
  const socioId = Number(url.searchParams.get('socio_id'));
  if (!Number.isFinite(socioId)) return json({ error: 'Falta socio_id' }, 400);

  if (url.searchParams.get('descargar')) {
    const pdf = await env.CERTIFICADOS.get(`cert:${socioId}`, 'arrayBuffer');
    if (!pdf) return json({ error: 'Sin certificado' }, 404);
    const s = await env.DB.prepare(`SELECT nombre FROM socios WHERE id = ?`).bind(socioId).first<{ nombre: string }>();
    const nombreArchivo = `REPROCANN ${s?.nombre || socioId}.pdf`.replace(/[^\w\s.\-áéíóúÁÉÍÓÚñÑ]/g, '');
    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${nombreArchivo}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const meta = await env.CERTIFICADOS.get(`cert:${socioId}:meta`, 'json');
  return json({ ok: true, existe: !!meta, meta: meta || null });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'reprocann_editar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);

  let body: { socio_id?: number; pdf_base64?: string };
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const socioId = Number(body.socio_id);
  if (!Number.isFinite(socioId)) return json({ error: 'Falta socio_id' }, 400);

  const socio = await env.DB.prepare(`SELECT nombre FROM socios WHERE id = ?`).bind(socioId).first<{ nombre: string }>();
  if (!socio) return json({ error: 'El socio no existe' }, 404);

  // Releer un certificado ya guardado: para los subidos antes de la lectura
  // automática o cuando el cupo diario de visión estaba agotado.
  if ((body as Record<string, unknown>).releer) {
    const pdf = await env.CERTIFICADOS.get(`cert:${socioId}`, 'arrayBuffer');
    if (!pdf) return json({ error: 'Este socio no tiene certificado guardado' }, 404);
    const leido = await completarDesdePdf(env, socioId, pdf);
    return json({ ok: true, leido, releido: true });
  }

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

  await env.CERTIFICADOS.put(`cert:${socioId}`, bytes.buffer as ArrayBuffer);
  await env.CERTIFICADOS.put(`cert:${socioId}:meta`, JSON.stringify({
    nombre: socio.nombre, bytes: bytes.length,
    subido: new Date().toISOString(), por: auth.email,
  }));

  // El PDF ES la fuente: lo que el certificado dice del socio completa la
  // ficha solo (y de ahí lo toma la DDJJ). Regla de oro: solo llena campos
  // VACÍOS, nunca pisa lo que alguien escribió a mano. El diagnóstico no se
  // guarda en socios (es dato clínico): viaja en la respuesta para que el
  // panel lo ofrezca como sugerencia al generar la declaración.
  const leido = await completarDesdePdf(env, socioId, bytes.buffer as ArrayBuffer);

  return json({ ok: true, bytes: bytes.length, leido });
};

// Lee el PDF y completa SOLO los campos vacíos de la ficha. Compartida entre
// la subida y el "releer" (para certificados guardados antes de que existiera
// la lectura automática, o cuando el cupo de visión estaba agotado).
async function completarDesdePdf(env: Env, socioId: number, pdf: ArrayBuffer): Promise<Record<string, string>> {
  const leido: Record<string, string> = {};
  try {
    const datos = await leerCertificado(pdf, env.AI);
    const campos: Array<[string, string | number | undefined]> = [
      ['documento', datos.dni], ['domicilio', datos.domicilio],
      ['localidad', datos.localidad], ['provincia', datos.provincia],
      ['reprocann_vence', datos.vence], ['reprocann_tramite', datos.tramite],
      ['reprocann_plantas', datos.plantas],
    ];
    for (const [col, val] of campos) {
      if (!val) continue;
      try {
        const r = await env.DB.prepare(
          `UPDATE socios SET ${col} = ?, actualizado = datetime('now') WHERE id = ? AND (${col} IS NULL OR ${col} = '')`,
        ).bind(val, socioId).run();
        if (r.meta.changes) leido[col] = String(val);
      } catch { /* p. ej. DNI duplicado de otra ficha: se saltea solo ese campo */ }
    }
    if (datos.diagnostico) leido.diagnostico = datos.diagnostico;
    if (datos.modalidad) leido.modalidad = datos.modalidad;
  } catch { /* leer el PDF nunca rompe nada */ }
  return leido;
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'reprocann_editar');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);
  let body: { socio_id?: number };
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const socioId = Number(body.socio_id);
  if (!Number.isFinite(socioId)) return json({ error: 'Falta socio_id' }, 400);
  await env.CERTIFICADOS.delete(`cert:${socioId}`);
  await env.CERTIFICADOS.delete(`cert:${socioId}:meta`);
  return json({ ok: true });
};
