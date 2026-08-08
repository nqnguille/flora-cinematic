/* Módulo Inicio (prefijo ik-): la fila HOY compacta + el kanban del viaje
   del socio. Sin drag & drop a propósito: la etapa se DERIVA de los datos
   y avanza con acciones reales (contactar, cargar código, verificar firma,
   mandar link), no arrastrando tarjetas.
   Desde el 08/08 el kanban ABSORBIÓ el tablero de Leads (la pestaña de
   Socios se borró): las cards de lead viven acá, con sus acciones reusadas
   vía window.PanelLeads (mod-socios.js). Encima del tablero hay una barra
   de filtros client-side (buscador + lente de tiempo + comportamiento,
   combinables) y el estado "frío": cards dormidas a mano que no se
   muestran salvo con su chip. */
(() => {
  'use strict'
  const P = window.Panel
  // Usa el formateador del shell, con respaldo por si este módulo se cargó
  // antes que el shell nuevo (durante un deploy): una fecha fea es mejor que
  // el panel caído.
  const fFecha = (v) => (window.Panel && window.Panel.fecha)
    ? window.Panel.fecha(v)
    : (String(v || '').slice(0, 10).split('-').reverse().join('/') || '—')

  // Próxima acción por estado del trámite (versión corta de PASOS.ayuda)
  const ACCION_TRAMITE = {
    sin_iniciar: 'Arrancar el trámite',
    esperando_codigo: 'Pedirle su código',
    codigo_listo: 'Cargarlo con Ezequiel',
    revisar: 'Confirmar en qué anda',
    observado: 'Objetó algo',
    a_vincular: 'Nos toca vincular',
    en_evaluacion: 'Espera al Ministerio',
    revision_medica: 'Volvió a Ezequiel',
    vencido: 'Renovar el certificado',
    rechazado: 'Rearmar el trámite',
  }

  const dosPalabras = (n) => String(n || '—').trim().split(/\s+/).slice(0, 2).join(' ')
  const avatar = (n) => `<span class="av">${P.esc(P.iniciales ? P.iniciales(n) : '?')}</span>`
  const pelota = (quien) => quien === 'club' ? 'club' : quien === 'paciente' ? 'paciente' : quien === 'medico' ? 'medico' : 'org'
  const ddmm = (iso) => {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? `${m[3]}/${m[2]}` : ''
  }
  const LD = () => window.PanelLeads || null
  const LD_UI = () => (window.PanelLeads && window.PanelLeads.ui) || null

  // ---------- tiempo y estancamiento ----------
  const diasDesde = (ts) => {
    const raw = String(ts || '')
    const t = Date.parse(raw.replace(' ', 'T') + (raw.includes('T') || !raw ? '' : 'Z'))
    return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null
  }
  // Estancamiento visual a ritmo de club (umbral alto a propósito: si se
  // prende en la mitad de las cards deja de ser señal): >14 días sin
  // actividad → puntito ámbar 🕐 junto al tiempo; >30 días → además el
  // "hace X" entero en ámbar.
  const marcaTiempo = (ts, sufijo) => {
    const d = diasDesde(ts)
    if (d === null) return 'sin movimientos'
    const txt = (d <= 0 ? 'hoy' : d === 1 ? 'hace 1 día' : `hace ${d} días`) + (sufijo || '')
    return `<span class="ik-hace${d > 30 ? ' ik-hace-viejo' : ''}">${d > 14 ? '<i class="ik-dot" data-tip="Más de 14 días sin actividad">🕐</i>' : ''}${P.esc(txt)}</span>`
  }

  // El timestamp más significativo de cada card, para la lente de tiempo y
  // el estancamiento (documentado acá y calzado con lo que manda inicio.ts):
  //   leads      → etapa_desde (cuánto lleva parado en su etapa; si no, creado)
  //   entrevista → reprocann_actualizado (último movimiento del trámite)
  //   firmas     → dec_firmada || dec_generada || reprocann_actualizado
  //                (el último hito del papel en juego)
  //   ministerio → reprocann_actualizado
  //   vinculados → reprocann_actualizado (cuándo quedó aprobado/convertido)
  //   adheridos  → actualizado de la suscripción (último latido del débito)
  // Sin fecha = se trata como MUY inactivo (cae en 14d+ y 30d+, nunca en 7d).
  const tsDe = (col, it) => {
    if (it.etapa) return it.etapa_desde || it.creado   // un lead, en cualquier columna
    if (col === 'firmas') return it.dec_firmada || it.dec_generada || it.actualizado
    return it.actualizado
  }
  const diasSin = (col, it) => diasDesde(tsDe(col, it))

  // ---------- estado del módulo (no persiste a propósito) ----------
  let cont = null
  let cargando = false
  let datos = null
  let lente = 'todos'          // todos | act7 | inact14 | inact30
  const comps = new Set()      // consulta | vencer | club (se combinan en Y)
  let verFrios = false
  let busca = ''
  let buscaT = null

  async function recargar() {
    if (!cont || cargando) return
    cargando = true
    try {
      const r = await fetch('/api/panel/inicio', { credentials: 'include' })
      if (!r.ok) throw new Error('El servidor respondió ' + r.status)
      datos = await r.json()
      render()
    } catch (err) {
      cont.innerHTML = `<div class="vacio">${P.esc(err.message)}</div>`
    }
    cargando = false
  }

  // ---------- filtros ----------
  const pasaLente = (d) => {
    if (lente === 'act7') return d !== null && d <= 7
    if (lente === 'inact14') return d === null || d >= 14
    if (lente === 'inact30') return d === null || d >= 30
    return true
  }
  const pasaComp = (comp, col, it) => {
    if (comp === 'consulta') return it.prox_dias !== null && it.prox_dias !== undefined && it.prox_dias >= 0
    if (comp === 'vencer') {
      return (it.vence_dias !== null && it.vence_dias !== undefined && it.vence_dias < 45)
        || (it.fin_dias !== null && it.fin_dias !== undefined && it.fin_dias < 35)
    }
    if (comp === 'club') {
      // "nos toca" = la pelota es nuestra: quien='club', o el chip violeta
      // (verificar la dec firmada / mandar el link del débito)
      if (it.etapa) return false // el lead corre por su propio embudo
      if (col === 'entrevista' || col === 'ministerio') return it.quien === 'club'
      if (col === 'firmas') return it.dec_estado === 'firmada'
      if (col === 'vinculados') return !it.no_insistir
      return false
    }
    return true
  }
  // buscador: nombre / email / teléfono, en TODAS las columnas
  const pasaBusca = (it) => {
    if (!busca) return true
    return [it.nombre, it.email, it.telefono].some((v) => String(v || '').toLowerCase().includes(busca))
  }
  const pasaFiltros = (col, it) => pasaBusca(it)
    && pasaLente(diasSin(col, it))
    && [...comps].every((c) => pasaComp(c, col, it))
  const hayFiltro = () => lente !== 'todos' || comps.size > 0 || !!busca

  // De dónde salen las cards de cada columna. LEADS = leads en nuevo o
  // contactado; ENTREVISTA es MIXTA: arriba los leads en etapa entrevista
  // (orden: turno más próximo primero), abajo los socios en preparación.
  const ordenTurno = (a, b) => {
    const ta = a.turno_fecha ? Date.parse(String(a.turno_fecha).replace(' ', 'T') + 'Z') : Infinity
    const tb = b.turno_fecha ? Date.parse(String(b.turno_fecha).replace(' ', 'T') + 'Z') : Infinity
    return (ta - tb) || String(a.etapa_desde || '').localeCompare(String(b.etapa_desde || ''))
  }
  function itemsDe(colId, deFrios) {
    const k = datos.kanban
    const pick = (cd) => (cd ? (deFrios ? (cd.frios ? cd.frios.items : []) : cd.items) : [])
    if (colId === 'leads') return pick(k.leads).filter((l) => l.etapa !== 'entrevista')
    if (colId === 'entrevista') {
      const deLead = pick(k.leads).filter((l) => l.etapa === 'entrevista').sort(ordenTurno)
      return [...deLead, ...pick(k.entrevista)]
    }
    return pick(k[colId])
  }
  const visiblesDe = (colId) => itemsDe(colId, verFrios).filter((it) => pasaFiltros(colId, it))
  const leadDe = (id) => {
    const cd = datos && datos.kanban && datos.kanban.leads
    if (!cd) return null
    return cd.items.find((x) => Number(x.id) === id) || (cd.frios ? cd.frios.items.find((x) => Number(x.id) === id) : null) || null
  }

  // ---------- fila HOY ----------
  function filaHoy(d) {
    const tiles = []
    tiles.push(`<div class="card ik-mini in-tile" data-ir="mostrador">
      <span class="k">Retiros hoy</span>
      <div class="ik-mini-v">${d.retirosHoy.n}</div>
      <div class="ik-mini-d">${d.retirosHoy.gramos} g dispensados</div></div>`)
    if (d.cobrosHoy) tiles.push(`<div class="card ik-mini in-tile" data-ir="finanzas">
      <span class="k">Cobros hoy</span>
      <div class="ik-mini-v" style="color:var(--grn)">${P.fmt(d.cobrosHoy.total)}</div>
      <div class="ik-mini-d">${d.cobrosHoy.n} pago${d.cobrosHoy.n === 1 ? '' : 's'}</div></div>`)
    if (d.reservas) tiles.push(`<div class="card ik-mini in-tile" data-ir="reservas">
      <span class="k">Reservas</span>
      <div class="ik-mini-v">${d.reservas.pendientes + d.reservas.listas}</div>
      <div class="ik-mini-d">${d.reservas.pendientes} en preparación · ${d.reservas.listas} listas</div></div>`)
    if (d.pendientesAprobacion != null) tiles.push(`<div class="card ik-mini in-tile" data-ir="finanzas">
      <span class="k">Tu visto bueno</span>
      <div class="ik-mini-v" style="color:${d.pendientesAprobacion ? 'var(--amb)' : 'var(--ink)'}">${d.pendientesAprobacion}</div>
      <div class="ik-mini-d">movimiento${d.pendientesAprobacion === 1 ? '' : 's'} esperando</div></div>`)
    if (d.debitos) tiles.push(`<div class="card ik-mini in-tile" data-ir="finanzas">
      <span class="k">Débito automático</span>
      <div class="ik-mini-v" style="color:var(--grn)">${P.fmt(d.debitos.recaudado_mes)}</div>
      <div class="ik-mini-d">${d.debitos.al_dia} al día · ${d.debitos.esperando} esperando${d.debitos.sin_identificar ? ` · <b style="color:var(--amb)">${d.debitos.sin_identificar} por identificar</b>` : ''}</div></div>`)
    return `<div class="ik-hoy">${tiles.join('')}</div>`
  }

  // ---------- barra de filtros ----------
  function barraFiltros() {
    const k = datos.kanban
    // contadores client-side sobre lo cargado (cards vivas de todas las
    // columnas); el de fríos es el total REAL que manda el server
    const c = { act7: 0, inact14: 0, inact30: 0, consulta: 0, vencer: 0, club: 0 }
    let frios = 0
    for (const def of COLS) {
      const cd = k[def.id]
      if (!cd) continue
      frios += cd.frios ? cd.frios.total : 0
      for (const it of cd.items) {
        const d = diasSin(def.id, it)
        if (d !== null && d <= 7) c.act7++
        if (d === null || d >= 14) c.inact14++
        if (d === null || d >= 30) c.inact30++
        if (pasaComp('consulta', def.id, it)) c.consulta++
        if (pasaComp('vencer', def.id, it)) c.vencer++
        if (pasaComp('club', def.id, it)) c.club++
      }
    }
    const chipL = (id, txt, n) => `<button class="chip${lente === id ? ' on' : ''}" data-lente="${id}" type="button">${txt}${n === undefined ? '' : ` <span class="ik-cnt">${n}</span>`}</button>`
    const chipC = (id, txt, n) => `<button class="chip${comps.has(id) ? ' on' : ''}" data-comp="${id}" type="button">${txt} <span class="ik-cnt">${n}</span></button>`
    return `<div class="ik-filtros">
      <input class="input ik-buscar" type="search" placeholder="Buscar por nombre, mail o teléfono…"
        value="${P.esc(busca)}" autocomplete="off" />
      ${chipL('todos', 'Todos')}
      ${chipL('act7', '🔥 Activos 7d', c.act7)}
      ${chipL('inact14', '🕐 Sin actividad 14d+', c.inact14)}
      ${chipL('inact30', '😴 Sin actividad 30d+', c.inact30)}
      <span class="ik-filtros-sep"></span>
      ${chipC('consulta', '🩺 Con consulta', c.consulta)}
      ${chipC('vencer', '⚠ Por vencer', c.vencer)}
      ${chipC('club', '🟣 Nos toca', c.club)}
      <span class="pn-sp"></span>
      <button class="chip ik-chip-frios${verFrios ? ' on' : ''}" data-frios type="button">😴 Fríos <span class="ik-cnt">${frios}</span></button>
      ${k.leads && LD() && P.puede('leads_gestionar') ? '<button class="btn btn-pri ik-nuevo-lead" type="button">+ Lead</button>' : ''}
    </div>`
  }

  // ---------- cards del kanban ----------
  // Acción rápida frío/revivir (aparece on hover): 😴 duerme la card, ☀️ la
  // revive desde la vista de fríos. Leads van contra leads.ts, el resto
  // contra padron/socio.
  function botonFrio(it, esLead) {
    const cap = esLead ? 'leads_gestionar' : 'padron_editar'
    if (!P.puede(cap)) return ''
    return it.frio
      ? `<button class="ik-qa ik-revivir" type="button" data-nombre="${P.esc(dosPalabras(it.nombre))}" data-tip="Revivir: vuelve al tablero">☀️</button>`
      : `<button class="ik-qa ik-frio" type="button" data-nombre="${P.esc(dosPalabras(it.nombre))}" data-tip="Pasar a frío: sale del tablero">😴</button>`
  }

  // Piezas comunes de una card de lead (badges y acciones vienen del viejo
  // tablero, reusadas tal cual vía PanelLeads.ui)
  function ldPiezas(l) {
    const ui = LD_UI()
    const gestionar = P.puede('leads_gestionar')
    const wa = LD() ? LD().whatsappDe(l) : null
    return {
      badges: ui ? `${ui.badgeOrigen(l)}${ui.chipPago(l)}` : '',
      rc: ui ? ui.chipReprocann(l) : '',
      turno: ui ? ui.turnoLinea(l) : '',
      contacto: (l.email || l.telefono)
        ? `<div class="ik-sub">${P.esc([l.email, l.telefono].filter(Boolean).join(' · '))}</div>` : '',
      nota: l.nota ? `<div class="ik-sub ik-nota">📝 ${P.esc(l.nota)}</div>` : '',
      wa: wa ? `<a class="ik-qa2 ik-ld-wa" href="${P.esc(wa)}" target="_blank" rel="noopener" data-tip="Escribirle por WhatsApp">💬</a>` : '',
      menu: gestionar ? '<div class="ld-menu ik-menu"><button class="btn ld-menubtn ik-ld-menu" type="button" aria-label="Más acciones" aria-expanded="false">⋯</button></div>' : '',
      gestionar,
    }
  }

  // LEADS (nuevo + contactado): la riqueza del tablero viejo en una card
  function cardLead(l) {
    const z = ldPiezas(l)
    const etTag = l.etapa === 'contactado' ? '<span class="tag tag-auto">contactado</span>' : '<span class="tag tag-off">nuevo</span>'
    const avance = !z.gestionar ? '' : (l.etapa === 'nuevo'
      ? '<button class="ik-chip ik-chip-club ik-ld-mover" data-etapa="contactado" type="button">→ Contactados</button>'
      : '<button class="ik-chip ik-chip-club ik-ld-mover" data-etapa="entrevista" type="button">→ Entrevista</button>')
    return `<div class="ik-card ik-lead ik-q-club${l.frio ? ' ik-fria' : ''}" data-lead="${l.id}">
      ${avatar(l.nombre || l.email)}
      <div class="ik-c-body">
        <b>${P.esc(dosPalabras(l.nombre || l.email || '(sin nombre)'))} ${etTag}${l.tiene_adjunto ? ' <span data-tip="Mandó su credencial">📎</span>' : ''}</b>
        <div class="ik-sub">${marcaTiempo(l.etapa_desde || l.creado, ' en esta etapa')}</div>
        ${z.contacto}${z.nota}
        ${z.badges ? `<div class="ik-chips">${z.badges}</div>` : ''}${z.rc}${z.turno}
        <div class="ik-chips ik-acciones">${avance}${z.wa}<span class="pn-sp"></span>${z.menu}</div>
      </div>
      ${botonFrio(l, true)}
    </div>`
  }

  // Lead en ENTREVISTA: el turno del consultorio manda y el alta es LA acción
  function cardLeadEntrevista(l) {
    const z = ldPiezas(l)
    const alta = z.gestionar ? '<button class="ik-chip ik-chip-club ik-ld-alta" type="button">📋 Dar de alta</button>' : ''
    return `<div class="ik-card ik-lead ik-q-club${l.frio ? ' ik-fria' : ''}" data-lead="${l.id}">
      ${avatar(l.nombre || l.email)}
      <div class="ik-c-body">
        <b>${P.esc(dosPalabras(l.nombre || l.email || '(sin nombre)'))}${l.tiene_adjunto ? ' <span data-tip="Mandó su credencial">📎</span>' : ''}</b>
        <div class="ik-sub">${marcaTiempo(l.etapa_desde || l.creado, ' en entrevista')}</div>
        ${z.contacto}${z.nota}
        ${z.badges ? `<div class="ik-chips">${z.badges}</div>` : ''}${z.rc}${z.turno}
        <div class="ik-chips ik-acciones">${alta}${z.wa}<span class="pn-sp"></span>${z.menu}</div>
      </div>
      ${botonFrio(l, true)}
    </div>`
  }

  // ENTREVISTA (socios): el camino "desde cero" en preparación (con la señal
  // del consultorio: la próxima consulta agendada, destacada)
  function cardEntrevista(s) {
    const q = pelota(s.quien)
    const conConsulta = s.prox_dias !== null && s.prox_dias !== undefined && s.prox_dias >= 0
    return `<div class="ik-card ik-q-${q}${s.frio ? ' ik-fria' : ''}" data-socio="${s.id}" data-tab="tramite">
      ${avatar(s.nombre)}
      <div class="ik-c-body">
        <b>${P.esc(dosPalabras(s.nombre))}${conConsulta ? ` <span class="ik-prox" data-tip="Consulta agendada en el consultorio">🩺 próx. ${P.esc(ddmm(s.prox_consulta))}</span>` : ''}</b>
        <div class="ik-sub">${marcaTiempo(s.actualizado, ' en este paso')}</div>
        <div class="ik-chips"><span class="ik-chip ik-chip-${q}">${P.esc(ACCION_TRAMITE[s.estado] || s.estado)}</span></div>
      </div>
      ${botonFrio(s, false)}
    </div>`
  }

  // MINISTERIO: la cocina posterior a la firma (y lo que volvió mal)
  function cardMinisterio(s) {
    const q = pelota(s.quien)
    const fallo = s.estado === 'vencido' || s.estado === 'rechazado'
    const alerta = !fallo && s.vence_dias !== null && s.vence_dias !== undefined && s.vence_dias < 45
    return `<div class="ik-card ik-q-${q}${s.frio ? ' ik-fria' : ''}" data-socio="${s.id}" data-tab="tramite">
      ${avatar(s.nombre)}
      <div class="ik-c-body">
        <b>${P.esc(dosPalabras(s.nombre))}${fallo ? ` <span class="tag tag-mal">${s.estado === 'vencido' ? 'vencido' : 'rechazado'}</span>` : ''}${alerta ? ` <span class="tag tag-mal" data-tip="El certificado vence el ${fFecha(s.vence)}">⚠ vence en ${s.vence_dias} d</span>` : ''}</b>
        <div class="ik-sub">${marcaTiempo(s.actualizado, ' en este paso')}</div>
        <div class="ik-chips"><span class="ik-chip ik-chip-${q}">${P.esc(ACCION_TRAMITE[s.estado] || s.estado)}</span></div>
      </div>
      ${botonFrio(s, false)}
    </div>`
  }

  // FIRMAS: acá se encuentran los dos ríos (consentimiento del trámite
  // desde cero + declaración jurada del autocultivador)
  function cardFirma(s) {
    if (s.tipo === 'consentimiento') {
      return `<div class="ik-card ik-q-paciente${s.frio ? ' ik-fria' : ''}" data-socio="${s.id}" data-tab="tramite">
        ${avatar(s.nombre)}
        <div class="ik-c-body">
          <b>${P.esc(dosPalabras(s.nombre))} <span class="tag tag-auto">Consentimiento</span></b>
          <div class="ik-sub">trámite cargado ${marcaTiempo(s.actualizado)}</div>
          <div class="ik-chips"><span class="ik-chip ik-chip-paciente">🖋 Falta su consentimiento</span></div>
        </div>
        ${botonFrio(s, false)}
      </div>`
    }
    const firmada = s.dec_estado === 'firmada'
    return `<div class="ik-card ${firmada ? 'ik-q-club' : 'ik-q-paciente'}${s.frio ? ' ik-fria' : ''}" data-socio="${s.id}" data-tab="legal">
      ${avatar(s.nombre)}
      <div class="ik-c-body">
        <b>${P.esc(dosPalabras(s.nombre))} <span class="tag tag-auto">Declaración</span></b>
        <div class="ik-sub">${firmada
          ? `firmó ${marcaTiempo(s.dec_firmada)}`
          : `declaración generada ${marcaTiempo(s.dec_generada)}`}</div>
        <div class="ik-chips">${firmada
          ? '<span class="ik-chip ik-chip-club">📋 Verificar y habilitar</span>'
          : '<span class="ik-chip ik-chip-paciente">Esperando su firma</span>'}</div>
      </div>
      ${botonFrio(s, false)}
    </div>`
  }

  function cardVinculado(s) {
    const memb = s.memb_tier ? `<span class="tag tag-off">${P.esc(s.memb_tier)}${s.memb_modalidad ? ' · ' + P.esc(s.memb_modalidad) : ''}</span>` : ''
    const chip = s.no_insistir
      ? '<span class="ik-chip ik-chip-off">no insistir</span>'
      : `<button class="ik-chip ik-chip-club ik-btn-debito" type="button"
           data-id="${s.id}" data-nombre="${P.esc(s.nombre)}" data-tel="${P.esc(s.telefono || '')}">💳 Mandar link 20%</button>`
    return `<div class="ik-card ${s.no_insistir ? 'ik-q-off' : 'ik-q-club'}${s.frio ? ' ik-fria' : ''}" data-socio="${s.id}" data-tab="eco">
      ${avatar(s.nombre)}
      <div class="ik-c-body">
        <b>${P.esc(dosPalabras(s.nombre))}</b>
        <div class="ik-sub">${s.estado === 'conversion' ? 'vinculado por declaración' : 'REPROCANN aprobado'} ${memb}</div>
        <div class="ik-chips">${chip}</div>
      </div>
      ${botonFrio(s, false)}
    </div>`
  }

  function cardAdherido(s) {
    const renovar = (s.racha_meses || 0) >= 2 || (s.fin_dias !== null && s.fin_dias !== undefined && s.fin_dias < 35)
    return `<div class="ik-card ${s.sus_estado === 'activa' ? 'ik-q-ok' : 'ik-q-paciente'}${s.frio ? ' ik-fria' : ''}" data-socio="${s.id}" data-tab="eco">
      ${avatar(s.nombre)}
      <div class="ik-c-body">
        <b>${P.esc(dosPalabras(s.nombre))}${s.sus_estado === 'pendiente' ? ' <span class="tag tag-deb">esperando pago</span>' : ''}</b>
        <div class="ik-sub">${P.esc(s.tier || '—')} · cuota ${s.racha_meses || 0}/3${s.fin ? ` · renueva ${fFecha(s.fin)}` : ''}</div>
        ${renovar ? '<div class="ik-chips"><button class="ik-chip ik-chip-paciente ik-btn-renovar" type="button">↻ renovar</button></div>' : ''}
      </div>
      ${botonFrio(s, false)}
    </div>`
  }

  // ---------- columnas ----------
  // ENTREVISTA es mixta: la card decide su renderer por el tipo del item
  // (un lead trae `etapa`; un socio en preparación trae `estado`).
  const COLS = [
    { id: 'leads', emoji: '📥', titulo: 'Leads', vacio: 'Nadie golpeando la puerta hoy.', card: cardLead },
    { id: 'entrevista', emoji: '🩺', titulo: 'Entrevista', vacio: 'Nadie preparando su entrada.', card: (it) => (it.etapa ? cardLeadEntrevista(it) : cardEntrevista(it)), mas: 'socios' },
    { id: 'firmas', emoji: '✍️', titulo: 'Firmas', vacio: 'Nada esperando una firma.', card: cardFirma, mas: 'socios' },
    { id: 'ministerio', emoji: '🏛️', titulo: 'Ministerio', vacio: 'Nada durmiendo en el Ministerio.', card: cardMinisterio, mas: 'socios' },
    { id: 'vinculados', emoji: '🌿', titulo: 'Vinculados', vacio: 'Sin candidatos al débito.', card: cardVinculado, mas: 'suscripciones' },
    { id: 'adheridos', emoji: '💳', titulo: 'Adheridos', vacio: 'Todavía nadie en débito.', card: cardAdherido, mas: 'suscripciones' },
  ]

  function columna(def) {
    const k = datos.kanban
    const colData = def.id === 'entrevista' ? (k.entrevista || k.leads) : k[def.id]
    if (!colData) return '' // el rol no ve esta columna
    const visibles = visiblesDe(def.id)
    const filtrado = verFrios || hayFiltro()
    const base = itemsDe(def.id, verFrios)
    // sin filtros manda el server (con lo cargado como respaldo); filtrando,
    // lo que se ve. La columna de leads no tiene módulo destino (el tablero
    // viejo se borró): su "+N más" es informativo.
    let n = visibles.length
    let deMas = 0
    if (!filtrado) {
      if (def.id === 'leads') { deMas = k.leads ? k.leads.total - k.leads.items.length : 0; n = base.length }
      else if (def.id === 'entrevista') { deMas = k.entrevista ? k.entrevista.total - k.entrevista.items.length : 0; n = base.length + deMas }
      else { deMas = colData.total - colData.items.length; n = colData.total }
    }
    const vacioTxt = base.length ? 'Nada pasa este filtro.' : (verFrios ? 'Sin fríos acá.' : def.vacio)
    return `<section class="ik-col" data-col="${def.id}">
      <header class="ik-col-h"><span>${def.emoji} ${def.titulo}</span><b class="ik-n">${n}</b></header>
      <div class="ik-cards">
        ${visibles.length ? visibles.map(def.card).join('') : `<div class="ik-vacio">${vacioTxt}</div>`}
        ${deMas > 0 ? (def.mas
    ? `<button class="ik-mas" type="button" data-mas="${def.mas}">+${deMas} más</button>`
    : `<div class="ik-mas ik-mas-info">+${deMas} más</div>`) : ''}
      </div>
    </section>`
  }

  function render() {
    if (!datos) return
    // `capitalize` de CSS pone en mayúscula CADA palabra: quedaba
    // «Miércoles, 5 De Agosto». Va solo la primera letra.
    const hoyCrudo = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
    const hoyLindo = hoyCrudo.charAt(0).toUpperCase() + hoyCrudo.slice(1)
    const k = datos.kanban
    cont.innerHTML = `
      <p style="color:var(--ink2);margin:0 0 12px">${P.esc(hoyLindo)}</p>
      ${filaHoy(datos)}
      ${k ? `${barraFiltros()}<div class="ik-board${verFrios ? ' ik-modo-frios' : ''}">${COLS.map(columna).join('')}</div>` : ''}`
  }

  // ---------- frío / revivir ----------
  // Optimista con confirmación del server: se manda el PATCH, y recién con
  // el ok se saca la card de su lista local y se repinta (contadores incl.).
  function sacarDeKanban(esLead, id) {
    const k = datos && datos.kanban
    if (!k) return null
    for (const nombre of ['leads', 'entrevista', 'firmas', 'ministerio', 'vinculados', 'adheridos']) {
      const cd = k[nombre]
      if (!cd) continue
      if (esLead !== (nombre === 'leads')) continue
      for (const lista of [cd.items, (cd.frios && cd.frios.items) || []]) {
        const i = lista.findIndex((x) => Number(x.id) === id)
        if (i === -1) continue
        const [it] = lista.splice(i, 1)
        return { col: cd, it }
      }
    }
    return null
  }

  async function accionFrio(btn) {
    const card = btn.closest('.ik-card')
    if (!card) return
    const esLead = !!card.dataset.lead
    const id = Number(card.dataset.lead || card.dataset.socio)
    const dar = btn.classList.contains('ik-frio')
    if (dar) {
      const seguro = await P.confirmar(`¿Pasar a frío a ${btn.dataset.nombre || 'esta card'}? Sale del tablero hasta que lo revivas.`, 'Sí, a frío')
      if (!seguro) return
    }
    const r = await fetch(esLead ? '/api/panel/leads' : '/api/panel/padron/socio', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, frio: dar }),
    })
    if (!r.ok) return
    const m = sacarDeKanban(esLead, id)
    if (m) {
      m.it.frio = dar ? new Date().toISOString() : null
      if (dar) { m.col.total--; m.col.frios.total++; m.col.frios.items.unshift(m.it) }
      else { m.col.frios.total--; m.col.total++; m.col.items.unshift(m.it) }
    }
    render()
  }

  // ---------- menú ⋯ de un lead (acciones del viejo tablero, vía PanelLeads) ----------
  function abrirMenuLead(btn) {
    const caja = btn.closest('.ld-menu')
    const abierto = caja.querySelector('.ld-menupanel')
    cont.querySelectorAll('.ld-menupanel').forEach((x) => x.remove())
    cont.querySelectorAll('.ld-menubtn').forEach((b) => b.setAttribute('aria-expanded', 'false'))
    if (abierto) return
    const l = leadDe(Number(btn.closest('.ik-card').dataset.lead))
    if (!l) return
    const ETAPAS = [['nuevo', 'Nuevos'], ['contactado', 'Contactados'], ['entrevista', 'Entrevista']]
    const op = []
    op.push('<button class="btn ik-m-alta" type="button">📋 Dar de alta</button>')
    ETAPAS.forEach(([e2, nom2]) => {
      if (e2 !== l.etapa) op.push(`<button class="btn ik-m-mover" data-etapa="${e2}" type="button">Mover a ${nom2}</button>`)
    })
    op.push('<button class="btn ik-m-nota" type="button">✏️ Nota</button>')
    if (l.email) op.push('<button class="btn ik-m-acceso" type="button">Acceso 7 días a la carta</button>')
    if (l.reprocann && l.email && P.puede('reprocann_editar')) op.push('<button class="btn ik-m-convertir" type="button">🌱 Convertir</button>')
    if (l.tiene_adjunto) op.push('<button class="btn ik-m-ddjj" type="button">📄 Declaración jurada</button>')
    op.push('<button class="btn ik-m-perdido" type="button">Marcar perdido</button>')
    op.push('<button class="btn btn-peligro ik-m-borrar" type="button">🗑 Borrar del todo</button>')
    const panel = document.createElement('div')
    panel.className = 'ld-menupanel'
    panel.innerHTML = op.join('')
    caja.appendChild(panel)
    btn.setAttribute('aria-expanded', 'true')
  }

  function modalNota(l) {
    const ov = P.modal(`Nota — ${l.nombre || l.email || 'lead'}`, `
      <input class="input" id="ik-nota-txt" maxlength="300" value="${P.esc(l.nota || '')}" placeholder="De dónde salió, qué busca…" />
      <div class="pn-mod-acciones"><button class="btn btn-pri" id="ik-nota-ok" type="button">Guardar</button></div>`)
    ov.querySelector('#ik-nota-ok').addEventListener('click', async () => {
      await LD().guardarNota(l.id, ov.querySelector('#ik-nota-txt').value.trim(), () => recargar())
      P.cerrarModal()
    })
  }

  P.registrar('inicio', {
    init(c) {
      cont = c
      recargar()

      // refresco: al volver el foco a la pestaña, sin polling agresivo
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && cont.classList.contains('on')) recargar()
      })

      // buscador: filtra en memoria con debounce, sin repedir al server
      cont.addEventListener('input', (e) => {
        const inp = e.target.closest('.ik-buscar')
        if (!inp) return
        clearTimeout(buscaT)
        const v = inp.value
        buscaT = setTimeout(() => {
          busca = v.trim().toLowerCase()
          render()
          const nuevo = cont.querySelector('.ik-buscar')
          if (nuevo) { try { nuevo.focus(); nuevo.setSelectionRange(v.length, v.length) } catch { /* inputs search sin selección */ } }
        }, 200)
      })

      // un click fuera cierra el menú ⋯ abierto
      document.addEventListener('click', (ev) => {
        if (ev.target.closest('.ld-menu')) return
        cont.querySelectorAll('.ld-menupanel').forEach((x) => x.remove())
        cont.querySelectorAll('.ld-menubtn').forEach((b) => b.setAttribute('aria-expanded', 'false'))
      })

      cont.addEventListener('click', async (e) => {
        // barra de filtros (client-side, sin repedir al server)
        const bl = e.target.closest('[data-lente]')
        if (bl) { lente = bl.dataset.lente; render(); return }
        const bc = e.target.closest('[data-comp]')
        if (bc) {
          const id = bc.dataset.comp
          if (comps.has(id)) comps.delete(id); else comps.add(id)
          render(); return
        }
        if (e.target.closest('[data-frios]')) { verFrios = !verFrios; render(); return }
        if (e.target.closest('.ik-nuevo-lead')) { LD() && LD().nuevoLead(() => recargar()); return }
        // frío / revivir (antes que el click de la card)
        const bf = e.target.closest('.ik-frio, .ik-revivir')
        if (bf) { e.stopPropagation(); accionFrio(bf); return }
        // WhatsApp del lead: dejarlo navegar, sin tocar nada más
        if (e.target.closest('.ik-ld-wa')) return
        // acciones de lead (PanelLeads = las piezas del tablero viejo)
        const card = e.target.closest('.ik-card')
        const leadId = card && card.dataset.lead ? Number(card.dataset.lead) : null
        if (leadId && LD()) {
          const l = leadDe(leadId)
          const mover = e.target.closest('.ik-ld-mover')
          if (mover) {
            mover.disabled = true
            await LD().avanzarEtapa(leadId, mover.dataset.etapa, () => recargar())
            return
          }
          if (e.target.closest('.ik-ld-alta') && l) { LD().darDeAlta(l, () => recargar()); return }
          const menuBtn = e.target.closest('.ik-ld-menu')
          if (menuBtn) { abrirMenuLead(menuBtn); return }
          if (e.target.closest('.ik-m-alta') && l) { LD().darDeAlta(l, () => recargar()); return }
          const mMover = e.target.closest('.ik-m-mover')
          if (mMover) { await LD().avanzarEtapa(leadId, mMover.dataset.etapa, () => recargar()); return }
          if (e.target.closest('.ik-m-nota') && l) { modalNota(l); return }
          if (e.target.closest('.ik-m-acceso') && l) { await LD().accesoCarta(l, () => recargar()); return }
          if (e.target.closest('.ik-m-convertir') && l) { LD().convertir(l, () => recargar()); return }
          if (e.target.closest('.ik-m-ddjj')) { LD().ddjj(leadId); return }
          if (e.target.closest('.ik-m-perdido')) { await LD().marcarPerdido(leadId, () => recargar()); return }
          if (e.target.closest('.ik-m-borrar') && l) { await LD().borrar(l, () => recargar()); return }
          return // card de lead: sin navegación, todo pasa por sus botones
        }
        // chip "Mandar link 20%": directo al modal del débito, sin abrir la ficha
        const btnDeb = e.target.closest('.ik-btn-debito')
        if (btnDeb && window.PanelSocioDetalle) {
          e.stopPropagation()
          window.PanelSocioDetalle.modalDebito({
            id: Number(btnDeb.dataset.id), nombre: btnDeb.dataset.nombre, telefono: btnDeb.dataset.tel,
          })
          return
        }
        // badge renovar de un adherido → módulo Suscripciones
        if (e.target.closest('.ik-btn-renovar')) { e.stopPropagation(); P.ir('suscripciones'); return }
        // "+N más" → el módulo que corresponde
        const mas = e.target.closest('button.ik-mas')
        if (mas) {
          const destino = mas.dataset.mas
          if (destino === 'suscripciones' && !P.puede('mp_gestionar')) return P.ir('socios')
          return P.ir(destino)
        }
        // card de socio → ficha 360° en la solapa que toca
        const cardSocio = e.target.closest('.ik-card[data-socio]')
        if (cardSocio && window.PanelSocioDetalle) {
          return window.PanelSocioDetalle.abrir(Number(cardSocio.dataset.socio), () => recargar(), cardSocio.dataset.tab)
        }
        // mini-tiles de la fila HOY (navegación heredada)
        const t = e.target.closest('.in-tile[data-ir]')
        if (!t) return
        if (t.dataset.filtro) {
          try {
            const nav = JSON.parse(sessionStorage.getItem('so-nav') || '{}')
            nav.filtro = t.dataset.filtro; nav.sub = 'maestra'
            sessionStorage.setItem('so-nav', JSON.stringify(nav))
          } catch { /* nada */ }
        }
        P.ir(t.dataset.ir)
      })
    },
  })
})()
