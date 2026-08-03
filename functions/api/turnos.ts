// Puente público al turnero del consultorio, para el CTA "Agendar turno
// ahora" de la home. La API del consultorio no tiene CORS (y no hace falta:
// esto corre server-side). Devuelve solo lo que el CTA necesita, con caché
// corto en el edge para no golpear el Google Calendar del consultorio en
// cada visita a la home.
const BASE = 'https://consultorio.floraong.ar/api/publico';

export const onRequestGet: PagesFunction = async () => {
  try {
    const [cfg, hue] = await Promise.all([
      fetch(`${BASE}/consultorio`, { cf: { cacheTtl: 120, cacheEverything: true } } as RequestInit).then((r) => r.json()) as Promise<any>,
      fetch(`${BASE}/huecos`, { cf: { cacheTtl: 120, cacheEverything: true } } as RequestInit).then((r) => r.json()) as Promise<any>,
    ]);
    const proximo = Array.isArray(hue?.huecos) && hue.huecos.length ? hue.huecos[0].inicio : null;
    return Response.json({
      ok: true,
      agendaDisponible: !!cfg?.agendaDisponible,
      profesional: cfg?.consultorio?.profesional || null,
      precio: cfg?.consultorio?.precio || null,
      duracion: cfg?.duracion || null,
      proximo,
    }, { headers: { 'Cache-Control': 'public, max-age=120' } });
  } catch {
    // sin datos el CTA se muestra igual, solo que sin el "próximo turno"
    return Response.json({ ok: false }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  }
};
