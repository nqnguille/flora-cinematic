// Motor de "Unificar pacientes": funciones puras, sin I/O.
// El volcado del portal trae la identidad OFICIAL (nombre, apellido, DNI) de
// cada trámite de la ONG; acá se normaliza, se elige un trámite ganador por
// persona y se puntúan candidatos contra el padrón. La decisión final es
// siempre humana — esto solo propone.

export interface TramitePortal {
  dni: string;
  tramite_id: number;
  nombre: string;
  apellido: string;
  estado: string;
  autocultivo: number;
  plantas: number | null;
  inicio: string | null;
  vence: string | null;
  renovacion: number;
}

export interface SocioMatch {
  id: number;
  nombre: string;
  documento: string | null;
}

export interface Puntaje {
  puntaje: number;
  match: string[];
  conflictos: string[];
  confianza: 'alta' | 'media' | 'baja' | 'revisar';
}

// Estados del portal (los 8 oficiales) → nuestro embudo (migración 0008).
export const DESDE_REPROCANN: Record<string, string> = {
  PendienteConsentimientoPaciente: 'cargado',
  PendienteConsentimiento: 'cargado',
  ObservadoPorPaciente: 'observado',
  PendienteVinculacionCultivador: 'a_vincular',
  PendienteEvaluacion: 'en_evaluacion',
  PendienteRevisionMedica: 'revision_medica',
  Aprobado: 'aprobado',
  Rechazado: 'rechazado',
  Anulado: 'rechazado',
};

export function normDni(v: unknown): string {
  const d = String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return d.length >= 7 && d.length <= 8 ? d : '';
}

