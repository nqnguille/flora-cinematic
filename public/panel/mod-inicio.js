/* Módulo Inicio (prefijo ik-): la fila HOY compacta + el kanban del viaje
   del socio. Sin drag & drop a propósito: la etapa se DERIVA de los datos
   y avanza con acciones reales (cargar código, verificar firma, mandar
   link), no arrastrando tarjetas.
   Encima del tablero hay una barra de filtros client-side (lente de tiempo
   + comportamiento, combinables) y el estado "frío": cards dormidas a mano
   que no se muestran salvo con su chip. */
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
  const NOMBRE_ETAPA_LEAD = { nuevo: 'nuevo', contactado: 'contactado', entrevista: 'entrevista' }

  const dosPalabras = (n) => String(n || '—').trim().split(/\s+/).slice(0, 2).join(' ')
  const avatar = (n) => `<span class="av">${P.esc(P.iniciales ? P.iniciales(n) : '?')}</span>`
  const pelota = (quien) => quien === 'club' ? 'club' : quien === 'paciente' ? 'paciente' : quien === 'medico' ? 'medico' : 'org'
  const ddmm = (iso) => {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? `${m[3]}/${m[2]}` : ''
  }

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
  //   leads      → creado (cuándo golpeó la puerta)
  //   entrevista → reprocann_actualizado (último movimiento del trámite)
  //   firmas     → dec_firmada || dec_generada || reprocann_actualizado
  //                (el último hito del papel en juego)
  //   ministerio → reprocann_actualizado
  //   vinculados → reprocann_actualizado (cuándo quedó aprobado/convertido)
  //   adheridos  → actualizado de la suscripción (último latido del débito)
  // Sin fecha = se trata como MUY inactivo (cae en 14d+ y 30d+, nunca en 7d).
  const tsDe = (col, it) => {
    if (col === 'leads') return it.creado
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
      if (col === 'entrevista' || col === 'ministerio') return it.quien === 'club'
      if (col === 'firmas') return it.dec_estado === 'firmada'
      if (col === 'vinculados') return !it.no_insistir
      return false
    }
    return true
  }
  const pasaFiltros = (col, it) => pasaLente(diasSin(col, it)) && [...comps].every((c) => pasaComp(c, col, it))
  const hayFiltro = () => lente !== 'todos' || comps.size > 0

  function visiblesDe(colId, colData) {
    const base = verFrios ? (colData.frios ? colData.frios.items : []) : colData.items
    return base.filter((it) => pasaFiltros(colId, it))
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
  function barraFiltros(k) {
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

  function cardLead(l) {
    const rc = l.reprocann
    const partes = []
    if (rc && rc.modalidad) partes.push(rc.modalidad)
    if (rc && rc.plantas !== undefined && rc.plantas !== null) partes.push(`${rc.plantas} plantas`)
    return `<div class="ik-card ik-lead${l.frio ? ' ik-fria' : ''}" data-lead="${l.id}">
      ${avatar(l.nombre || l.email)}
      <div class="ik-c-body">
        <b>${P.esc(dosPalabras(l.nombre || l.email || '(sin nombre)'))}</b>
        <div class="ik-sub">${marcaTiempo(l.creado)} · ${P.esc(NOMBRE_ETAPA_LEAD[l.etapa] || l.etapa)}${l.tiene_adjunto ? ' · 📎' : ''}</div>
        ${rc ? `<div class="ik-chips"><span class="tag tag-ok">🌱 REPROCANN ✓${partes.length ? ' ' + P.esc(partes.join(' · ')) : ''}</span></div>` : ''}
      </div>
      ${botonFrio(l, true)}
    </div>`
  }

  // ENTREVISTA: el camino "desde cero" en preparación (con la señal del
  // consultorio: la próxima consulta agendada, destacada)
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
  const COLS = [
    { id: 'leads', emoji: '📥', titulo: 'Leads', vacio: 'Nadie golpeando la puerta hoy.', card: cardLead, mas: 'leads' },
    { id: 'entrevista', emoji: '🩺', titulo: 'Entrevista', vacio: 'Nadie preparando su entrada.', card: cardEntrevista, mas: 'socios' },
    { id: 'firmas', emoji: '✍️', titulo: 'Firmas', vacio: 'Nada esperando una firma.', card: cardFirma, mas: 'socios' },
    { id: 'ministerio', emoji: '🏛️', titulo: 'Ministerio', vacio: 'Nada durmiendo en el Ministerio.', card: cardMinisterio, mas: 'socios' },
    { id: 'vinculados', emoji: '🌿', titulo: 'Vinculados', vacio: 'Sin candidatos al débito.', card: cardVinculado, mas: 'suscripciones' },
    { id: 'adheridos', emoji: '💳', titulo: 'Adheridos', vacio: 'Todavía nadie en débito.', card: cardAdherido, mas: 'suscripciones' },
  ]

  function columna(def, colData) {
    if (!colData) return '' // el rol no ve esta columna
    const visibles = visiblesDe(def.id, colData)
    const filtrado = verFrios || hayFiltro()
    // sin filtros manda el total real del server; filtrando, lo que se ve
    const n = filtrado ? visibles.length : colData.total
    const base = verFrios ? (colData.frios ? colData.frios.items : []) : colData.items
    const vacioTxt = base.length ? 'Nada pasa este filtro.' : (verFrios ? 'Sin fríos acá.' : def.vacio)
    const deMas = (!filtrado && colData.total > colData.items.length) ? colData.total - colData.items.length : 0
    return `<section class="ik-col" data-col="${def.id}">
      <header class="ik-col-h"><span>${def.emoji} ${def.titulo}</span><b class="ik-n">${n}</b></header>
      <div class="ik-cards">
        ${visibles.length ? visibles.map(def.card).join('') : `<div class="ik-vacio">${vacioTxt}</div>`}
        ${deMas > 0 ? `<button class="ik-mas" type="button" data-mas="${def.mas}">+${deMas} más</button>` : ''}
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
      ${k ? `${barraFiltros(k)}<div class="ik-board${verFrios ? ' ik-modo-frios' : ''}">${COLS.map((c) => columna(c, k[c.id])).join('')}</div>` : ''}`
  }

  // ---------- frío / revivir ----------
  // Optimista con confirmación del server: se manda el PATCH, y recién con
  // el ok se saca la card de su lista local y se repinta (contadores incl.).
  function sacarDeKanban(esLead, id) {
    const k = datos && datos.kanban
    if (!k) return null
    for (const def of COLS) {
      const cd = k[def.id]
      if (!cd) continue
      if (esLead !== (def.id === 'leads')) continue
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

  // navegación al tablero de leads (mismo truco que los tiles con data-filtro)
  function irALeads() {
    try {
      const nav = JSON.parse(sessionStorage.getItem('so-nav') || '{}')
      nav.sub = 'leads'
      sessionStorage.setItem('so-nav', JSON.stringify(nav))
    } catch { /* nada */ }
    P.ir('socios')
  }

  P.registrar('inicio', {
    init(c) {
      cont = c
      recargar()

      // refresco: al volver el foco a la pestaña, sin polling agresivo
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && cont.classList.contains('on')) recargar()
      })

      cont.addEventListener('click', (e) => {
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
        // frío / revivir (antes que el click de la card)
        const bf = e.target.closest('.ik-frio, .ik-revivir')
        if (bf) { e.stopPropagation(); accionFrio(bf); return }
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
        const mas = e.target.closest('.ik-mas')
        if (mas) {
          const destino = mas.dataset.mas
          if (destino === 'leads') return irALeads()
          if (destino === 'suscripciones' && !P.puede('mp_gestionar')) return P.ir('socios')
          return P.ir(destino)
        }
        // card de lead → tablero de leads
        if (e.target.closest('.ik-card[data-lead]')) return irALeads()
        // card de socio → ficha 360° en la solapa que toca
        const card = e.target.closest('.ik-card[data-socio]')
        if (card && window.PanelSocioDetalle) {
          return window.PanelSocioDetalle.abrir(Number(card.dataset.socio), () => recargar(), card.dataset.tab)
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
