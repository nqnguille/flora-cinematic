import { requireSuperAdmin } from './_guard';

interface Env {
  SESSION_SECRET: string;
  ADMIN_EMAILS: string;
  SUPER_ADMIN_EMAILS?: string;
  SOCIOS: KVNamespace;
  RESEND_API_KEY?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRec(raw: string | null): any {
  if (!raw) return {};
  try {
    const r = JSON.parse(raw);
    return typeof r === 'object' && r !== null ? r : {};
  } catch {
    return {}; // valor legado tipo "ok"
  }
}

async function guard(request: Request, env: Env) {
  const check = await requireSuperAdmin(request, env);
  if (check.status !== 200) {
    return Response.json(
      { ok: false, error: check.status === 401 ? 'no autenticado' : 'solo el super admin puede gestionar socios' },
      { status: check.status }
    );
  }
  return null;
}

// Mail de bienvenida al acceso de prueba: avisa que YA puede entrar y que es
// temporal, sin decir cuántas horas dura (la cuenta atrás arranca recién con
// el primer login, no con este mail — ver login.ts). Sin dominio verificado
// en Resend, el envío falla silencioso: nunca bloquea el alta del socio.
async function enviarMailTemporal(env: Env, { email, name }: { email: string; name: string }) {
  if (!env.RESEND_API_KEY) return;
  const saludo = name ? name.split(/\s+/)[0] : '';
  const html = `
    <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1C1626">
      <p style="font-size:16px;line-height:1.6">${saludo ? `Hola ${saludo},` : 'Hola,'}</p>
      <p style="font-size:16px;line-height:1.6">Ya podés entrar a conocer la carta de Flora. Este acceso es <strong>temporal</strong>, pensado para que veas cómo trabajamos antes de dar el resto de los pasos.</p>
      <p style="font-size:16px;line-height:1.6">Entrá con tu cuenta de Google (<strong>${email}</strong>) acá:</p>
      <p style="margin:24px 0"><a href="https://floraong.ar/socios/" style="background:#0A503C;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700;display:inline-block">Entrar a Flora</a></p>
      <p style="font-size:14px;line-height:1.6;color:#666">Cualquier duda, escribinos por WhatsApp — <a href="https://wa.me/5492996375723">acá</a>.</p>
      <p style="font-size:14px;line-height:1.6;color:#666">— Equipo Flora</p>
    </div>`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Flora <hola@floraong.ar>',
        to: email,
        subject: 'Ya podés entrar a conocer Flora 🌿',
        html,
      }),
    });
  } catch {
    /* el mail nunca bloquea el alta */
  }
}

// Lista de socios con su ficha (email + nota + perfil de Google capturado en login)
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  const list = await env.SOCIOS.list();
  const socios = await Promise.all(
    list.keys.map(async (k) => {
      const rec = parseRec(await env.SOCIOS.get(k.name));
      return {
        email: k.name,
        nota: rec.nota || '',
        name: rec.name || '',
        givenName: rec.givenName || '',
        familyName: rec.familyName || '',
        picture: rec.picture || '',
        locale: rec.locale || '',
        emailVerified: rec.emailVerified ?? null,
        alta: rec.alta || null,
        firstLogin: rec.firstLogin || null,
        lastLogin: rec.lastLogin || null,
        logins: rec.logins || 0,
        temporal: rec.temporal === true,
        tempExpiraEn: rec.tempExpiraEn || null,
      };
    })
  );
  socios.sort((a, b) => a.email.localeCompare(b.email));
  return Response.json({ ok: true, socios });
};

// Alta / edición (email + nota). Preserva el perfil ya capturado. El flag
// `temporal` (usado desde "Aprobar temporal" en Solicitudes) solo se aplica
// en una alta NUEVA — nunca degrada a un socio ya permanente existente — y
// dispara el mail de bienvenida una única vez.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }

  const email = String(body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: 'email inválido' }, { status: 400 });
  }

  const existente = await env.SOCIOS.get(email);
  const esAltaNueva = existente === null;
  const rec = parseRec(existente);
  rec.nota = String(body?.nota ?? rec.nota ?? '');
  const nombre = String(body?.name || '').trim().slice(0, 120);
  if (nombre && !rec.name) rec.name = nombre;
  if (esAltaNueva) rec.alta = new Date().toISOString(); // fecha real de alta en el club

  const marcarTemporal = body?.temporal === true && esAltaNueva;
  if (marcarTemporal) rec.temporal = true;

  const payload = JSON.stringify(rec);
  await env.SOCIOS.put(email, payload);

  // Confirmamos con un read-back que el alta pegó de verdad antes de decir que
  // sí: sin esto, un fallo silencioso de KV podía devolver 200 sin que el
  // socio quedara cargado — el panel mostraba "✓" y no había nada guardado.
  const verify = await env.SOCIOS.get(email);
  if (verify !== payload) {
    return Response.json({ ok: false, error: 'el guardado no se pudo confirmar, probá de nuevo' }, { status: 500 });
  }

  if (marcarTemporal) await enviarMailTemporal(env, { email, name: rec.name || nombre });

  return Response.json({ ok: true, email });
};

// Baja
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

  await env.SOCIOS.delete(email);
  return Response.json({ ok: true });
};
