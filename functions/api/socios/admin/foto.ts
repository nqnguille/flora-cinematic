import { requireAdmin } from './_guard';

interface Env {
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
  FOTOS: KVNamespace;
}

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

// Sube una imagen a KV y devuelve la URL pública (/foto/<key>).
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const check = await requireAdmin(request, env);
  if (check.status !== 200) {
    return Response.json(
      { ok: false, error: check.status === 401 ? 'no autenticado' : 'no autorizado' },
      { status: check.status }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: 'se esperaba multipart/form-data' }, { status: 400 });
  }

  const id = String(form.get('id') || '').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'foto';
  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: 'falta el archivo' }, { status: 400 });
  }

  const type = file.type || 'image/jpeg';
  const ext = EXT_BY_TYPE[type];
  if (!ext) {
    return Response.json({ ok: false, error: 'formato no soportado (usá JPG, PNG o WebP)' }, { status: 415 });
  }

  const buf = await file.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    return Response.json({ ok: false, error: 'la imagen supera los 8 MB' }, { status: 413 });
  }

  const key = `g/${id}-${Date.now()}.${ext}`;
  await env.FOTOS.put(key, buf, { metadata: { contentType: type } });
  return Response.json({ ok: true, url: `/foto/${key}` });
};
