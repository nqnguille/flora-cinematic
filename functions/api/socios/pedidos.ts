import { readSessionEmail } from './_session';
import { esMostrador } from './_mostrador';

interface Env {
  SESSION_SECRET: string;
  SOCIOS: KVNamespace;
  GENETICAS: KVNamespace;
  PEDIDOS: KVNamespace;
  NOTIFY_TOKEN?: string;
}

// Un pedido vive 90 días en KV; después se purga solo.
const TTL_SECONDS = 90 * 24 * 60 * 60;
const ESTADOS_ACTIVOS = ['pendiente', 'listo'];
// Tope de reservas abiertas a la vez por cuenta. Existe para que un socio que
// se olvidó de que ya reservó no deje tres pedidos abiertos y el club prepare
// de más. La cuenta compartida del living es justamente la que más lo usa.
const MAX_ACTIVAS = 4;
const MAX_ITEMS = 12;
const MAX_CANTIDAD = { flor: 50, preroll: 20, producto: 10 } as Record<string, number>;
// Tope de la RESERVA COMPLETA, no por línea: bajo ningún concepto una
// reserva puede juntar más de 40 g de flor, 40 prerolls o 18 goteros de
// aceite, sin importar cuántas genéticas o líneas distintas se sumen (la
// ley habilita hasta 6 frascos de 30 ml; este tope es más conservador).
const TOTAL_MAX = { flor: 40, preroll: 40, aceite: 18 } as Record<string, number>;
const NOTIFY_URL = 'https://gates-analytics.nqnguille.workers.dev/api/notify';

function formatosDe(g: any): string[] {
  return Array.isArray(g.formatos) && g.formatos.length ? g.formatos : ['flor'];
}

// "producto" agrupa aceites/cremas/extracciones; el tope de 18 es solo para
// los aceites (goteros), así que hay que distinguirlos por su id.
function categoriaDe(item: { formato: string; id: string }): string {
  if (item.formato === 'producto' && String(item.id).startsWith('aceite')) return 'aceite';
  return item.formato;
}

function excedeTopeTotal(items: any[]): string | null {
  const totales: Record<string, number> = {};
  for (const it of items) {
    const cat = categoriaDe(it);
    totales[cat] = (totales[cat] || 0) + Number(it.cantidad || 0);
  }
  for (const [cat, max] of Object.entries(TOTAL_MAX)) {
    if ((totales[cat] || 0) > max) {
      const unidad = cat === 'flor' ? 'g de flor' : cat === 'preroll' ? 'prerolls' : 'goteros de aceite';
      return `la reserva no puede superar ${max} ${unidad} en total`;
    }
  }
  return null;
}

// Socio autenticado Y todavía en la lista (una baja invalida la sesión para pedir).
async function requireSocio(request: Request, env: Env): Promise<{ email: string; rec: any } | null> {
  const email = await readSessionEmail(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!email) return null;
  const raw = await env.SOCIOS.get(email);
  if (raw === null) return null;
  let rec: any = {};
  try { rec = JSON.parse(raw); } catch { rec = {}; }
  if (typeof rec !== 'object' || rec === null) rec = {};
  if (rec.temporal && rec.tempExpiraEn && Date.now() > new Date(rec.tempExpiraEn).getTime()) return null;
  return { email, rec };
}

async function pedidosDe(env: Env, email?: string): Promise<any[]> {
  const list = await env.PEDIDOS.list({ prefix: 'pedido:' });
  const pedidos = (
    await Promise.all(list.keys.map(async (k) => {
      const raw = await env.PEDIDOS.get(k.name);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }))
  ).filter((p): p is any => !!p && (!email || p.email === email));
  pedidos.sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
  return pedidos;
}

// El pedido del socio (el activo si hay, si no el último).
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const socio = await requireSocio(request, env);
  if (!socio) return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });

  const pedidos = await pedidosDe(env, socio.email);
  const abiertos = pedidos.filter((p) => ESTADOS_ACTIVOS.includes(p.estado));
  // `activo` es la más reciente (pedidos viene ordenado desc); `activos` es
  // cuántas hay abiertas, para que la carta lo pueda decir tal cual.
  return Response.json({ ok: true, activo: abiertos[0] || null, activos: abiertos.length, pedidos: pedidos.slice(0, 10) });
};

