// Avisos al socio por cambio de estado de su reserva: plantillas editables
// (KV GENETICAS, clave 'avisos') + envío del mail con el layout claro de
// marca (el mismo del mail de bienvenida y el de débito).
//
// Variables disponibles en asunto/cuerpo/wa: {{nombre}}, {{items}}, {{nota}}.
// El cuerpo del mail es texto plano editable: cada línea en blanco separa
// párrafos; el HTML de los valores del pedido SIEMPRE se escapa (nota e
// ítems los escribe el socio).

export interface Plantilla {
  activo: boolean;
  asunto: string;
  cuerpo: string;
  wa: string;
}
export type Avisos = Record<'listo' | 'entregado', Plantilla>;

export const AVISOS_DEFAULT: Avisos = {
  listo: {
    activo: true,
    asunto: 'Tu reserva está lista 🌿',
    cuerpo: `Hola {{nombre}}!

Tu reserva ya está preparada y te espera en el club:

{{items}}

Pasá a retirarla cuando te quede bien, en el horario de siempre. Se abona al retirar.`,
    wa: `Hola {{nombre}}! Tu reserva de Flora ya está lista para retirar 🌿 ({{items}}). Te esperamos en el club!`,
  },
  entregado: {
    activo: true,
    asunto: 'Gracias por tu visita 🌿',
    cuerpo: `Hola {{nombre}}!

Ya te llevaste tu reserva:

{{items}}

Gracias por elegirnos, que la disfrutes. Cualquier cosa que necesites, escribinos.`,
    wa: `Gracias por pasar por Flora, {{nombre}}! 🌿 Que lo disfrutes. Cualquier cosa, escribinos.`,
  },
};

const CAMPOS: (keyof Plantilla)[] = ['activo', 'asunto', 'cuerpo', 'wa'];

// Lee las plantillas guardadas y las funde con los defaults (campo a campo,
// así sumar una variable nueva en el default no exige re-guardar).
export async function leerAvisos(kv: KVNamespace): Promise<Avisos> {
  let guardado: Partial<Record<string, Partial<Plantilla>>> = {};
  try { guardado = (await kv.get('avisos', 'json')) || {}; } catch { /* sin doc: defaults */ }
  const out = {} as Avisos;
  for (const estado of ['listo', 'entregado'] as const) {
    const base = AVISOS_DEFAULT[estado];
    const g = guardado[estado] || {};
    out[estado] = {
      activo: typeof g.activo === 'boolean' ? g.activo : base.activo,
      asunto: typeof g.asunto === 'string' && g.asunto.trim() ? g.asunto : base.asunto,
      cuerpo: typeof g.cuerpo === 'string' && g.cuerpo.trim() ? g.cuerpo : base.cuerpo,
      wa: typeof g.wa === 'string' && g.wa.trim() ? g.wa : base.wa,
    };
  }
  return out;
}

export function validarPlantilla(p: unknown): p is Plantilla {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  if (typeof o.activo !== 'boolean') return false;
  for (const c of ['asunto', 'cuerpo', 'wa'] as const) {
    if (typeof o[c] !== 'string' || (o[c] as string).length > 2000) return false;
  }
  if ((o.asunto as string).length > 150) return false;
  return CAMPOS.every(() => true);
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>
)[c]);

export function itemsTexto(pedido: { items?: { nombre?: string; formato?: string; cantidad?: number }[] }): string {
  return (pedido.items || [])
    .map((i) => `${i.cantidad}${i.formato === 'flor' ? ' g' : ' ×'} ${i.nombre || ''}${i.formato === 'preroll' ? ' (preroll)' : ''}`)
    .join(' · ');
}

export function interpolar(texto: string, vars: Record<string, string>): string {
  return texto.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

interface EnvMail { RESEND_API_KEY?: string }

// El mail con el layout claro de marca. La plantilla aporta asunto y cuerpo
// (texto plano → párrafos); el marco (logo, chip, CTA verde, pie con íconos)
// es fijo, igual al del mail de bienvenida.
export async function enviarMailReserva(
  env: EnvMail,
  destino: string,
  plantilla: Plantilla,
  vars: Record<string, string>,
  estado: 'listo' | 'entregado',
): Promise<{ enviado: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) return { enviado: false, error: 'RESEND_API_KEY no configurado' };

  const asunto = interpolar(plantilla.asunto, vars);
  const cuerpo = interpolar(plantilla.cuerpo, { ...vars, nombre: escHtml(vars.nombre || ''), items: escHtml(vars.items || ''), nota: escHtml(vars.nota || '') });
  const parrafos = cuerpo.split(/\n\s*\n/).map((p) =>
    `<tr><td style="padding:16px 36px 0;text-align:center;">
      <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#4a4356;">${p.replace(/\n/g, '<br>')}</p>
    </td></tr>`).join('');
  const eyebrow = estado === 'listo' ? 'Tu reserva te espera' : 'Gracias por venir';
  const titulo = estado === 'listo' ? 'Lista para retirar' : 'Hasta la próxima';

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flora</title></head>
<body style="margin:0;padding:0;background:#f4f1f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1f7;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#ffffff;border:1px solid #e6e0ee;border-radius:20px;">
        <tr><td style="padding:40px 36px 0;text-align:center;">
          <img src="https://floraong.ar/img/flora-logo.png" width="140" alt="Flora" style="display:block;margin:0 auto 22px;width:140px;height:auto;border:0;">
          <span style="display:inline-block;background:#f3eef9;border:1px solid #ddd2ec;border-radius:999px;padding:7px 16px;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#6e4fa0;">${escHtml(eyebrow)}</span>
        </td></tr>
        <tr><td style="padding:20px 36px 0;text-align:center;">
          <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:26px;line-height:1.3;color:#381f56;">${escHtml(titulo)}</h1>
        </td></tr>
        ${parrafos}
        <tr><td style="padding:28px 36px 0;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr><td style="border-radius:999px;background:#0A503C;">
              <a href="https://floraong.ar/socios/cuenta/" style="display:inline-block;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:999px;">Ver mi reserva &rarr;</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:32px 36px 0;"><div style="height:1px;line-height:1px;background:#eee7f4;">&nbsp;</div></td></tr>
        <tr><td style="padding:20px 36px 36px;text-align:center;">
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.9;color:#8d8598;">Contactanos por
            <a href="https://wa.me/5492996375723" style="color:#0A503C;text-decoration:none;font-weight:700;white-space:nowrap;"><img src="https://floraong.ar/img/ico-wa.png" width="15" height="15" alt="" style="vertical-align:-2px;border:0;margin-right:3px;">WhatsApp</a> o
            <a href="https://www.instagram.com/flora.cultivamosconciencia" style="color:#0A503C;text-decoration:none;font-weight:700;white-space:nowrap;"><img src="https://floraong.ar/img/ico-ig.png" width="15" height="15" alt="" style="vertical-align:-2px;border:0;margin-right:3px;">Instagram</a><br>&mdash; Equipo Flora</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Flora <hola@floraong.ar>', to: destino, subject: asunto, html }),
    });
    if (!res.ok) return { enviado: false, error: `Resend ${res.status}` };
    return { enviado: true };
  } catch (err) {
    return { enviado: false, error: String((err as Error)?.message || err) };
  }
}
