// Motor de avisos al socio. Un solo lugar por donde sale todo.
//
// Antes esto vivía copiado en cuatro archivos, cada uno con su propio HTML y
// su propio manejo de errores. Acá se decide a quién, por qué canal, con qué
// texto, y queda registrado.
//
// La regla que hace seguro todo el sistema: cada aviso tiene una identidad
// determinista (`dedup`), del estilo `reprocann_por_vencer:1042:2026-09-01`,
// y la base tiene un índice único sobre ella. Reclamar el envío ES insertar
// la fila. Si el INSERT choca, alguien ya lo tomó y no se manda de nuevo.
// Por eso el barrido puede correr las veces que sea sin hacer daño.

export interface NotifEnv {
  DB: D1Database;
  RESEND_API_KEY?: string;
}

export interface EventoNotif {
  clave: string;
  nombre: string;
  familia: string;
  obligatorio: number;
  canales: string;
  def_push: number;
  def_mail: number;
  activo: number;
  dias_antes: number | null;
  tope_diario: number;
  asunto: string | null;
  cuerpo: string | null;
  push_titulo: string | null;
  push_texto: string | null;
}

// {nombre} y {vence} — una sola sintaxis para todo el sistema. Las plantillas
// viejas de reservas usan {{x}}: se aceptan las dos para no romperlas.
export function interpolar(texto: string, vars: Record<string, string | number>): string {
  return String(texto || '')
    .replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''))
    .replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export async function leerEvento(env: NotifEnv, clave: string): Promise<EventoNotif | null> {
  return env.DB.prepare(`SELECT * FROM notif_eventos WHERE clave = ?`).bind(clave).first<EventoNotif>();
}

// Qué canales corresponden para este socio y este evento: los que el evento
// permite, menos los que el socio apagó, menos los que están dados de baja.
async function canalesPara(env: NotifEnv, ev: EventoNotif, socioId: number): Promise<string[]> {
  const permitidos = String(ev.canales || '').split(',').map((c) => c.trim()).filter(Boolean);
  const prefs = await env.DB.prepare(
    `SELECT canal, habilitado FROM notif_prefs WHERE socio_id = ? AND evento = ?`,
  ).bind(socioId, ev.clave).all<{ canal: string; habilitado: number }>();
  const dicho = new Map(prefs.results.map((p) => [p.canal, p.habilitado]));

  const bajas = await env.DB.prepare(
    `SELECT canal FROM notif_canal WHERE socio_id = ? AND estado != 'optin'`,
  ).bind(socioId).all<{ canal: string }>();
  const cortados = new Set(bajas.results.map((b) => b.canal));

  return permitidos.filter((c) => {
    if (cortados.has(c) && !ev.obligatorio) return false;
    if (dicho.has(c)) return dicho.get(c) === 1 || !!ev.obligatorio;
    return c === 'push' ? !!ev.def_push : c === 'mail' ? !!ev.def_mail : false;
  });
}