// Valida y normaliza ítems crudos (genéticas flor/preroll + productos del portal).
// Devuelve { items } o { error }.
async function validarItems(env: Env, rawItems: any[]): Promise<{ items?: any[]; error?: string }> {
  const rawCat = await env.GENETICAS.get('catalogo');
  const catalogo: any[] = rawCat ? JSON.parse(rawCat) : [];
  const porId = new Map(catalogo.map((g) => [g.id, g]));

  const rawPrecios = await env.GENETICAS.get('precios');
  const precios: any = rawPrecios ? JSON.parse(rawPrecios) : {};
  const productos = new Map<string, any>(
    ['aceites', 'cremas', 'extracciones']
      .flatMap((c) => (Array.isArray(precios[c]) ? precios[c] : []))
      .map((it: any) => [String(it.id), it])
  );

  const fusionados = new Map<string, { id: string; formato: string; cantidad: number }>();
  for (const it of rawItems) {
    const k = `${String(it?.id || '')}|${String(it?.formato || '')}`;
    const prev = fusionados.get(k);
    if (prev) prev.cantidad += Number(it?.cantidad);
    else fusionados.set(k, { id: String(it?.id || ''), formato: String(it?.formato || ''), cantidad: Number(it?.cantidad) });
  }

  const items: any[] = [];
  for (const it of fusionados.values()) {
    const formato = String(it?.formato || '');
    const cantidad = Math.floor(Number(it?.cantidad));

    if (formato === 'producto') {
      const prod = productos.get(String(it?.id || ''));
      if (!prod) return { error: `producto no disponible: ${it?.id}` };
      if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD.producto) {
        return { error: `cantidad inválida para ${prod.label}` };
      }
      const nombre = prod.detalle ? `${prod.label} (${prod.detalle})` : prod.label;
      items.push({ id: prod.id, nombre, formato, cantidad, precio: prod.precio });
      continue;
    }

    const g = porId.get(String(it?.id || ''));
    if (!g || !g.activo) return { error: `genética no disponible: ${it?.id}` };
    if (!['flor', 'preroll'].includes(formato) || !formatosDe(g).includes(formato)) {
      return { error: `formato inválido para ${g.nombre}` };
    }
    if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD[formato]) {
      return { error: `cantidad inválida para ${g.nombre}` };
    }
    items.push({ id: g.id, nombre: g.nombre, formato, cantidad });
  }
  const excede = excedeTopeTotal(items);
  if (excede) return { error: excede };
  return { items };
}

// Editar la reserva pendiente: reemplaza sus ítems (cantidades, quitar, sumar).
// items vacío ⇒ se cancela la reserva.
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const socio = await requireSocio(request, env);
  if (!socio) return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }

  const id = String(body?.id || '');
  const raw = id ? await env.PEDIDOS.get(`pedido:${id}`) : null;
  if (!raw) return Response.json({ ok: false, error: 'reserva inexistente' }, { status: 404 });
  const pedido = JSON.parse(raw);
  if (pedido.email !== socio.email) return Response.json({ ok: false, error: 'reserva ajena' }, { status: 403 });
  if (pedido.estado !== 'pendiente') {
    return Response.json({ ok: false, error: 'esa reserva ya no se puede editar' }, { status: 409 });
  }

  const rawItems = Array.isArray(body?.items) ? body.items : [];
  if (rawItems.length > MAX_ITEMS) {
    return Response.json({ ok: false, error: 'demasiados ítems' }, { status: 400 });
  }

  if (!rawItems.length) {
    await env.PEDIDOS.delete(`pedido:${id}`);
    context.waitUntil(notificar(env, { ...pedido, items: [], _cancelada: true }));
    return Response.json({ ok: true, pedido: null, cancelada: true });
  }

  const v = await validarItems(env, rawItems);
  if (v.error) return Response.json({ ok: false, error: v.error }, { status: 400 });

  pedido.items = v.items;
  if (body?.nota != null) pedido.nota = String(body.nota).slice(0, 400);
  pedido.actualizado = new Date().toISOString();
  await env.PEDIDOS.put(`pedido:${id}`, JSON.stringify(pedido), { expirationTtl: TTL_SECONDS });
  context.waitUntil(notificar(env, { ...pedido, _actualizada: true }));
  return Response.json({ ok: true, pedido });
};

