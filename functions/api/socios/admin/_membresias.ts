// El documento de /socios/membresias: los textos de la página y los planes.
//
// Vive entero en KV GENETICAS bajo la clave 'membresias', igual que 'precios'
// y 'avisos'. Todo lo que se ve en esa página sale de acá, así que se puede
// cambiar desde el panel sin tocar código ni volver a compilar.
//
// Los planes NO se guardan en el documento de precios: si estuvieran en los
// dos lados habría dos verdades y una se quedaría vieja.

export interface Plan {
  id: string;
  label: string;
  detalle: string;
  precio: number;
}

export interface Membresias {
  eyebrow: string;
  titulo: string;
  tituloEm: string;   // la parte del título que va en cursiva y en verde
  lead: string;
  planes: Plan[];
  notaTitulo: string;
  notas: string[];
  ctaCarta: string;
  ctaWhatsapp: string;
}

export const MEMBRESIAS_KEY = 'membresias';
export const MAX_PLANES = 12;
export const MAX_NOTAS = 8;

export const MEMBRESIAS_DEFAULT: Membresias = {
  eyebrow: 'Solo para socios',
  titulo: 'Membresías',
  tituloEm: 'de flores',
  lead: 'Cada membresía define cuántos gramos mensuales te corresponden de tu propio cultivo. El aporte sostiene ese cultivo: la tierra, la luz, el trabajo y los análisis de cada lote.',
  planes: [],
  notaTitulo: 'Cómo funciona',
  notas: [
    'Los gramos se renuevan cada mes y se retiran en la sede, en Neuquén capital.',
    'Lo que retirás no es una compra: es la entrega de tu propio cultivo, amparado por tu vínculo REPROCANN con la Asociación.',
    'Para cambiar de membresía, escribinos y lo coordinamos.',
  ],
  ctaCarta: 'Ver la carta de genéticas',
  ctaWhatsapp: 'Consultar por WhatsApp',
};

const txt = (v: unknown, max: number, porDefecto = '') => {
  const s = String(v ?? '').trim().slice(0, max);
  return s || porDefecto;
};

export async function leerMembresias(kv: KVNamespace): Promise<Membresias> {
  let guardado: Partial<Membresias> = {};
  try { guardado = ((await kv.get(MEMBRESIAS_KEY, 'json')) as Partial<Membresias>) || {}; } catch { /* sin doc: defaults */ }
  const d = MEMBRESIAS_DEFAULT;
  return {
    eyebrow: txt(guardado.eyebrow, 60, d.eyebrow),
    titulo: txt(guardado.titulo, 80, d.titulo),
    tituloEm: txt(guardado.tituloEm, 80, d.tituloEm),
    lead: txt(guardado.lead, 600, d.lead),
    planes: Array.isArray(guardado.planes) ? guardado.planes.slice(0, MAX_PLANES) : d.planes,
    notaTitulo: txt(guardado.notaTitulo, 60, d.notaTitulo),
    notas: Array.isArray(guardado.notas) ? guardado.notas.slice(0, MAX_NOTAS) : d.notas,
    ctaCarta: txt(guardado.ctaCarta, 60, d.ctaCarta),
    ctaWhatsapp: txt(guardado.ctaWhatsapp, 60, d.ctaWhatsapp),
  };
}

// Devuelve el documento limpio, o un mensaje de error para mostrarle a quien
// está editando. Se valida plan por plan para que un solo importe mal escrito
// no ensucie el resto.
export function validarMembresias(entrada: unknown): { ok: true; doc: Membresias } | { ok: false; error: string } {
  if (typeof entrada !== 'object' || entrada === null) return { ok: false, error: 'falta el documento' };
  const e = entrada as Record<string, unknown>;

  const planesRaw = Array.isArray(e.planes) ? e.planes : [];
  if (planesRaw.length > MAX_PLANES) return { ok: false, error: `no se pueden cargar más de ${MAX_PLANES} planes` };

  const planes: Plan[] = [];
  const idsVistos = new Set<string>();
  for (const raw of planesRaw) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const label = String(it.label ?? '').trim().slice(0, 60);
    if (!label) return { ok: false, error: 'hay un plan sin nombre' };

    const precio = Math.round(Number(it.precio));
    // precio <= 0 y no solo < 0: un plan en $0 no es un caso legítimo, es un
    // campo que quedó vacío.
    if (!Number.isFinite(precio) || precio <= 0 || precio > 100_000_000) {
      return { ok: false, error: `el importe de "${label}" tiene que ser un número mayor a $0` };
    }

    let id = String(it.id ?? '').trim().slice(0, 40)
      || label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    while (idsVistos.has(id)) id += '-2';
    idsVistos.add(id);

    planes.push({ id, label, detalle: String(it.detalle ?? '').trim().slice(0, 120), precio });
  }

  const notas = (Array.isArray(e.notas) ? e.notas : [])
    .map((n) => String(n ?? '').trim().slice(0, 400))
    .filter(Boolean)
    .slice(0, MAX_NOTAS);

  const d = MEMBRESIAS_DEFAULT;
  return {
    ok: true,
    doc: {
      eyebrow: txt(e.eyebrow, 60, d.eyebrow),
      titulo: txt(e.titulo, 80, d.titulo),
      tituloEm: String(e.tituloEm ?? '').trim().slice(0, 80),
      lead: txt(e.lead, 600, d.lead),
      planes,
      notaTitulo: txt(e.notaTitulo, 60, d.notaTitulo),
      notas,
      ctaCarta: txt(e.ctaCarta, 60, d.ctaCarta),
      ctaWhatsapp: txt(e.ctaWhatsapp, 60, d.ctaWhatsapp),
    },
  };
}
