// El paciente carga su propio código de vinculación desde /socios/reprocann/.
// Antes llegaba por WhatsApp y alguien lo transcribía a mano: un dígito mal
// copiado carga el trámite de otra persona. Acá lo pega él, con su sesión.
import { readSessionEmail } from './_session';

interface Env {
  DB: D1Database;
  SOCIOS: KVNamespace;
  CERTIFICADOS: KVNamespace;
  SESSION_SECRET: string;
  NOTIFY_TOKEN?: string;
}

const NOTIFY_URL = 'https://gates-analytics.nqnguille.workers.dev/api/notify';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return Response.json({ error: 'Sin sesión' }, { status: 401 });
  const esSocio = await env.SOCIOS.get(email.toLowerCase());
  if (!esSocio) return Response.json({ error: 'Sin acceso' }, { status: 403 });

  const s = await env.DB.prepare(
    `SELECT id, nombre, reprocann_estado, reprocann_codigo, reprocann_vence
       FROM socios WHERE email = ? AND (numero IS NULL OR numero != -1)`,
  ).bind(email.toLowerCase()).first<{ id: number; nombre: string; reprocann_estado: string; reprocann_codigo: string | null; reprocann_vence: string | null }>();
  if (!s) return Response.json({ ok: true, vinculado: false });

  // ¿Tiene su certificado PDF guardado? (solo el flag; el PDF va por
  // /api/socios/certificado). La clave :meta es chica: no lee el PDF entero.
  let certificado = false;
  try { certificado = !!(await env.CERTIFICADOS.get(`cert:${s.id}:meta`)); } catch { /* binding ausente en dev viejo */ }

  // Al paciente le contamos su paso en su idioma, sin la jerga interna.
  const MENSAJE: Record<string, string> = {
    sin_iniciar: 'Todavía no arrancamos tu trámite. Cargá tu código de vinculación para empezar.',
    esperando_codigo: 'Nos falta tu código de vinculación para poder arrancar.',
    revisar: 'Nos falta tu código de vinculación para poder arrancar.',
    codigo_listo: 'Ya tenemos tu código. Nuestro médico va a cargar tu trámite.',
    cargado: 'Tu trámite está cargado: entrá a tu cuenta de REPROCANN y aceptá el consentimiento.',
    observado: 'Hay una observación en tu trámite: revisala en tu cuenta de REPROCANN.',
    a_vincular: 'Ya firmaste. Nos toca a nosotros vincularte como tu cultivador.',
    en_evaluacion: 'Tu trámite está en evaluación del Ministerio. No tenés que hacer nada.',
    revision_medica: 'El Ministerio pidió una corrección; la está resolviendo el médico.',
    aprobado: 'Tu REPROCANN está aprobado y vigente.',
    autocultivo: 'Figurás como autocultivador.',
    rechazado: 'Tu trámite fue rechazado. Escribinos y vemos cómo seguir.',
    vencido: 'Tu certificado venció: hay que renovarlo.',
  };
  const teToca = ['sin_iniciar', 'esperando_codigo', 'revisar', 'cargado', 'observado'].includes(s.reprocann_estado);
  return Response.json({
    ok: true, vinculado: true,
    estado: s.reprocann_estado,
    mensaje: MENSAJE[s.reprocann_estado] || '',
    teToca,
    tieneCodigo: !!s.reprocann_codigo,
    // el código no se devuelve completo: solo para confirmar que es el suyo
    codigoParcial: s.reprocann_codigo ? s.reprocann_codigo.slice(0, 4) + '•••••' + s.reprocann_codigo.slice(-2) : null,
    vence: s.reprocann_vence,
    certificado,
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return Response.json({ error: 'Sin sesión' }, { status: 401 });
  const esSocio = await env.SOCIOS.get(email.toLowerCase());
  if (!esSocio) return Response.json({ error: 'Sin acceso' }, { status: 403 });

  let b: { codigo?: string };
  try { b = await request.json(); } catch { return Response.json({ error: 'Datos inválidos' }, { status: 400 }); }
  const codigo = String(b.codigo || '').trim().replace(/\s/g, '');
  if (codigo.length !== 13) {
    return Response.json({ error: 'El código tiene 13 caracteres — fijate que no falte ninguno.' }, { status: 400 });
  }
  if (!/^[A-Za-z0-9]+$/.test(codigo)) {
    return Response.json({ error: 'El código son letras y números, sin espacios ni guiones.' }, { status: 400 });
  }

  const s = await env.DB.prepare(
    `SELECT id, nombre FROM socios WHERE email = ? AND (numero IS NULL OR numero != -1)`,
  ).bind(email.toLowerCase()).first<{ id: number; nombre: string }>();
  if (!s) return Response.json({ error: 'Tu cuenta todavía no está en el padrón del club — escribinos.' }, { status: 409 });

  // Que dos socios carguen el mismo código sería un error grave: vincularía
  // el trámite de otra persona.
  const otro = await env.DB.prepare(
    `SELECT nombre FROM socios WHERE reprocann_codigo = ? AND id != ?`,
  ).bind(codigo, s.id).first();
  if (otro) return Response.json({ error: 'Ese código ya está cargado por otra persona. Revisalo o escribinos.' }, { status: 409 });

  await env.DB.prepare(
    `UPDATE socios SET reprocann_codigo = ?, reprocann_estado = 'codigo_listo',
            reprocann_actualizado = datetime('now') WHERE id = ?`,
  ).bind(codigo, s.id).run();

  // Avisar al club: ahora le toca al médico cargar el trámite.
  if (env.NOTIFY_TOKEN) {
    try {
      await fetch(NOTIFY_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: 'flora-reprocann', token: env.NOTIFY_TOKEN,
          text: `🌿 CÓDIGO DE VINCULACIÓN CARGADO\n👤 ${s.nombre}\n📧 ${email}\nYa se puede cargar el trámite en REPROCANN.\nhttps://floraong.ar/admin/`,
        }),
      });
    } catch { /* el aviso nunca bloquea */ }
  }
  return Response.json({ ok: true });
};
