// Legajo del socio como paciente del consultorio (drezequielkalb.com).
// El club NO guarda datos clínicos: este endpoint es un proxy en vivo al
// visor del consultorio (/api/club/legajo). Manda el DNI/email del socio y
// el email de la sesión del panel en X-Solicitante — el CONSULTORIO decide
// si ese email es médico y recién ahí suma la canasta clínica.
import { requireCap } from './_rol';

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  SUPER_ADMIN_EMAILS?: string;
  CONSULTORIO_BASE?: string;   // var de wrangler.toml
  CONSULTORIO_TOKEN?: string;  // secret de Pages
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireCap(request, env, 'padron_ver');
  if (auth.status !== 200) return json({ error: auth.status === 401 ? 'Sin sesión' : 'Sin permiso' }, auth.status);

  const id = Number(new URL(request.url).searchParams.get('socio_id'));
  if (!Number.isFinite(id)) return json({ error: 'Falta socio_id' }, 400);

  const socio = await env.DB.prepare(
    `SELECT id, documento, email FROM socios WHERE id = ? AND (numero IS NULL OR numero != -1)`
  ).bind(id).first<{ id: number; documento: string | null; email: string | null }>();
  if (!socio) return json({ error: 'No existe' }, 404);

  const base = (env.CONSULTORIO_BASE || 'https://drezequielkalb.com').replace(/\/+$/, '');
  if (!env.CONSULTORIO_TOKEN) {
    return json({ error: 'Falta configurar el acceso al consultorio (CONSULTORIO_TOKEN)' }, 503);
  }

  const dni = String(socio.documento || '').replace(/\D/g, '');
  const email = String(socio.email || '').trim().toLowerCase();
  if (!dni && !email) {
    // sin documento ni email no hay con qué buscar: para el front es "sin legajo"
    return json({ ok: true, existe: false, socio_id: id, consultorio_base: base, motivo: 'sin_documento' });
  }

  const q = new URLSearchParams();
  if (dni) q.set('dni', dni);
  if (email) q.set('email', email);

  let r: Response;
  try {
    r = await fetch(`${base}/api/club/legajo?${q}`, {
      headers: {
        Authorization: `Bearer ${env.CONSULTORIO_TOKEN}`,
        'X-Solicitante': auth.email,
      },
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    return json({ error: 'El consultorio no contestó: probá de nuevo' }, 502);
  }

  const data = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (!r.ok || !data) {
    return json({ error: 'El consultorio no contestó: probá de nuevo' }, 502);
  }

  return json({ ...data, socio_id: id, consultorio_base: base });
};
