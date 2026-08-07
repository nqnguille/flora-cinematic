// Los TEXTOS de /socios/membresias.
//
// Vive en KV GENETICAS bajo la clave 'membresias', igual que 'avisos'. Están
// TODOS los textos de la página, editables desde el panel sin volver a
// compilar: hasta acá solo eran ocho y el resto estaba escrito en el HTML, así
// que cambiar «Lo retirás en la sede» pedía un deploy.
//
// El orden de los campos es el ORDEN EN QUE SE VEN EN LA PÁGINA, de arriba
// hacia abajo. El editor del panel se arma leyendo ZONAS, así que si acá se
// agrega un campo en su lugar, allá aparece en el lugar correcto.
//
// Los PLANES no están acá: viven en la tabla `precios` de D1, que es la misma
// que usan el alta de socios, la cobranza de finanzas y el panel de Mercado
// Pago. Tenerlos también en KV era tener dos verdades sobre lo mismo.

export interface ItemTexto { t: string; d: string }

export interface Membresias {
  // ── 1. Barra de arriba ────────────────────────────────────────────────
  navCuenta: string;
  ctaCarta: string;
  ctaWhatsapp: string;
  navSalir: string;

  // ── 2. Encabezado ─────────────────────────────────────────────────────
  eyebrow: string;
  titulo: string;
  tituloEm: string;   // la parte del título que va en cursiva y en verde
  lead: string;

  // ── 3. Sello legal (recuadro de la derecha) ───────────────────────────
  selloLabel: string;
  selloTexto: string;

  // ── 4. Tarjetas de precio ─────────────────────────────────────────────
  etiquetaPrecio: string;    // rótulo del importe de contado
  retiro: string;            // la línea de abajo del precio
  etiquetaPrecio2: string;   // rótulo del bloque de débito; vacío = no se muestra
  ahorro: string;            // {monto} se reemplaza por lo que ahorra
  envio: string;
  botonSuscribir: string;
  insigniaMia: string;       // la marca de la membresía que ya tiene
  vacio: string;             // cuando no hay ninguna membresía cargada

  // ── 5. Columna «¿Cómo funciona?» ──────────────────────────────────────
  cicloTitulo: string;
  ciclo: ItemTexto[];

  // ── 6. Columna «Beneficios exclusivos» ────────────────────────────────
  beneficiosTitulo: string;
  beneficios: ItemTexto[];

  // ── 7. Cartel de verificación (aparece al tocar Suscribir) ────────────
  verifTitulo: string;
  verifTramite: string;
  verifEscribinos: string;
  verifCerrar: string;

  // ── Regla de negocio, no es un texto ──────────────────────────────────
  estadosAdhesion: string[];
}

export const MEMBRESIAS_KEY = 'membresias';
export const MAX_ITEMS = 6;

export const MEMBRESIAS_DEFAULT: Membresias = {
  navCuenta: '← Mi cuenta',
  ctaCarta: 'Carta',
  ctaWhatsapp: 'WhatsApp',
  navSalir: 'Cerrar sesión',

  eyebrow: 'Solo para socios',
  titulo: 'Membresías',
  tituloEm: 'de flores',
  lead: 'Cada membresía define tus gramos del mes. El aporte es la cuota asociativa que sostiene el cultivo que los produce: la tierra, la luz, el agua, los insumos, el trabajo de quienes cuidan las plantas y los análisis de laboratorio de cada lote. Es lo que cuesta producirlo.',

  selloLabel: 'Ley 27.350 · REPROCANN',
  selloTexto: 'Servicio exclusivo para personas asociadas con credencial REPROCANN vigente que designe a la Asociación Civil Cann de Cannabis Medicinal como su cultivadora. Personería jurídica I.G.J. N.º 1994128, CUIT 30-71827609-4. Lo que recibís no es una compra: es la entrega de tu propio cultivo, amparado por ese vínculo. Podés dar de baja la suscripción cuando quieras, vos mismo, desde Mercado Pago.',

  etiquetaPrecio: 'Contado o transferencia',
  retiro: 'Lo retirás en la sede',
  etiquetaPrecio2: 'Con débito automático',
  ahorro: 'ahorrás {monto}/mes',
  envio: '+ envío sin cargo',
  botonSuscribir: 'Suscribir con',
  insigniaMia: 'Tu membresía',
  vacio: 'Todavía no hay membresías cargadas.',

  cicloTitulo: '¿Cómo funciona?',
  ciclo: [
    { t: 'Te suscribís con Mercado Pago', d: 'Podés elegir pagar con débito, crédito o dinero en cuenta.' },
    { t: 'Cada mes, sin hacer nada', d: 'Tus gramos se habilitan solos en tu cuenta, listos para retirar.' },
    { t: 'Variedad a elección', d: 'Elegí tus favoritas en la carta de genéticas, hasta completar tu plan.' },
  ],

  beneficiosTitulo: 'Beneficios exclusivos',
  beneficios: [
    { t: '{dto} menos, por 3 meses', d: 'Ese precio te queda congelado aunque la lista suba en el medio.' },
    { t: 'Envío sin cargo', d: 'Te llevamos el pedido a tu domicilio al siguiente día hábil.' },
    { t: 'No perdés lo que no retirás', d: 'Si un mes no pasás a retirarlos, se acumulan para el siguiente.' },
  ],

  verifTitulo: 'Antes de suscribirte',
  verifTramite: 'Ver mi trámite',
  verifEscribinos: 'Escribinos',
  verifCerrar: 'Cerrar',

  // El criterio que fijó Guille el 04/08: el trámite tiene que estar
  // presentado ante el Ministerio.
  estadosAdhesion: ['en_evaluacion', 'aprobado'],
};

