// Cuentas de MOSTRADOR: las que se usan para atender en el living del club.
// Reservan EN NOMBRE de otro socio, así la reserva nace ya con dueño real y
// todos los avisos posteriores ("tu reserva está lista", el WhatsApp) le
// llegan a esa persona y no a la cuenta compartida.
//
// La lista es editable desde el panel (Reservas → Mostrador). Antes vivía
// hardcodeada en public/panel/mod-reservas.js, donde el backend no la veía:
// por eso el mismo dato estaba escrito en dos lados y solo el front lo sabía.
// El default preserva el comportamiento que ya había sin necesidad de
// configurar nada.

const KEY = 'mostrador';

export interface ConfigMostrador {
  cuentas: string[];
}

export const MOSTRADOR_DEFAULT: ConfigMostrador = {
  cuentas: ['floraclubdecultivo@gmail.com'],
};

function normalizar(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  const vistos = new Set<string>();
  for (const x of lista) {
    const email = String(x || '').trim().toLowerCase();
    if (email && email.includes('@') && email.length <= 160) vistos.add(email);
  }
  return [...vistos].sort();
}

export async function leerMostrador(kv: KVNamespace): Promise<ConfigMostrador> {
  try {
    const raw = await kv.get(KEY);
    // Sin documento guardado vale el default. Un documento guardado VACÍO sí
    // se respeta: apagar el mostrador tiene que ser posible.
    if (raw === null) return { cuentas: [...MOSTRADOR_DEFAULT.cuentas] };
    return { cuentas: normalizar(JSON.parse(raw)?.cuentas) };
  } catch {
    return { cuentas: [...MOSTRADOR_DEFAULT.cuentas] };
  }
}

export async function guardarMostrador(kv: KVNamespace, cuentas: unknown): Promise<ConfigMostrador> {
  const cfg: ConfigMostrador = { cuentas: normalizar(cuentas).slice(0, 20) };
  await kv.put(KEY, JSON.stringify(cfg));
  return cfg;
}

export async function esMostrador(kv: KVNamespace, email: string): Promise<boolean> {
  const cfg = await leerMostrador(kv);
  return cfg.cuentas.includes(String(email || '').trim().toLowerCase());
}
