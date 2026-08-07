// Los planes de membresía, leídos de donde ya viven: la tabla `precios` de
// D1, que es la misma que usa el alta de socios, la cobranza de finanzas y el
// panel de Mercado Pago.
//
// Antes esta página tenía su propia copia de los planes en KV. Eran dos
// verdades sobre lo mismo y una se iba a quedar vieja: si el equipo cargaba
// una lista de precios nueva, la página de socios seguía mostrando la
// anterior. Ahora hay una sola.
//
// El link de suscripción NO se guarda en ningún lado: se construye del
// mp_plan_id, igual que lo hace el panel (planesDebito en panel/mp).

export interface PlanSocio {
  item: string;
  gramos: number | null;
  contado: number | null;
  debito: number | null;
  cupo: number | null;
  linkDebito: string | null;
  // Cuánto sale el gramo en cada modalidad. Es el dato que hace comparables a
  // los planes entre sí, y nadie lo calcula de memoria: en la lista vigente el
  // gramo va de $20.000 en SMALL a $12.500 en EXTRA LARGE con débito.
  porGramo: number | null;
  porGramoDebito: number | null;
}

interface EnvPlanes { DB: D1Database }

// Gana la lista vigente más reciente: el ORDER BY + el "si ya lo vi, sigo"
// dejan una fila por ítem, la de la lista más nueva que ya entró en vigencia.
export async function planesVigentes(env: EnvPlanes): Promise<PlanSocio[]> {
  const rows = await env.DB.prepare(
    `SELECT p.item, p.gramos, p.contado, p.debito, p.cupo, p.mp_plan_id
       FROM precios p JOIN listas_precios lp ON lp.id = p.lista_id
      WHERE p.tipo = 'membresia' AND lp.vigente_desde <= date('now')
      ORDER BY lp.vigente_desde DESC, p.gramos ASC`,
  ).all<{ item: string; gramos: number | null; contado: number | null; debito: number | null; cupo: number | null; mp_plan_id: string | null }>();

  const vistos = new Set<string>();
  const out: PlanSocio[] = [];
  for (const r of rows.results) {
    if (vistos.has(r.item)) continue;
    vistos.add(r.item);
    out.push({
      item: r.item,
      gramos: r.gramos,
      contado: r.contado,
      debito: r.debito,
      cupo: r.cupo,
      linkDebito: r.mp_plan_id
        ? `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${r.mp_plan_id}`
        : null,
      porGramo: r.gramos && r.contado ? Math.round(r.contado / r.gramos) : null,
      porGramoDebito: r.gramos && r.debito ? Math.round(r.debito / r.gramos) : null,
    });
  }
  // De menor a mayor, que es como se leen: SMALL, MEDIUM, LARGE, EXTRA LARGE.
  out.sort((a, b) => (a.gramos ?? 0) - (b.gramos ?? 0));
  return out;
}

// El plan que tiene hoy el socio y si ya está adherido al débito. Con esto la
// página puede marcar "esta es la tuya" y no ofrecerle adherirse a algo que ya
// tiene andando.
// Qué estados de REPROCANN habilitan la adhesión NO se decide acá: sale del
// documento que se edita en el panel (Membresías → Quién puede adherirse). El
// default, si nunca se tocó, es el criterio que fijó Guille el 04/08: el
// trámite tiene que estar presentado ante el Ministerio.

