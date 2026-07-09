interface Env {
  SOLICITUDES: KVNamespace;
  NOTIFY_TOKEN?: string;
}

const NOTIFY_URL = 'https://gates-analytics.nqnguille.workers.dev/api/notify';
// Tiene que ser Gmail sí o sí: el login del portal es con Google, y así se
// evita el caso de alguien vinculando un email que después no coincide con
// la cuenta con la que realmente entra.
const EMAIL_RE = /^[^\s@]+@gmail\.com$/i;
const INTENTS = ['acceso', 'entrevista'] as const;
type Intent = (typeof INTENTS)[number];

const INTENT_COPY: Record<Intent, { titulo: string; detalle: string }> = {
  acceso: { titulo: 'SOLICITUD NUEVA — Ya tiene REPROCANN', detalle: 'Dice que ya tiene su REPROCANN y quiere ver la carta.' },
  entrevista: { titulo: 'SOLICITUD NUEVA — Entrevista médica', detalle: 'Todavía no tiene REPROCANN — pide coordinar la entrevista médica para tramitarlo.' },
};

// WhatsApp vía el hub de avisos (gates-analytics). Sin token configurado no
// avisa (entornos de prueba no disparan mensajes reales). Nunca rompe el alta.
async function notificar(env: Env, sol: { name: string; email: string; phone: string; intent: Intent }) {
  if (!env.NOTIFY_TOKEN) return;
  try {
    const copy = INTENT_COPY[sol.intent];
    const text =
      `🌿 ${copy.titulo}\n` +
      `👤 ${sol.name}\n` +
      `📧 ${sol.email}\n` +
      `📱 ${sol.phone}\n` +
      `${copy.detalle}\n` +
      `Panel: https://floraong.ar/socios/admin/`;
    await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, token: env.NOTIFY_TOKEN }),
    });
  } catch {
    /* el aviso nunca bloquea la solicitud */
  }
}

// Alta de una solicitud desde el login de socios — antes eran links directos
// a WhatsApp ("Sí, tengo REPROCANN" / "Todavía no"); esto reemplaza esa
// fricción por un formulario corto que el equipo revisa y aprueba a mano
// (ver admin/solicitudes.ts + la pestaña "Solicitudes" del panel). El mismo
// formulario sirve para las dos intenciones — "acceso" a la carta o
// coordinar la "entrevista" médica — solo cambia el copy del aviso.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }

  // Honeypot: campo invisible para humanos, que un bot de formularios sí
  // suele completar. Si viene con algo, respondemos éxito falso (para no
  // delatar el filtro) sin guardar ni avisar nada.
  if (String(body?.website || '').trim()) {
    return Response.json({ ok: true });
  }

  const name = String(body?.name || '').trim().slice(0, 120);
  const email = String(body?.email || '').trim().toLowerCase().slice(0, 160);
  const phone = String(body?.phone || '').trim().slice(0, 40);
  const intentRaw = String(body?.intent || 'acceso');
  const intent: Intent = (INTENTS as readonly string[]).includes(intentRaw) ? (intentRaw as Intent) : 'acceso';

  if (!name) return Response.json({ ok: false, error: 'falta el nombre' }, { status: 400 });
  if (!EMAIL_RE.test(email)) return Response.json({ ok: false, error: 'tiene que ser un email de Gmail (terminado en @gmail.com)' }, { status: 400 });
  if (!phone) return Response.json({ ok: false, error: 'falta el celular' }, { status: 400 });

  const now = new Date().toISOString();
  const existingRaw = await env.SOLICITUDES.get(email);
  let rec: any = {};
  try { rec = existingRaw ? JSON.parse(existingRaw) : {}; } catch { rec = {}; }
  const esNueva = !rec.creado;
  rec.name = name;
  rec.phone = phone;
  rec.intent = intent;
  rec.creado = rec.creado || now;
  rec.actualizado = now;
  await env.SOLICITUDES.put(email, JSON.stringify(rec));

  // Solo avisamos por WhatsApp en el alta real — un reenvío del mismo
  // formulario (typo corregido, etc.) no debería generar un segundo aviso.
  if (esNueva) await notificar(env, { name, email, phone, intent });

  return Response.json({ ok: true });
};