export function normTexto(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(v: unknown): string[] {
  return normTexto(v).split(' ').filter((t) => t.length >= 2);
}

// El volcado puede venir como el response crudo del portal (array, o Spring
// pageable {content:[...]}) o como {tramites:[...]} de la extensión. Cada
// ítem puede traer el paciente anidado ({paciente:{nombre,apellido,dni}}) o
// aplanado (pacienteNombre/pacienteApellido/pacienteDni).
export function extraerTramites(crudo: unknown): TramitePortal[] {
  let lista: Record<string, unknown>[] = [];
  if (Array.isArray(crudo)) lista = crudo as Record<string, unknown>[];
  else if (crudo && typeof crudo === 'object') {
    const o = crudo as Record<string, unknown>;
    // el capturador guarda {capturado, url, data}; el portal pagina con {content}
    const anidado = (o.data ?? o) as Record<string, unknown>;
    const c = (anidado as Record<string, unknown>).content ?? (anidado as Record<string, unknown>).tramites ?? anidado;
    if (Array.isArray(c)) lista = c as Record<string, unknown>[];
    else if (Array.isArray(o.content)) lista = o.content as Record<string, unknown>[];
    else if (Array.isArray(o.tramites)) lista = o.tramites as Record<string, unknown>[];
  }
  const out: TramitePortal[] = [];
  for (const t of lista) {
    const pac = (t.paciente || {}) as Record<string, unknown>;
    const dni = normDni(pac.dni ?? t.pacienteDni);
    const id = Number(t.id ?? t.tramiteId);
    const estado = String(t.estado ?? '').trim();
    if (!dni || !Number.isFinite(id) || !estado) continue;
    out.push({
      dni,
      tramite_id: id,
      nombre: String(pac.nombre ?? t.pacienteNombre ?? '').trim().slice(0, 80),
      apellido: String(pac.apellido ?? t.pacienteApellido ?? '').trim().slice(0, 80),
      estado,
      autocultivo: t.autocultivo ? 1 : 0,
      plantas: Number.isFinite(Number(t.cantidadPlantas)) && Number(t.cantidadPlantas) > 0 ? Number(t.cantidadPlantas) : null,
      inicio: t.inicioVigencia ? String(t.inicioVigencia).slice(0, 10) : null,
      vence: t.finalizacionVigencia ? String(t.finalizacionVigencia).slice(0, 10) : null,
      renovacion: t.esRenovacion ? 1 : 0,
    });
  }
  return out;
}

// Varios trámites del mismo DNI (renovaciones, anulados): gana el vigente,
// después el que sigue en curso, después el más nuevo de los muertos.
export function elegirGanador(ts: TramitePortal[], hoy: string): TramitePortal {
  const rango = (t: TramitePortal) => {
    if (t.estado === 'Aprobado' && (!t.vence || t.vence >= hoy)) return 3;
    if (t.estado !== 'Rechazado' && t.estado !== 'Anulado') return 2;
    return 1;
  };
  return [...ts].sort((a, b) => rango(b) - rango(a) || b.tramite_id - a.tramite_id)[0];
}

export function agruparPorPersona(tramites: TramitePortal[], hoy: string): TramitePortal[] {
  const porDni = new Map<string, TramitePortal[]>();
  for (const t of tramites) {
    const arr = porDni.get(t.dni) || [];
    arr.push(t);
    porDni.set(t.dni, arr);
  }
  return [...porDni.values()].map((ts) => elegirGanador(ts, hoy));
}

// El estado del embudo que corresponde a un trámite ganador.
export function pasoDe(t: TramitePortal, hoy: string): string | null {
  if (t.estado === 'Aprobado' && t.autocultivo) return 'autocultivo';
  if (t.estado === 'Aprobado' && t.vence && t.vence < hoy) return 'vencido';
  return DESDE_REPROCANN[t.estado] || null;
}

export function puntuar(socio: SocioMatch, per: TramitePortal): Puntaje {
  const match: string[] = [];
  const conflictos: string[] = [];
  let puntaje = 0;
  const dS = normDni(socio.documento);
  if (dS && dS === per.dni) { match.push('dni'); puntaje += 100; }
  else if (dS && dS !== per.dni) conflictos.push('dni');
  const ts = tokens(socio.nombre);
  const tp = tokens(per.nombre + ' ' + per.apellido);
  const setS = new Set(ts);
  const setP = new Set(tp);
  const inter = ts.filter((t) => setP.has(t));
  const exacto = ts.length === tp.length && inter.length === ts.length;
  const subset = !exacto && inter.length >= 2 && (inter.length === ts.length || inter.length === tp.length);
  if (exacto) { match.push('nombre'); puntaje += 25; }
  else if (subset) { match.push('nombre_parcial'); puntaje += 15; }
  // el conflicto de DNI solo importa si el nombre dice "podría ser él"
  const confDni = conflictos.length > 0 && (exacto || subset);
  const confianza: Puntaje['confianza'] = confDni ? 'revisar'
    : match.includes('dni') ? 'alta'
    : exacto ? 'media'
    : 'baja';
  return { puntaje, match, conflictos: confDni ? conflictos : [], confianza };
}

export interface ParCandidato {
  dni: string;
  candidatos: { socio_id: number; puntaje: Puntaje }[];
}

export function emparejar(
  socios: SocioMatch[],
  personas: TramitePortal[],
  decididos: Set<string>,          // claves `${socio_id}:${dni}` ya en vinculos (cualquier estado)
  sociosVinculados: Set<number>,
  dnisVinculados: Set<string>,
): { pares: ParCandidato[]; sinMatch: string[] } {
  const pool = socios.filter((s) => !sociosVinculados.has(s.id));
  const pares: ParCandidato[] = [];
  const sinMatch: string[] = [];
  for (const per of personas) {
    if (dnisVinculados.has(per.dni)) continue;
    const cands = pool
      .map((s) => ({ socio_id: s.id, puntaje: puntuar(s, per) }))
      .filter((c) => c.puntaje.puntaje >= 15 && !decididos.has(`${c.socio_id}:${per.dni}`))
      .sort((a, b) => b.puntaje.puntaje - a.puntaje.puntaje)
      .slice(0, 3);
    if (!cands.length) sinMatch.push(per.dni);
    else pares.push({ dni: per.dni, candidatos: cands });
  }
  return { pares, sinMatch };
}
