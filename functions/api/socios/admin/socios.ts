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
// el primer login, no con este mail — ver login.ts). El envío nunca bloquea
// el alta del socio, pero SÍ devolvemos si salió o no — así el panel puede
// avisar "se aprobó pero el mail no salió" en vez de fallar en silencio
// (el riesgo real: un dominio sin verificar en Resend y nadie se entera).
async function enviarMailTemporal(env: Env, { email, name }: { email: string; name: string }): Promise<{ enviado: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) return { enviado: false, error: 'RESEND_API_KEY no configurado' };
  const saludo = name ? name.split(/\s+/)[0] : '';
  // Mismo look que el portal /socios (video de cultivo + card de vidrio
  // violeta oscura): logo blanco, título serif con acento violeta, botón
  // verde bosque de siempre. Tabla + estilos inline porque los clientes de
  // mail no soportan backdrop-filter ni la mayoría del CSS del sitio.
  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Flora</title>
</head>
<body style="margin:0;padding:0;background:#130d1c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#130d1c;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#1b1326;border:1px solid #2b2140;border-radius:20px;">
        <tr><td style="padding:40px 36px 0;text-align:center;">
          <img src="https://floraong.ar/img/flora-logo-white.png" width="140" alt="Flora" style="display:block;margin:0 auto 22px;width:140px;height:auto;border:0;">
          <span style="display:inline-block;background:#221c2c;border:1px solid rgba(255,255,255,0.14);border-radius:999px;padding:7px 16px;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#d8d2e0;">Acceso temporal</span>
        </td></tr>
        <tr><td style="padding:20px 36px 0;text-align:center;">
          <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:26px;line-height:1.3;color:#f4f1f7;">${saludo ? `Hola ${saludo},` : 'Hola,'}<br>ya podés entrar a <em style="font-style:italic;color:#b79de6;">conocer Flora</em></h1>
        </td></tr>
        <tr><td style="padding:16px 36px 0;text-align:center;">
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#c9c3d4;">Ya podés ver la carta completa. Este acceso es <strong style="color:#f4f1f7;">temporal</strong>, pensado para que conozcas cómo trabajamos antes de dar el resto de los pasos.</p>
        </td></tr>
        <tr><td style="padding:28px 36px 0;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr><td style="border-radius:999px;background:#0A503C;">
              <a href="https://floraong.ar/socios/" style="display:inline-block;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:999px;">Entrar a Flora →</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:14px 36px 0;text-align:center;">
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#8d859b;">Entrá con tu cuenta de Google: <strong style="color:#c9c3d4;">${email}</strong></p>
        </td></tr>
        <tr><td style="padding:32px 36px 0;">
          <div style="height:1px;line-height:1px;background:#2b2140;">&nbsp;</div>
        </td></tr>
        <tr><td style="padding:20px 36px 36px;text-align:center;">
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:#8d859b;">¿Dudas? Escribinos por <a href="https://wa.me/5492996375723" style="color:#3cb492;text-decoration:none;font-weight:600;">WhatsApp</a><br>— Equipo Flora</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Flora <hola@floraong.ar>',
        to: email,
        subject: 'Ya podés entrar a conocer Flora 🌿',
        html,
      }),
    });
    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      return { enviado: false, error: `Resend ${res.status}: ${detalle.slice(0, 200)}` };
    }
    return { enviado: true };
  } catch (err: any) {
    return { enviado: false, error: String(err?.message || err) };
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
        telefono: rec.telefono || '',
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
  rec.telefono = String(body?.telefono ?? rec.telefono ?? '').trim().slice(0, 40);
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

  let mail: { enviado: boolean; error?: string } | null = null;
  if (marcarTemporal) mail = await enviarMailTemporal(env, { email, name: rec.name || nombre });

  return Response.json({ ok: true, email, mailEnviado: mail?.enviado ?? null, mailError: mail?.error });
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