// Freno de mano: si un aviso quiere salir más veces de las que se configuró en
// un día, se corta y queda registrado. Es la diferencia entre un error molesto
// y uno que le llega a todo el padrón.
async function pasaElTope(env: NotifEnv, ev: EventoNotif): Promise<boolean> {
  const hoy = new Date().toISOString().slice(0, 10);
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM notif_envios WHERE evento = ? AND estado = 'enviado' AND substr(enviado, 1, 10) = ?`,
  ).bind(ev.clave, hoy).first<{ n: number }>();
  return (r?.n || 0) < (ev.tope_diario || 200);
}

interface Destinatario {
  socioId: number;
  nombre?: string | null;
  email?: string | null;
}

/**
 * Encola (y despacha) un aviso. Devuelve qué pasó por cada canal.
 * `dedup` tiene que ser determinista para el hecho que se está avisando.
 */
export async function notificar(
  env: NotifEnv,
  clave: string,
  quien: Destinatario,
  vars: Record<string, string | number> = {},
  opts: { dedup?: string; programado?: string; forzar?: boolean } = {},
): Promise<{ canal: string; estado: string; motivo?: string }[]> {
  const ev = await leerEvento(env, clave);
  if (!ev) return [{ canal: '-', estado: 'omitido', motivo: 'el evento no existe' }];
  if (!ev.activo && !opts.forzar) return [{ canal: '-', estado: 'omitido', motivo: 'el aviso está apagado' }];

  const canales = await canalesPara(env, ev, quien.socioId);
  if (!canales.length) return [{ canal: '-', estado: 'omitido', motivo: 'sin canales habilitados' }];

  const dedup = opts.dedup || `${clave}:${quien.socioId}:${new Date().toISOString().slice(0, 10)}`;
  const salida: { canal: string; estado: string; motivo?: string }[] = [];

  for (const canal of canales) {
    // reclamar insertando: si choca con el índice único, ya está tomado
    let id: number | null = null;
    try {
      const ins = await env.DB.prepare(
        `INSERT INTO notif_envios (socio_id, evento, canal, clave_dedup, estado, programado)
         VALUES (?, ?, ?, ?, 'pendiente', ?)`,
      ).bind(quien.socioId, clave, canal, dedup, opts.programado || null).run();
      id = Number(ins.meta?.last_row_id);
    } catch {
      salida.push({ canal, estado: 'omitido', motivo: 'ya se había mandado' });
      continue;
    }
    if (opts.programado) { salida.push({ canal, estado: 'programado' }); continue; }

    if (!(await pasaElTope(env, ev))) {
      await env.DB.prepare(`UPDATE notif_envios SET estado = 'omitido', motivo = 'tope diario' WHERE id = ?`).bind(id).run();
      salida.push({ canal, estado: 'omitido', motivo: 'llegó al tope del día' });
      continue;
    }

    const r = await despachar(env, ev, canal, quien, vars);
    await env.DB.prepare(
      `UPDATE notif_envios SET estado = ?, motivo = ?, proveedor_id = ?, intentos = intentos + 1,
        enviado = CASE WHEN ? = 'enviado' THEN datetime('now') ELSE NULL END WHERE id = ?`,
    ).bind(r.ok ? 'enviado' : 'fallido', r.motivo || null, r.proveedorId || null, r.ok ? 'enviado' : 'fallido', id).run();
    salida.push({ canal, estado: r.ok ? 'enviado' : 'fallido', motivo: r.motivo });
  }
  return salida;
}

async function despachar(
  env: NotifEnv, ev: EventoNotif, canal: string, quien: Destinatario, vars: Record<string, string | number>,
): Promise<{ ok: boolean; motivo?: string; proveedorId?: string }> {
  const v = { nombre: String(quien.nombre || '').split(' ')[0] || 'hola', ...vars };
  if (canal === 'mail') {
    if (!quien.email) return { ok: false, motivo: 'el socio no tiene mail' };
    return enviarMail(env, quien.email, interpolar(ev.asunto || ev.nombre, v), interpolar(ev.cuerpo || '', v));
  }
  if (canal === 'push') {
    // El emisor de push llega con el service worker (etapa 2). Hasta
    // entonces queda registrado como no despachado, sin romper el resto.
    return { ok: false, motivo: 'push todavía no está conectado' };
  }
  return { ok: false, motivo: 'canal desconocido' };
}

// El único lugar del sistema que le habla a Resend.
export async function enviarMail(
  env: NotifEnv, para: string, asunto: string, cuerpo: string,
): Promise<{ ok: boolean; motivo?: string; proveedorId?: string }> {
  if (!env.RESEND_API_KEY) return { ok: false, motivo: 'falta la clave de Resend' };
  const parrafos = cuerpo.split('\n').filter(Boolean)
    .map((p) => {
      // una línea que es SOLO una URL se convierte en botón: el CTA del aviso
      const url = p.trim();
      if (/^https:\/\/\S+$/.test(url)) {
        return `<div style="margin:22px 0"><a href="${escapar(url)}" style="display:inline-block;background:#6e4fa0;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:.02em;text-decoration:none;padding:13px 26px;border-radius:9px">Entrar a mi cuenta</a></div>`;
      }
      return `<p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#2b2338">${escapar(p)}</p>`;
    })
    .join('');
  const html = `<div style="background:#f6f4f9;padding:28px 16px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:30px 28px">
      <div style="font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#6e4fa0;margin-bottom:18px">Flora</div>
      ${parrafos}
      <div style="margin-top:26px;padding-top:16px;border-top:1px solid #e6e2ee;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#857a93">
        Asociación Civil Cann de Cannabis Medicinal · <a href="https://floraong.ar/socios/" style="color:#6e4fa0">floraong.ar</a>
      </div>
    </div></div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Flora <hola@floraong.ar>', to: [para], subject: asunto, html }),
    });
    if (!r.ok) return { ok: false, motivo: `Resend ${r.status}` };
    const d = await r.json<{ id?: string }>().catch(() => ({} as { id?: string }));
    return { ok: true, proveedorId: d.id };
  } catch (e) {
    return { ok: false, motivo: 'no se pudo conectar con Resend' };
  }
}

function escapar(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