// Crear pedido: valida ítems contra el catálogo y avisa por WhatsApp.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const socio = await requireSocio(request, env);
  if (!socio) return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });

  // Acceso de prueba: puede armar el carrito y ver precios, pero la reserva
  // real (que le llega a Sofi por WhatsApp) queda para pacientes vinculados.
  if (socio.rec.temporal) {
    return Response.json({
      ok: false,
      error: 'Para reservar necesitás ser paciente vinculado a Flora. Escribinos por WhatsApp y te ayudamos a completar el proceso.',
    }, { status: 403 });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }

  const rawItems = Array.isArray(body?.items) ? body.items : [];
  if (!rawItems.length || rawItems.length > MAX_ITEMS) {
    return Response.json({ ok: false, error: 'el pedido no tiene ítems válidos' }, { status: 400 });
  }

  // `aparte` = el socio pidió explícitamente empezar OTRA reserva, en vez de
  // sumar a la que ya tiene. Hace falta para dos casos reales:
  //   · la cuenta compartida del living, donde cada reserva es de una persona
  //     distinta y no tiene sentido fusionarlas;
  //   · la misma genética en dos bolsitas separadas, que dentro de un mismo
  //     pedido es imposible: los ítems se deduplican por id|formato y siempre
  //     terminan sumando cantidad.
  // MOSTRADOR: la cuenta del living atiende y reserva EN NOMBRE del socio que
  // tiene enfrente. La reserva nace con dueño real, así los avisos de "lista"
  // y "entregada" le llegan a esa persona sin que nadie tenga que reasignar
  // nada después, y el panel muestra su nombre en vez del de la cuenta.
  const paraSocio = String(body?.paraSocio || '').trim().toLowerCase();
  let destino = { email: socio.email, name: socio.rec.name || '', mostrador: '' };

  if (paraSocio && paraSocio !== socio.email) {
    if (!(await esMostrador(env.GENETICAS, socio.email))) {
      return Response.json({ ok: false, error: 'esta cuenta no puede reservar a nombre de otro socio' }, { status: 403 });
    }
    const rawDestino = await env.SOCIOS.get(paraSocio);
    if (rawDestino === null) return Response.json({ ok: false, error: 'ese email no es un socio cargado' }, { status: 400 });
    let recDestino: any = {};
    try { recDestino = JSON.parse(rawDestino); } catch { /* valor legado "ok" */ }
    if (typeof recDestino !== 'object' || recDestino === null) recDestino = {};
    if (recDestino.temporal) {
      return Response.json({ ok: false, error: 'ese socio tiene acceso de prueba: todavía no puede reservar' }, { status: 400 });
    }
    destino = { email: paraSocio, name: recDestino.name || paraSocio, mostrador: socio.email };
  }

  // En el mostrador cada atención es una reserva propia: dos personas
  // distintas, o la misma volviendo más tarde, nunca se fusionan en un bolso
  // solo. Por eso ahí `aparte` es siempre verdadero.
  const aparte = body?.aparte === true || !!destino.mostrador;

  const activos = (await pedidosDe(env, destino.email)).filter((p) => ESTADOS_ACTIVOS.includes(p.estado));
  const yaActivo = aparte ? null : activos.find((p) => ESTADOS_ACTIVOS.includes(p.estado));

  if (aparte && activos.length >= MAX_ACTIVAS) {
    const quien = destino.mostrador ? `${destino.name || destino.email} ya tiene` : 'ya tenés';
    return Response.json(
      { ok: false, error: `${quien} ${activos.length} reservas abiertas: retirá alguna antes de empezar otra` },
      { status: 409 },
    );
  }
  if (!aparte && yaActivo && yaActivo.estado !== 'pendiente') {
    return Response.json({ ok: false, error: 'tenés una reserva lista para retirar; pasá por el club antes de sumar otra', activo: yaActivo }, { status: 409 });
  }

  const v = await validarItems(env, rawItems);
  if (v.error) return Response.json({ ok: false, error: v.error }, { status: 400 });
  const items = v.items!;

  const now = new Date().toISOString();

  // Con una reserva pendiente, los ítems nuevos se suman a ella (carrito único)
  if (yaActivo) {
    for (const nuevo of items) {
      const prev = yaActivo.items.find((x: any) => x.id === nuevo.id && x.formato === nuevo.formato);
      if (prev) {
        const tope = MAX_CANTIDAD[nuevo.formato] ?? 10;
        prev.cantidad = Math.min(tope, prev.cantidad + nuevo.cantidad);
        if (nuevo.precio != null) prev.precio = nuevo.precio;
      } else if (yaActivo.items.length < MAX_ITEMS) {
        yaActivo.items.push(nuevo);
      } else {
        return Response.json({ ok: false, error: 'la reserva ya tiene el máximo de ítems' }, { status: 400 });
      }
    }
    // El chequeo de validarItems() ya vio los ítems NUEVOS de este request,
    // pero no el total ya fusionado con lo que la reserva pendiente traía.
    const excede = excedeTopeTotal(yaActivo.items);
    if (excede) return Response.json({ ok: false, error: excede }, { status: 400 });

    if (body?.nota) yaActivo.nota = String(body.nota).slice(0, 400);
    yaActivo.actualizado = now;
    await env.PEDIDOS.put(`pedido:${yaActivo.id}`, JSON.stringify(yaActivo), { expirationTtl: TTL_SECONDS });
    context.waitUntil(notificar(env, { ...yaActivo, _actualizada: true }));
    return Response.json({ ok: true, pedido: yaActivo, fusionado: true });
  }

  const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const pedido = {
    id,
    email: destino.email,
    name: destino.name,
    // Queda la traza de quién la cargó: sirve para el chip "Mostrador" del
    // panel y para saber que la reserva no la hizo el socio desde su celular.
    ...(destino.mostrador ? { mostrador: destino.mostrador } : {}),
    items,
    nota: String(body?.nota || '').slice(0, 400),
    estado: 'pendiente',
    creado: now,
    actualizado: now,
  };
  await env.PEDIDOS.put(`pedido:${id}`, JSON.stringify(pedido), { expirationTtl: TTL_SECONDS });

  context.waitUntil(notificar(env, pedido));
  return Response.json({ ok: true, pedido });
};