/**
 * Las zonas que dibuja el editor. Cada campo declara acá su rótulo, cuánto
 * mide y en qué parte de la página vive, para que el panel no tenga que
 * repetir esa información ni se desincronice cuando se agrega un texto.
 */
export const ZONAS: {
  id: string; nombre: string; donde: string;
  campos: { k: keyof Membresias; lb: string; max: number; largo?: boolean; ayuda?: string }[];
  lista?: { k: 'ciclo' | 'beneficios'; titulo: keyof Membresias };
}[] = [
  {
    id: 'nav', nombre: 'Barra de arriba', donde: 'La primera línea de la página, sobre la foto.',
    campos: [
      { k: 'navCuenta', lb: 'Volver a la cuenta', max: 40 },
      { k: 'ctaCarta', lb: 'Ir a la carta', max: 60 },
      { k: 'ctaWhatsapp', lb: 'Consultar', max: 60 },
      { k: 'navSalir', lb: 'Salir', max: 40 },
    ],
  },
  {
    id: 'hero', nombre: 'Encabezado', donde: 'El título grande y su bajada, a la izquierda.',
    campos: [
      { k: 'eyebrow', lb: 'Línea de arriba', max: 60 },
      { k: 'titulo', lb: 'Título', max: 80 },
      { k: 'tituloEm', lb: 'Segunda parte, en cursiva verde', max: 80 },
      { k: 'lead', lb: 'Bajada', max: 600, largo: true },
    ],
  },
  {
    id: 'sello', nombre: 'Sello legal', donde: 'El recuadro de la derecha, arriba.',
    campos: [
      { k: 'selloLabel', lb: 'Rótulo', max: 60 },
      { k: 'selloTexto', lb: 'Texto', max: 900, largo: true,
        ayuda: 'Lo primero que lee alguien que todavía no es socio. Conviene que lo revise tu abogada antes de tocarlo.' },
    ],
  },
  {
    id: 'tarjetas', nombre: 'Tarjetas de precio', donde: 'Las cuatro tarjetas del medio.',
    campos: [
      { k: 'etiquetaPrecio', lb: 'Debajo del precio de contado', max: 40 },
      { k: 'etiquetaPrecio2', lb: 'Rótulo del bloque de débito', max: 40, ayuda: 'Vacío = no se muestra el bloque.' },
      { k: 'ahorro', lb: 'Cuánto ahorra', max: 60, ayuda: 'Usá {monto} donde va la plata.' },
      { k: 'envio', lb: 'Línea del envío', max: 60 },
      { k: 'botonSuscribir', lb: 'Botón de suscripción', max: 40, ayuda: 'Al lado va el logo de Mercado Pago.' },
      { k: 'insigniaMia', lb: 'Marca de su membresía', max: 40 },
      { k: 'vacio', lb: 'Si no hay ninguna cargada', max: 120 },
    ],
  },
  {
    id: 'ciclo', nombre: 'Columna de la izquierda', donde: 'Debajo de las tarjetas: cómo funciona.',
    campos: [{ k: 'cicloTitulo', lb: 'Título', max: 60 }],
    lista: { k: 'ciclo', titulo: 'cicloTitulo' },
  },
  {
    id: 'beneficios', nombre: 'Columna de la derecha',
    donde: 'Debajo de las tarjetas: por qué conviene. Escribí {dto} y se reemplaza por el descuento real de los precios.',
    campos: [{ k: 'beneficiosTitulo', lb: 'Título', max: 60 }],
    lista: { k: 'beneficios', titulo: 'beneficiosTitulo' },
  },
  {
    id: 'verif', nombre: 'Cartel de verificación', donde: 'Aparece al tocar Suscribir sin el trámite en regla.',
    campos: [
      { k: 'verifTitulo', lb: 'Título', max: 80 },
      { k: 'verifTramite', lb: 'Botón al trámite', max: 40 },
      { k: 'verifEscribinos', lb: 'Botón de WhatsApp', max: 40 },
      { k: 'verifCerrar', lb: 'Botón de cerrar', max: 40 },
    ],
  },
];

