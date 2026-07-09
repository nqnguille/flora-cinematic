interface Env {
  SOLICITUDES: KVNamespace;
}

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const TIPOS_OK: Record<string, true> = {
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true,
  'application/pdf': true,
};

// Sube la foto/PDF del REPROCANN adjunto a una solicitud ya creada (paso 2,
// después de POST /api/socios/solicitud). Es un documento con datos
// personales — NO se guarda en el KV público de fotos (FOTOS, servido sin
// auth en /foto/*): vive en SOLICITUDES bajo su propia clave y solo se sirve
// vía admin/solicitud-adjunto.ts, con sesión de super admin.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: 'se esperaba multipart/form-data' }, { status: 400 });
  }

  const email = String(form.get('email') || '').trim().toLowerCase();
  if (!email) return Response.json({ ok: false, error: 'falta el email' }, { status: 400 });

  // Solo se puede adjuntar a una solicitud que ya existe (creada en el paso
  // 1) — evita que cualquiera suba archivos sueltos sin una solicitud real.
  const raw = await env.SOLICITUDES.get(email);
  if (raw === null) return Response.json({ ok: false, error: 'no existe una solicitud con ese email' }, { status: 404 });

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: 'falta el archivo' }, { status: 400 });
  }

  const type = file.type || '';
  if (!TIPOS_OK[type]) {
    return Response.json({ ok: false, error: 'usá una imagen (JPG/PNG/WebP) o un PDF' }, { status: 415 });
  }

  const buf = await file.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    return Response.json({ ok: false, error: 'el archivo supera los 8 MB' }, { status: 413 });
  }

  await env.SOLICITUDES.put(`archivo:${email}`, buf, {
    metadata: { contentType: type, filename: file.name || 'reprocann', size: buf.byteLength },
  });

  // Marca en el registro JSON que hay un adjunto — así el panel lo muestra
  // sin tener que pedir el binario solo para chequear si existe.
  let rec: any = {};
  try { rec = JSON.parse(raw); } catch { rec = {}; }
  rec.tieneAdjunto = true;
  await env.SOLICITUDES.put(email, JSON.stringify(rec));

  return Response.json({ ok: true });
};