// Cancelar el propio pedido mientras siga pendiente.
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const socio = await requireSocio(request, env);
  if (!socio) return Response.json({ ok: false, error: 'no autenticado' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'body inválido' }, { status: 400 });
  }
  const id = String(body?.id || '');
  const raw = id ? await env.PEDIDOS.get(`pedido:${id}`) : null;
  if (!raw) return Response.json({ ok: false, error: 'reserva inexistente' }, { status: 404 });

  const pedido = JSON.parse(raw);
  if (pedido.email !== socio.email) return Response.json({ ok: false, error: 'reserva ajena' }, { status: 403 });
  if (pedido.estado !== 'pendiente') {
    return Response.json({ ok: false, error: 'la reserva ya no se puede cancelar' }, { status: 409 });
  }
  pedido.estado = 'cancelado';
  pedido.actualizado = new Date().toISOString();
  await env.PEDIDOS.put(`pedido:${id}`, JSON.stringify(pedido), { expirationTtl: TTL_SECONDS });
  // era el único cambio de estado que no avisaba a nadie: el club se enteraba
  // recién al preparar una reserva que ya no existía
  context.waitUntil(notificar(env, { ...pedido, items: [], _cancelada: true }));
  return Response.json({ ok: true, pedido });
};

// WhatsApp vía el hub de avisos (gates-analytics). Sin token configurado no avisa
// (así los entornos de prueba no disparan mensajes reales). Nunca rompe el pedido.
async function notificar(env: Env, pedido: any) {
  if (!env.NOTIFY_TOKEN) return;
  try {
    const lineas = pedido.items
      .map((i: any) => `· ${i.cantidad}${i.formato === 'flor' ? ' g' : ' u'} — ${i.nombre}${i.formato === 'preroll' ? ' (preroll)' : ''}`)
      .join('\n');
    const text =
      (pedido._cancelada ? `🌿 RESERVA CANCELADA — Portal Flora\n` : pedido._actualizada ? `🌿 RESERVA ACTUALIZADA — Portal Flora\n` : `🌿 RESERVA NUEVA — Portal Flora\n`) +
      `👤 ${pedido.name || pedido.email} (${pedido.email})\n` +
      (pedido.mostrador ? `🏪 Cargada en el mostrador\n` : '') +
      lineas +
      (pedido.nota ? `\n📝 ${pedido.nota}` : '') +
      `\n💵 Abona la cuota al retirar en el club` +
      `\nPanel: https://floraong.ar/admin/`;
    await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, token: env.NOTIFY_TOKEN, topic: 'flora-reserva' }),
    });
  } catch {
    /* el aviso nunca bloquea el pedido */
  }
}
