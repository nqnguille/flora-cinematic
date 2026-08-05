// Los TEXTOS de /socios/membresias.
//
// Vive en KV GENETICAS bajo la clave 'membresias', igual que 'avisos'. Acá
// están SOLO los textos: encabezado, bajada y aclaraciones, editables desde el
// panel sin volver a compilar.
//
// Los PLANES no están acá: viven en la tabla `precios` de D1, que es la misma
// que usan el alta de socios, la cobranza de finanzas y el panel de Mercado
// Pago. Tenerlos también en KV era tener dos verdades sobre lo mismo, y una se
// iba a quedar vieja: cargar una lista de precios nueva no habría cambiado lo
// que ve el socio.

export interface Membresias {
  eyebrow: string;
  titulo: string;
  tituloEm: string;   // la parte del título que va en cursiva y en verde
  lead: string;
  // Qué estados de REPROCANN habilitan la adhesión al débito. Editable desde
  // el panel: la regla es del club, no del código.
  estadosAdhesion: string[];
  etiquetaPrecio: string;    // rótulo de la primera columna de importes
  etiquetaPrecio2: string;   // rótulo de la segunda; vacío = no se muestra
  notaTitulo: string;
  notas: string[];
  ctaCarta: string;
  ctaWhatsapp: string;
}

export const MEMBRESIAS_KEY = 'membresias';
export const MAX_NOTAS = 8;

export const MEMBRESIAS_DEFAULT: Membresias = {
  eyebrow: 'Solo para socios',
  titulo: 'Membresías',
  tituloEm: 'de flores',
  lead: 'Cada membresía define cuántos gramos mensuales te corresponden de tu propio cultivo. El aporte sostiene ese cultivo: la tierra, la luz, el trabajo y los análisis de cada lote.',
  // El default es el criterio que fijó Guille el 04/08: el trámite tiene que
  // estar presentado ante el Ministerio.
  estadosAdhesion: ['en_evaluacion', 'aprobado'],
  etiquetaPrecio: 'Contado o transferencia',
  etiquetaPrecio2: 'Débito automático',
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
    estadosAdhesion: Array.isArray(guardado.estadosAdhesion)
      ? guardado.estadosAdhesion.filter((s) => typeof s === 'string').slice(0, 20)
      : d.estadosAdhesion,
    etiquetaPrecio: txt(guardado.etiquetaPrecio, 40, d.etiquetaPrecio),
    etiquetaPrecio2: typeof guardado.etiquetaPrecio2 === 'string' ? guardado.etiquetaPrecio2.trim().slice(0, 40) : d.etiquetaPrecio2,
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
      // Sin lista no se guarda un array vacío por error: eso dejaría a TODOS
      // los socios sin poder adherirse, y es más probable que sea un bug del
      // formulario que una decisión.
      estadosAdhesion: (() => {
        if (!Array.isArray(e.estadosAdhesion)) return d.estadosAdhesion;
        const lista = (e.estadosAdhesion as unknown[])
          .filter((s): s is string => typeof s === 'string' && !!s.trim())
          .slice(0, 20);
        // El comentario de arriba prometía esto pero el código no lo hacía: un
        // array vacío pasaba el filtro y se guardaba, dejando a TODOS los
        // socios sin poder adherirse. Ahora es verdad.
        return lista.length ? lista : d.estadosAdhesion;
      })(),
      etiquetaPrecio: txt(e.etiquetaPrecio, 40, d.etiquetaPrecio),
      etiquetaPrecio2: String(e.etiquetaPrecio2 ?? '').trim().slice(0, 40),
      notaTitulo: txt(e.notaTitulo, 60, d.notaTitulo),
      notas,
      ctaCarta: txt(e.ctaCarta, 60, d.ctaCarta),
      ctaWhatsapp: txt(e.ctaWhatsapp, 60, d.ctaWhatsapp),
    },
  };
}