// Por qué no puede, dicho de forma que la persona sepa qué hacer. La clave es
// el estado del trámite; el texto va tal cual a la pantalla.
const MOTIVOS: Record<string, string> = {
  sin_iniciar: 'Todavía no arrancamos tu trámite de REPROCANN. Escribinos y lo empezamos.',
  esperando_codigo: 'Falta que generes tu código de vinculación en Mi Argentina.',
  codigo_listo: 'Ya tenemos tu código: el médico tiene que cargar el trámite.',
  cargado: 'El médico cargó tu trámite: falta que aceptes el consentimiento desde tu cuenta.',
  observado: 'Objetaste algo de tu trámite. Escribinos y lo resolvemos.',
  a_vincular: 'Ya firmaste: nos toca a nosotros vincularte. Lo hacemos en estos días.',
  revision_medica: 'El organismo pidió correcciones al médico. Está en sus manos.',
  revisar: 'Estamos confirmando en qué anda tu trámite de REPROCANN. Escribinos y lo destrabamos.',
  rechazado: 'Tu solicitud de REPROCANN fue rechazada. Escribinos para ver cómo seguir.',
  vencido: 'Tu REPROCANN venció: hay que renovarlo antes de adherirte.',
  autocultivo: 'Figurás como autocultivo, así que no dependés de Flora para tu cultivo.',
  ddjj_pendiente: 'Antes de adherirte tenés que firmar tu declaración jurada: está en Mi cuenta esperándote.',
  ddjj_firmada: 'Tu declaración jurada está firmada y en verificación. En cuanto la verifiquemos, podés adherirte.',
};

// Con declaración jurada pendiente no hay adhesión posible, ni siquiera con
// habilitación individual: es el requisito legal de la renuncia al autocultivo.
const VEDADOS_DDJJ = new Set(['autocultivo', 'ddjj_pendiente', 'ddjj_firmada']);
const MOTIVO_SIN_DATO = 'Todavía no tenemos registrado el estado de tu REPROCANN. Escribinos y lo vemos.';

export function puedeAdherir(estado: string | null, habilitados: string[], habilitadoAparte = false): { puede: boolean; motivo: string | null } {
  if (estado && VEDADOS_DDJJ.has(estado)) return { puede: false, motivo: MOTIVOS[estado] || MOTIVO_SIN_DATO };
  // declaración verificada = atajo completo: puede adherirse ya, la
  // reinscripción ante el Ministerio es cocina interna del club
  if (estado === 'conversion') return { puede: true, motivo: null };
  // la habilitación individual la concede el panel a un socio puntual, por
  // encima de la lista general de estados
  if (habilitadoAparte) return { puede: true, motivo: null };
  if (estado && habilitados.includes(estado)) return { puede: true, motivo: null };
  return { puede: false, motivo: (estado && MOTIVOS[estado]) || MOTIVO_SIN_DATO };
}

export async function situacionDelSocio(env: EnvPlanes, email: string): Promise<{
  socioId: number | null;
  tier: string | null;
  modalidad: string | null;
  debitoActivo: boolean;
  reprocann: string | null;
  adhesionHabilitada: boolean;
}> {
  const socio = await env.DB.prepare(
    `SELECT id, reprocann_estado, adhesion_habilitada FROM socios WHERE email = ? AND (numero IS NULL OR numero != -1)`,
  ).bind(email.toLowerCase()).first<{ id: number; reprocann_estado: string | null; adhesion_habilitada: string | null }>();
  if (!socio) return { socioId: null, tier: null, modalidad: null, debitoActivo: false, reprocann: null, adhesionHabilitada: false };

  const [memb, susc] = await Promise.all([
    env.DB.prepare(
      `SELECT tier, modalidad FROM membresias
        WHERE socio_id = ? AND (hasta IS NULL OR hasta > date('now'))
        ORDER BY modalidad = 'plan' DESC, desde DESC LIMIT 1`,
    ).bind(socio.id).first<{ tier: string; modalidad: string }>(),
    env.DB.prepare(
      `SELECT estado FROM suscripciones WHERE socio_id = ? AND estado = 'activa' LIMIT 1`,
    ).bind(socio.id).first<{ estado: string }>(),
  ]);

  return {
    socioId: socio.id,
    tier: memb?.tier ?? null,
    modalidad: memb?.modalidad ?? null,
    debitoActivo: !!susc,
    reprocann: socio.reprocann_estado ?? null,
    adhesionHabilitada: !!socio.adhesion_habilitada,
  };
}
