import { requireSuperAdmin } from './_guard';

interface Env {
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
  SUPER_ADMIN_EMAILS?: string;
  SOLICITUDES: KVNamespace;
}

async function guard(request: Request, env: Env) {
  const check = await requireSuperAdmin(request, env);
  if (check.status !== 200) {
    return Response.json(
      { ok: false, error: check.status === 401 ? 'no autenticado' : 'solo el super admin puede ver las solicitudes' },
      { status: check.status }
    );
  }
  return null;
}

// Gente que llenó el formulario "Ya tengo REPROCANN" del login — leads para
// aprobar manualmente y cargar como socios (junto con los intentos de
// acceso, se muestran combinados en la pestaña Solicitudes del admin).
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  const list = await env.SOLICITUDES.list();
  const solicitudes = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.SOLICITUDES.get(k.name);
      let rec: any = {};
      try { rec = raw ? JSON.parse(raw) : {}; } catch { rec = {}; }
      return {
        email: k.name,
        name: rec.name || '',
        phone: rec.phone || '',
        creado: rec.creado || null,
        actualizado: rec.actualizado || null,
      };
    })
  );
  solicitudes.sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
  return Response.json({ ok: true, solicitudes });
};

// Descartar una solicitud (ya se convirtió en socio, no responde, etc.)
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }

  const email = String(body?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ ok: false, error: 'falta email' }, { status: 400 });

  await env.SOLICITUDES.delete(email);
  return Response.json({ ok: true });
};
