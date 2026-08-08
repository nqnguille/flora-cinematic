/* Módulo Inicio (prefijo ik-): la fila HOY compacta + el kanban del viaje
   del socio. Sin drag & drop a propósito: la etapa se DERIVA de los datos
   y avanza con acciones reales (cargar código, verificar firma, mandar
   link), no arrastrando tarjetas. */
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
    cargado: 'Espera su firma',
    observado: 'Resolver su observación',
    a_vincular: 'Vincularlo a Flora',
    en_evaluacion: 'Espera al Ministerio',
    revision_medica: 'Volvió al médico',
    revisar: 'Confirmar en qué anda',
    vencido: 'Renovar el certificado',
    rechazado: 'Revisar el rechazo',
  }
  const NOMBRE_ETAPA_LEAD = { nuevo: 'nuevo', contactado: 'contactado', entrevista: 'entrevista' }

  const dosPalabras = (n) => String(n || '—').trim().split(/\s+/).slice(0, 2).join(' ')
  const hace = (iso) => {
    const t = Date.parse(String(iso || '').replace(' ', 'T') + (String(iso || '').includes('T') ? '' : 'Z'))
    if (!Number.isFinite(t)) return ''
    const dias = Math.floor((Date.now() - t) / 86400000)
    return dias <= 0 ? 'hoy' : dias === 1 ? 'hace 1 día' : `hace ${dias} días`
  }
  const avatar = (n) => `<span class="av">${P.esc(P.iniciales ? P.iniciales(n) : '?')}</span>`

  let cont = null
  let cargando = false

  async function recargar() {
    if (!cont || cargando) return
    cargando = true
    try {
      const r = await fetch('/api/panel/inicio', { credentials: 'include' })
      if (!r.ok) throw new Error('El servidor respondió ' + r.status)
      pintar(await r.json())
    } catch (err) {
      cont.innerHTML = `<div class="vacio">${P.esc(err.message)}</div>`
    }
    cargando = false
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

  // ---------- cards del kanban ----------
  function cardLead(l) {
    const rc = l.reprocann
    const partes = []
    if (rc && rc.modalidad) partes.push(rc.modalidad)
    if (rc && rc.plantas !== undefined && rc.plantas !== null) partes.push(`${rc.plantas} plantas`)
    return `<div class="ik-card ik-lead" data-lead="${l.id}">
      ${avatar(l.nombre || l.email)}
      <div class="ik-c-body">
        <b>${P.esc(dosPalabras(l.nombre || l.email || '(sin nombre)'))}</b>
        <div class="ik-sub">${P.esc(hace(l.creado))} · ${P.esc(NOMBRE_ETAPA_LEAD[l.etapa] || l.etapa)}${l.tiene_adjunto ? ' · 📎' : ''}</div>
        ${rc ? `<div class="ik-chips"><span class="tag tag-ok">🌱 REPROCANN ✓${partes.length ? ' ' + P.esc(partes.join(' · ')) : ''}</span></div>` : ''}
      </div>
    </div>`
  }

  function cardTramite(s) {
    const q = s.quien === 'club' ? 'club' : s.quien === 'paciente' ? 'paciente' : s.quien === 'medico' ? 'medico' : 'org'
    const alerta = s.vence_dias !== null && s.vence_dias !== undefined && s.vence_dias < 45
    return `<div class="ik-card ik-q-${q}" data-socio="${s.id}" data-tab="tramite">
      ${avatar(s.nombre)}
      <div class="ik-c-body">
        <b>${P.esc(dosPalabras(s.nombre))}${alerta ? ` <span class="tag tag-mal" data-tip="El certificado vence el ${fFecha(s.vence)}">⚠ ${s.vence_dias < 0 ? 'vencido' : 'vence en ' + s.vence_dias + ' d'}</span>` : ''}</b>
        <div class="ik-sub">${s.actualizado ? P.esc(hace(s.actualizado)) + ' en este paso' : 'sin movimientos'}</div>
        <div class="ik-chips"><span class="ik-chip ik-chip-${q}">${P.esc(ACCION_TRAMITE[s.estado] || s.estado)}</span></div>
      </div>
    </div>`
  }

  function cardFirma(s) {
    const firmada = s.dec_estado === 'firmada'
    return `<div class="ik-card ${firmada ? 'ik-q-club' : 'ik-q-paciente'}" data-socio="${s.id}" data-tab="legal">
      ${avatar(s.nombre)}
      <div class="ik-c-body">
        <b>${P.esc(dosPalabras(s.nombre))}</b>
        <div class="ik-sub">${firmada
          ? `firmó ${P.esc(s.dec_firmada ? hace(s.dec_firmada) : '')}`
          : `declaración generada ${P.esc(s.dec_generada ? hace(s.dec_generada) : '')}`}</div>
        <div class="ik-chips">${firmada
          ? '<span class="ik-chip ik-chip-club">📋 Verificar y habilitar</span>'
          : '<span class="ik-chip ik-chip-paciente">Esperando su firma</span>'}</div>
      </div>
    </div>`
  }

  function cardVinculado(s) {
    const memb = s.memb_tier ? `<span class="tag tag-off">${P.esc(s.memb_tier)}${s.memb_modalidad ? ' · ' + P.esc(s.memb_modalidad) : ''}</span>` : ''
    const chip = s.no_insistir
      ? '<span class="ik-chip ik-chip-off">no insistir</span>'
      : `<button class="ik-chip ik-chip-club ik-btn-debito" type="button"
           data-id="${s.id}" data-nombre="${P.esc(s.nombre)}" data-tel="${P.esc(s.telefono || '')}">💳 Mandar link 20%</button>`
    return `<div class="ik-card ${s.no_insistir ? 'ik-q-off' : 'ik-q-club'}" data-socio="${s.id}" data-tab="eco">
      ${avatar(s.nombre)}
      <div class="ik-c-body">
        <b>${P.esc(dosPalabras(s.nombre))}</b>
        <div class="ik-sub">${s.estado === 'conversion' ? 'vinculado por declaración' : 'REPROCANN aprobado'} ${memb}</div>
        <div class="ik-chips">${chip}</div>
      </div>
    </div>`
  }

  function cardAdherido(s) {
    const renovar = (s.racha_meses || 0) >= 2 || (s.fin_dias !== null && s.fin_dias !== undefined && s.fin_dias < 35)
    return `<div class="ik-card ${s.sus_estado === 'activa' ? 'ik-q-ok' : 'ik-q-paciente'}" data-socio="${s.id}" data-tab="eco">
      ${avatar(s.nombre)}
      <div class="ik-c-body">
        <b>${P.esc(dosPalabras(s.nombre))}${s.sus_estado === 'pendiente' ? ' <span class="tag tag-deb">esperando pago</span>' : ''}</b>
        <div class="ik-sub">${P.esc(s.tier || '—')} · cuota ${s.racha_meses || 0}/3${s.fin ? ` · renueva ${fFecha(s.fin)}` : ''}</div>
        ${renovar ? '<div class="ik-chips"><button class="ik-chip ik-chip-paciente ik-btn-renovar" type="button">↻ renovar</button></div>' : ''}
      </div>
    </div>`
  }

  // ---------- columnas ----------
  const COLS = [
    { id: 'leads', emoji: '📥', titulo: 'Leads', vacio: 'Nadie golpeando la puerta hoy.', card: cardLead, mas: 'leads' },
    { id: 'tramite', emoji: '📋', titulo: 'Trámite', vacio: 'Ningún trámite en el aire.', card: cardTramite, mas: 'socios' },
    { id: 'firmas', emoji: '✍️', titulo: 'Firmas', vacio: 'Nada esperando una firma.', card: cardFirma, mas: 'socios' },
    { id: 'vinculados', emoji: '🌿', titulo: 'Vinculados', vacio: 'Sin candidatos al débito.', card: cardVinculado, mas: 'suscripciones' },
    { id: 'adheridos', emoji: '💳', titulo: 'Adheridos', vacio: 'Todavía nadie en débito.', card: cardAdherido, mas: 'suscripciones' },
  ]

  function columna(def, datos) {
    if (!datos) return '' // el rol no ve esta columna
    const items = datos.items || []
    const deMas = datos.total - items.length
    return `<section class="ik-col" data-col="${def.id}">
      <header class="ik-col-h"><span>${def.emoji} ${def.titulo}</span><b class="ik-n">${datos.total}</b></header>
      <div class="ik-cards">
        ${items.length ? items.map(def.card).join('') : `<div class="ik-vacio">${def.vacio}</div>`}
        ${deMas > 0 ? `<button class="ik-mas" type="button" data-mas="${def.mas}">+${deMas} más</button>` : ''}
      </div>
    </section>`
  }

  function pintar(d) {
    // `capitalize` de CSS pone en mayúscula CADA palabra: quedaba
    // «Miércoles, 5 De Agosto». Va solo la primera letra.
    const hoyCrudo = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
    const hoyLindo = hoyCrudo.charAt(0).toUpperCase() + hoyCrudo.slice(1)
    const k = d.kanban
    cont.innerHTML = `
      <p style="color:var(--ink2);margin:0 0 12px">${P.esc(hoyLindo)}</p>
      ${filaHoy(d)}
      ${k ? `<div class="ik-board">${COLS.map((c) => columna(c, k[c.id])).join('')}</div>` : ''}`
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