const txt = (v: unknown, max: number, porDefecto = '') => {
  const s = String(v ?? '').trim().slice(0, max);
  return s || porDefecto;
};

function items(v: unknown, porDefecto: ItemTexto[]): ItemTexto[] {
  if (!Array.isArray(v)) return porDefecto;
  const l = v
    .map((x) => {
      const o = (x || {}) as Record<string, unknown>;
      return { t: String(o.t ?? '').trim().slice(0, 90), d: String(o.d ?? '').trim().slice(0, 260) };
    })
    .filter((x) => x.t || x.d)
    .slice(0, MAX_ITEMS);
  return l.length ? l : porDefecto;
}

/** Un solo lugar arma el documento, lo lea quien lo lea. */
function normalizar(g: Partial<Membresias>): Membresias {
  const d = MEMBRESIAS_DEFAULT;
  return {
    navCuenta: txt(g.navCuenta, 40, d.navCuenta),
    ctaCarta: txt(g.ctaCarta, 60, d.ctaCarta),
    ctaWhatsapp: txt(g.ctaWhatsapp, 60, d.ctaWhatsapp),
    navSalir: txt(g.navSalir, 40, d.navSalir),

    eyebrow: txt(g.eyebrow, 60, d.eyebrow),
    titulo: txt(g.titulo, 80, d.titulo),
    // la cursiva SÍ puede quedar vacía: hay títulos de una sola parte
    tituloEm: String(g.tituloEm ?? d.tituloEm).trim().slice(0, 80),
    lead: txt(g.lead, 600, d.lead),

    selloLabel: txt(g.selloLabel, 60, d.selloLabel),
    selloTexto: txt(g.selloTexto, 900, d.selloTexto),

    etiquetaPrecio: txt(g.etiquetaPrecio, 40, d.etiquetaPrecio),
    retiro: txt(g.retiro, 60, d.retiro),
    etiquetaPrecio2: String(g.etiquetaPrecio2 ?? d.etiquetaPrecio2).trim().slice(0, 40),
    ahorro: txt(g.ahorro, 60, d.ahorro),
    envio: String(g.envio ?? d.envio).trim().slice(0, 60),
    botonSuscribir: txt(g.botonSuscribir, 40, d.botonSuscribir),
    insigniaMia: txt(g.insigniaMia, 40, d.insigniaMia),
    vacio: txt(g.vacio, 120, d.vacio),

    cicloTitulo: txt(g.cicloTitulo, 60, d.cicloTitulo),
    ciclo: items(g.ciclo, d.ciclo),
    beneficiosTitulo: txt(g.beneficiosTitulo, 60, d.beneficiosTitulo),
    beneficios: items(g.beneficios, d.beneficios),

    verifTitulo: txt(g.verifTitulo, 80, d.verifTitulo),
    verifTramite: txt(g.verifTramite, 40, d.verifTramite),
    verifEscribinos: txt(g.verifEscribinos, 40, d.verifEscribinos),
    verifCerrar: txt(g.verifCerrar, 40, d.verifCerrar),

    // Sin lista no se guarda un array vacío por error: eso dejaría a TODOS los
    // socios sin poder adherirse, y es más probable que sea un bug del
    // formulario que una decisión.
    estadosAdhesion: (() => {
      if (!Array.isArray(g.estadosAdhesion)) return d.estadosAdhesion;
      const l = (g.estadosAdhesion as unknown[])
        .filter((s): s is string => typeof s === 'string' && !!s.trim())
        .slice(0, 20);
      return l.length ? l : d.estadosAdhesion;
    })(),
  };
}

export async function leerMembresias(kv: KVNamespace): Promise<Membresias> {
  let guardado: Partial<Membresias> = {};
  try { guardado = ((await kv.get(MEMBRESIAS_KEY, 'json')) as Partial<Membresias>) || {}; } catch { /* sin doc: defaults */ }
  return normalizar(guardado);
}

export function validarMembresias(entrada: unknown): { ok: true; doc: Membresias } | { ok: false; error: string } {
  if (typeof entrada !== 'object' || entrada === null) return { ok: false, error: 'falta el documento' };
  return { ok: true, doc: normalizar(entrada as Partial<Membresias>) };
}
