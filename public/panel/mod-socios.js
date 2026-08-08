/* Módulo Socios (prefijo so-): LA lista maestra del club — la ficha 360°.
   Fusión de los ex módulos Socios y REPROCANN (decisión 01/08): una fila por
   persona con membresía, débito, paso del trámite y acceso a la carta; el
   detalle vive en el drawer (mod-socio-detalle.js). El embudo sobrevive como
   tiles-filtro arriba de la lista. Sub-pestañas: Socios · Solicitudes ·
   Unificar (el volcado del portal, ex módulo REPROCANN). */
(() => {
  'use strict'
  const P = window.Panel
  // Usa el formateador del shell, con respaldo por si este módulo se cargó
  // antes que el shell nuevo (durante un deploy): una fecha fea es mejor que
  // el panel caído.
  const fFecha = (v) => (window.Panel && window.Panel.fecha)
    ? window.Panel.fecha(v)
    : (String(v || '').slice(0, 10).split('-').reverse().join('/') || '—')


  // Endpoints del acceso a la carta (KV, panel viejo) — los usa el alta
  // rápida, las solicitudes y el eco de teléfono/nota del drawer.
  const EP_SOCIOS = '/api/socios/admin/socios'
  const EP_INTENTOS = '/api/socios/admin/intentos'
  const EP_SOLICITUDES = '/api/socios/admin/solicitudes'

  let cont = null
  let editar = false          // capacidad padron_editar
  let SOLICITUDES = []        // formulario web + intentos de login, mezclados

  /* ---------- helpers ---------- */
  function errHttp(status) {
    if (status === 401) return 'Tu sesión venció — recargá la página y volvé a entrar.'
    if (status === 403) return 'Tu rol no tiene permiso para ver esto.'
    return 'El servidor respondió ' + status + '. Probá de nuevo en un rato.'
  }
  function fmtFecha(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  }
  // "hace 3 días" — el dato operativo es la distancia, no la fecha exacta
  function fmtRel(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const min = Math.floor((Date.now() - d.getTime()) / 60000)
    if (min < 1) return 'recién'
    if (min < 60) return `hace ${min} min`
    const h = Math.floor(min / 60)
    if (h < 24) return `hace ${h} h`
    const dias = Math.floor(h / 24)
    if (dias < 31) return `hace ${dias} día${dias > 1 ? 's' : ''}`
    const meses = Math.floor(dias / 30)
    return `hace ${meses} mes${meses > 1 ? 'es' : ''}`
  }
  // wa.me solo acepta dígitos: "+54 9 299 456-7890" → "5492994567890"
  const digitsOnly = (v) => String(v || '').replace(/\D/g, '')
  const ICON_WA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.4 1.3 4.9L2 22l5.3-1.4c1.4.8 3 1.2 4.7 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3.1.8.8-3-.2-.3C4 13.8 3.5 12.4 3.5 12 3.5 7.3 7.3 3.5 12 3.5S20.5 7.3 20.5 12 16.7 20.2 12 20.2zm4.5-5.8c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1.1 2.8 1.2 3c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3z"/></svg>'

  // Credencial REPROCANN: una tarjeta con foto, que es lo que la persona
  // manda. Y la declaración jurada: una hoja firmada. Se leen distinto de un
  // vistazo, que es todo lo que se les pide.
  const ICON_CARNET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5 16.5c.6-1.6 2-2.4 3.5-2.4s2.9.8 3.5 2.4"/><path d="M15 10h4M15 13.5h4"/></svg>'
  const ICON_FIRMA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2.5h8.5L19 7v8"/><path d="M6 2.5A1.5 1.5 0 0 0 4.5 4v12"/><path d="M14 2.5V7h5"/><path d="M4 20c1.6 0 1.9-2.7 3.2-2.7 1 0 1 1.6 2 1.6 1.2 0 1.4-3.2 2.8-3.2 1.1 0 1.1 2.2 2.2 2.2.9 0 1.2-1.3 2-1.3.6 0 .9.6 1.4.9"/></svg>'

  // feedback inline del padrón (al lado del buscador)
  let msgT = null
  function aviso(texto, clase, ms) {
    const el = cont.querySelector('#so-msg')
    if (!el) return
    el.className = 'msg' + (clase ? ' ' + clase : '')
    el.textContent = texto
    clearTimeout(msgT)
    if (texto) msgT = setTimeout(() => { el.textContent = ''; el.className = 'msg' }, ms || 6000)
  }
  let solMsgT = null
  function avisoSol(texto, clase, ms) {
    const el = cont.querySelector('#so-sol-msg')
    if (!el) return
    el.className = 'msg' + (clase ? ' ' + clase : '')
    el.textContent = texto
    clearTimeout(solMsgT)
    if (texto) solMsgT = setTimeout(() => { el.textContent = ''; el.className = 'msg' }, ms || 6000)
  }

  /* ---------- acceso a la carta (KV): alta rápida y solicitudes ---------- */
  // POST compartido: alta rápida, nota, teléfono, temporal. El shape del body
  // es el del panel viejo: { email, nota?, telefono?, name?, temporal? }.
  async function saveSocio(email, nota, extra) {
    try {
      const res = await fetch(EP_SOCIOS, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, nota, ...(extra || {}) }),
      })
      const data = await res.json().catch(() => ({}))
      return { ok: res.ok && data.ok !== false, error: data.error || (res.ok ? '' : errHttp(res.status)), mailEnviado: data.mailEnviado, mailError: data.mailError }
    } catch {
      return { ok: false, error: 'sin conexión' }
    }
  }

  function tempTag(s) {
    if (!s.temporal) return ''
    const dur = Number(s.tempDias) >= 1 ? (Number(s.tempDias) === 1 ? '24hs' : Number(s.tempDias) + ' días') : '24hs'
    if (!s.tempExpiraEn) return ` <span class="tag tag-deb" title="Los ${dur} corren desde su primer ingreso">Prueba sin usar</span>`
    const ms = new Date(s.tempExpiraEn).getTime() - Date.now()
    if (ms <= 0) return ` <span class="tag tag-mal" title="Venció ${P.esc(fmtFecha(s.tempExpiraEn))}">Prueba vencida</span>`
    const h = Math.round(ms / 3600000)
    const queda = h >= 48 ? `${Math.round(h / 24)} días` : `${Math.max(1, h)}h`
    return ` <span class="tag tag-deb" title="Vence ${P.esc(fmtFecha(s.tempExpiraEn))}">Prueba · vence en ${queda}</span>`
  }
  function estadoHtml(s) {
    const base = s.lastLogin
      ? `<span class="tag tag-ok" title="Último ingreso: ${P.esc(fmtFecha(s.lastLogin))}">Activo ${P.esc(fmtRel(s.lastLogin))}</span>`
      : '<span class="tag tag-off">Sin ingresar</span>'
    return base + tempTag(s)
  }


  /* ============ Lista maestra (mu-): una fila por persona ============ */
  let MU = { socios: [], pasos: [], sugerencias: [], sugerenciasCarta: [] }
  let muFiltro = ''           // '' | quien | porVencer | sinDebito | debeMes | noInsistir | sinIngresar | sinAcceso | activos30
  let muQ = ''
  let muCargado = false
  // F5 vuelve exactamente adonde estabas (regla de la casa)
  let muAgrupar = false
  try {
    const nav = JSON.parse(sessionStorage.getItem('so-nav') || '{}')
    muFiltro = nav.filtro || ''
    muQ = nav.q || ''
    muAgrupar = !!nav.agrupar
  } catch { /* nada */ }
  const guardarNav = (sub) => {
    try {
      const nav = JSON.parse(sessionStorage.getItem('so-nav') || '{}')
      sessionStorage.setItem('so-nav', JSON.stringify({ filtro: muFiltro, q: muQ, agrupar: muAgrupar, sub: sub || nav.sub || 'maestra' }))
    } catch { /* nada */ }
  }
  const mesActual = () => new Date().toISOString().slice(0, 7)
  const debeElMes = (s) => !!s.tier && s.modalidad !== 'plan' && s.debito_estado !== 'activa'
    && (!s.ultimo_pago || String(s.ultimo_pago).slice(0, 7) !== mesActual())

  // El score de vida: decide quién va arriba y quién duerme plegado.
  function muScore(s) {
    if (s.sinFicha) return -1
    if (s.papelera) return -2
    let p = 0
    if (s.tier) p += 4
    const dRet = s.ultimo_retiro ? (Date.now() - Date.parse(s.ultimo_retiro)) / 86400000 : 9999
    if (dRet < 45) p += 3
    else if (dRet < 120) p += 1
    if (['activa', 'pendiente'].includes(s.debito_estado)) p += 2
    if (['club', 'paciente', 'medico'].includes(s.quien)) p += 2
    if (s.por_vencer) p += 2
    if (s.carta && s.carta.lastLogin && Date.now() - Date.parse(s.carta.lastLogin) < 30 * 86400000) p += 1
    return p
  }

  const QUIEN_TAG = {
    club: ['Nos toca', 'tag-mal'], paciente: ['Le toca al paciente', 'tag-deb'],
    medico: ['Le toca a Ezequiel', 'tag-auto'], organismo: ['Ministerio', 'tag-off'],
  }

  function muPasa(s) {
    if (s.papelera) return muFiltro === 'papelera'
    if (muFiltro === 'papelera') return false
    if (!muFiltro) return true
    if (muFiltro === 'accionables') return ['club', 'paciente', 'medico'].includes(s.quien)
    if (['club', 'paciente', 'medico', 'organismo'].includes(muFiltro)) return s.quien === muFiltro
    if (muFiltro === 'porVencer') return !!s.por_vencer
    if (muFiltro === 'sinDebito') return !!s.tier && !['activa', 'pendiente'].includes(s.debito_estado) && !s.debito_no_insistir
    if (muFiltro === 'debeMes') return debeElMes(s)
    if (muFiltro.startsWith('paso:')) return s.reprocann_estado === muFiltro.slice(5)
    if (muFiltro === 'noInsistir') return !!s.debito_no_insistir
    if (muFiltro === 'sinIngresar') return s.carta && !s.carta.lastLogin
    if (muFiltro === 'sinAcceso') return !s.carta && !s.sinFicha
    if (muFiltro === 'activos30') return s.carta && s.carta.lastLogin && Date.now() - Date.parse(s.carta.lastLogin) < 30 * 86400000
    return true
  }

  // Presupuesto de color: la única pill saturada de la fila es la que pide
  // acción. Lo normal ×100 va en texto gris — el ojo vuelve a ver el ámbar.
  function muChipReprocann(s) {
    if (s.sinFicha) return '<span style="color:var(--muted);font-size:12px">—</span>'
    if (s.reprocann_estado === 'aprobado' || s.reprocann_estado === 'autocultivo') {
      const vence = s.por_vencer ? ' <span class="tag tag-mal" title="El certificado vence en menos de 60 días">⚠ vence</span>' : ''
      return `<span style="color:var(--ink2);font-size:13px" title="${P.esc(s.paso_ayuda || '')}"><i style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--grn);margin-right:5px"></i>${P.esc(s.paso_nombre)}</span>${vence}`
    }
    const cls = s.quien === 'club' ? 'tag-mal' : s.quien === 'paciente' ? 'tag-deb'
      : s.quien === 'medico' ? 'tag-auto' : 'tag-off'
    return `<span class="tag ${cls}" title="${P.esc(s.paso_ayuda || '')}">${P.esc(s.paso_nombre)}</span>`
  }

  // Membresía y débito en UNA columna: pill del tier + segunda línea con la
  // historia de pago (el dato operativo que faltaba).
  function muCeldaMembresia(s) {
    if (s.sinFicha) return '<span class="tag tag-deb" title="Entra a la carta pero no tiene ficha en el padrón">solo carta</span>'
    if (!s.tier) return '<span style="color:var(--muted)">—</span>'
    const pill = `<span class="tag ${s.modalidad === 'plan' ? 'tag-auto' : ''}">${P.esc(s.tier)}${s.modalidad === 'plan' ? ' · plan' : ''}</span>`
    let linea = ''
    if (s.modalidad === 'plan') linea = ''
    else if (s.debito_estado === 'activa') linea = '<span style="color:var(--grn)">débito al día</span>'
    else if (s.debito_estado === 'pendiente') linea = 'débito esperando autorización'
    else if (s.debito_estado === 'pausada') linea = '<span style="color:var(--dan)">débito pausado</span>'
    else if (debeElMes(s)) linea = `<span style="color:var(--amb);font-weight:600">sin pago este mes</span>${s.ultimo_pago ? ' · pagó ' + fmtRel(s.ultimo_pago) : ''}`
    else if (s.ultimo_pago) linea = 'pagó ' + fmtRel(s.ultimo_pago)
    else if (s.debito_no_insistir) linea = 'no insistir con débito'
    return `${pill}${linea ? `<div style="color:var(--muted);font-size:11px;margin-top:2px">${linea}</div>` : ''}`
  }

  function muChipCarta(s) {
    if (!s.carta) {
      // "sin acceso" solo grita si la persona está viva (paga o retira)
      if (s.sinFicha) return '—'
      const vivo = s.tier || (s.ultimo_retiro && Date.now() - Date.parse(s.ultimo_retiro) < 90 * 86400000)
      return vivo ? '<span class="tag tag-deb" title="Tiene ficha pero no puede entrar a la carta">sin acceso</span>'
        : '<span style="color:var(--muted);font-size:12px">—</span>'
    }
    const base = s.carta.lastLogin
      ? `<span style="color:var(--ink2);font-size:12px" title="Último ingreso: ${P.esc(fmtFecha(s.carta.lastLogin))}">carta ${P.esc(fmtRel(s.carta.lastLogin))}</span>`
      : '<span style="color:var(--muted);font-size:12px">sin ingresar</span>'
    return base + tempTag(s.carta)
  }

  async function muCargar(forzar) {
    if (muCargado && !forzar) { muRender(); return }
    const caja = cont.querySelector('#mu-lista')
    if (!MU.socios.length) caja.innerHTML = '<div class="vacio">⏳ Cargando el padrón…</div>'
    const r = await fetch('/api/panel/padron/maestra', { credentials: 'include' })
    if (!r.ok) { caja.innerHTML = `<div class="vacio">${P.esc(errHttp(r.status))}</div>`; return }
    MU = await r.json()
    MU.socios.forEach((x) => { x._score = muScore(x) })
    MU.socios.sort((a, b) => (b._score - a._score)
      || (Date.parse(b.ultimo_retiro || 0) || 0) - (Date.parse(a.ultimo_retiro || 0) || 0)
      || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'))
    window.PanelPasosReprocann = MU.pasos   // lo usa el drawer para el timeline
    muCargado = true
    muRender()
  }

  function muFila(s, conCheck) {
    const puedeLink = P.puede('mp_enviar') && s.id && !s.papelera && s.tier && !['activa', 'pendiente'].includes(s.debito_estado)
      && !s.debito_no_insistir && ['aprobado', 'en_evaluacion'].includes(s.reprocann_estado)
    if (s.papelera) {
      return `
      <tr class="mu-fila" data-id="${s.id}" style="cursor:pointer;opacity:.75">
        <td><div class="fila"><span class="av">${P.esc(P.iniciales(s.nombre || '?'))}</span>
          <div><div style="font-weight:600">${P.esc(s.nombre)}</div>
          <div style="color:var(--muted);font-size:11px">en la papelera desde ${fFecha(s.papelera)}</div></div></div></td>
        <td colspan="4" style="color:var(--muted);font-size:12px">${s.tier ? P.esc(s.tier) + ' · ' : ''}${P.esc(s.paso_nombre || '')}${s.nota ? ' · ' + P.esc(String(s.nota).slice(0, 60)) : ''}</td>
        <td class="r" style="white-space:nowrap">
          ${P.puede('papelera_gestionar') ? `<button class="btn mu-restaurar" data-id="${s.id}" type="button">Restaurar</button>` : ''}
          ${P.puede('papelera_purgar') ? `<button class="btn btn-peligro mu-purgar" data-id="${s.id}" data-nombre="${P.esc(s.nombre)}" type="button">Borrar</button>` : ''}
        </td>
      </tr>`
    }
    return `
      <tr class="mu-fila" data-id="${s.id || ''}" data-email="${P.esc(s.email || '')}" style="cursor:${s.id ? 'pointer' : 'default'}">
        ${conCheck ? `<td style="width:30px"><input type="checkbox" class="mu-check" data-id="${s.id}" onclick="event.stopPropagation()" /></td>` : ''}
        <td><div class="fila"><span class="av">${P.esc(P.iniciales(s.nombre || s.email || '?'))}</span>
          <div><div style="font-weight:600">${P.esc(s.nombre || '(sin nombre)')}</div>
          ${s.email ? `<div style="color:var(--muted);font-size:11px">${P.esc(s.email)}</div>`
            : (s.tier ? '<div style="color:var(--amb);font-size:11px">sin email — el débito lo necesita</div>' : '')}</div></div></td>
        <td>${muCeldaMembresia(s)}</td>
        <td>${muChipReprocann(s)}</td>
        <td>${muChipCarta(s)}</td>
        <td style="color:var(--muted);font-size:12px">${s.ultimo_retiro ? P.esc(fmtRel(s.ultimo_retiro)) : '—'}</td>
        <td class="r" style="white-space:nowrap">
          ${puedeLink ? `<button class="btn mu-mp" data-id="${s.id}" data-nombre="${P.esc(s.nombre)}" data-tel="${P.esc(s.telefono || '')}" title="Mandarle el link del débito" type="button">$</button>` : ''}
          ${s.sinFicha && editar ? `<button class="btn mu-crear" data-email="${P.esc(s.email)}" data-nombre="${P.esc(s.nombre || '')}" data-tel="${P.esc(s.telefono || '')}" data-nota="${P.esc(s.nota || '')}" type="button">Crear ficha</button>` : ''}
          ${s.telefono && s.id ? `<a class="so-wa mu-wa" target="_blank" rel="noopener" data-id="${s.id}" title="WhatsApp según su paso de REPROCANN"
            href="${P.esc(muWa(s))}">${ICON_WA}</a>` : ''}
        </td>
      </tr>`
  }

  function muTabla(lista, conCheck) {
    return `<div class="so-scroll"><table class="tabla"><thead><tr>
      ${conCheck ? '<th style="width:30px"><input type="checkbox" id="mu-check-all" title="Marcar todas" /></th>' : ''}
      <th>Socio</th><th>Membresía</th><th>REPROCANN</th><th>Carta</th><th>Últ. retiro</th><th class="r"></th>
    </tr></thead><tbody>${lista.map((x) => muFila(x, conCheck)).join('')}</tbody></table></div>`
  }

  function muRender() {
    const socios = MU.socios
    const vivos = socios.filter((s) => !s.papelera)
    const nosToca = vivos.filter((s) => s.quien === 'club').length
    const alPaciente = vivos.filter((s) => s.quien === 'paciente').length
    const alMedico = vivos.filter((s) => s.quien === 'medico').length
    const porVencer = vivos.filter((s) => s.por_vencer).length
    const deudores = vivos.filter(debeElMes).length

    cont.querySelector('#mu-tiles').innerHTML = `
      <div class="grid3" style="margin-bottom:10px">
        <div class="card mu-tile ${muFiltro === 'club' ? 'on' : ''}" data-f="club" style="border-left:3px solid var(--dan);cursor:pointer">
          <span class="k">Nos toca a nosotros</span><div class="kpi-v" style="font-size:28px;color:var(--dan)">${nosToca}</div>
          <div class="kpi-d">vincular como cultivadora o definir</div></div>
        <div class="card mu-tile ${muFiltro === 'paciente' ? 'on' : ''}" data-f="paciente" style="border-left:3px solid var(--amb);cursor:pointer">
          <span class="k">Le toca al paciente</span><div class="kpi-v" style="font-size:28px;color:var(--amb)">${alPaciente}</div>
          <div class="kpi-d">su código o su firma</div></div>
        <div class="card mu-tile ${muFiltro === 'debeMes' ? 'on' : ''}" data-f="debeMes" style="border-left:3px solid var(--amb);cursor:pointer">
          <span class="k">Deben el mes</span><div class="kpi-v" style="font-size:28px;color:var(--amb)">${deudores}</div>
          <div class="kpi-d">con membresía y sin pago del mes</div></div>
      </div>
      <div class="fila" style="margin-bottom:10px;flex-wrap:wrap;gap:10px">
        ${alMedico ? `<button class="chip mu-tile ${muFiltro === 'medico' ? 'on' : ''}" data-f="medico" type="button">Le toca a Ezequiel: <b>${alMedico}</b></button>` : ''}
        ${porVencer ? `<button class="chip mu-tile ${muFiltro === 'porVencer' ? 'on' : ''}" data-f="porVencer" type="button" style="border-color:var(--amb);color:var(--amb)">⚠ vencen en 60 días: <b>${porVencer}</b></button>` : ''}
      </div>`

    // cruces por confirmar: sugerencias de Google + huérfanos↔fichas por nombre
    const porId = Object.fromEntries(socios.filter((s) => s.id).map((s) => [s.id, s]))
    let vistosCarta = []
    try { vistosCarta = JSON.parse(sessionStorage.getItem('so-cruces-no') || '[]') } catch { /* nada */ }
    const cruces = (MU.sugerencias || []).map((g) => ({ tipo: 'google', ...g }))
      .concat((MU.sugerenciasCarta || []).filter((g) => !vistosCarta.includes(g.socio_id + ':' + g.email))
        .map((g) => ({ tipo: 'carta', ...g })))
    cont.querySelector('#mu-sugerencias').innerHTML = cruces.length && editar ? `
      <div class="card" style="margin-bottom:10px;border-left:3px solid var(--vio)">
        <span class="k">Cruces por confirmar (${cruces.length})</span>
        <p class="so-help">La misma persona parece estar dos veces: una ficha del padrón y un acceso a la carta.
        Confirmá y quedan unidas (el email pasa a la ficha).</p>
        ${cruces.map((g) => `<div class="fila" style="padding:7px 0;border-top:1px solid var(--line);flex-wrap:wrap">
          <span><b>${P.esc(g.email)}</b> <span style="color:var(--muted)">(${g.tipo === 'google' ? 'Google: ' + P.esc(g.nombre_google || '—') : 'carta: ' + P.esc(g.nombre_kv || '—')})</span>
          ¿es <b>${P.esc(g.tipo === 'google' ? ((porId[g.socio_id] || {}).nombre || '#' + g.socio_id) : g.nombre_socio)}</b>?
          ${g.confianza === 'parcial' ? '<span class="tag tag-deb">parecido</span>' : ''}</span>
          <span class="pn-sp"></span>
          <button class="btn ${g.tipo === 'google' ? 'mu-sug' : 'mu-sugcarta'}" data-id="${g.socio_id}" data-email="${P.esc(g.email)}" data-ok="1" type="button">Sí, es él</button>
          <button class="btn ${g.tipo === 'google' ? 'mu-sug' : 'mu-sugcarta'}" data-id="${g.socio_id}" data-email="${P.esc(g.email)}" data-ok="" type="button">No</button>
        </div>`).join('')}
      </div>` : ''

    const enPapelera = socios.filter((s) => s.papelera).length
    const CHIPS = [
      ['', 'Todos'], ['accionables', 'Hay algo que hacer'], ['organismo', 'Ministerio'],
      ['sinDebito', 'Sin débito'], ['noInsistir', 'No insistir'],
      ['sinIngresar', 'Sin ingresar'], ['sinAcceso', 'Sin acceso'], ['activos30', 'Activos 30d'],
    ]
    if (enPapelera) CHIPS.push(['papelera', `🗑 Papelera (${enPapelera})`])
    cont.querySelector('#mu-chips').innerHTML = CHIPS.map(([v, n]) =>
      `<button class="chip ${muFiltro === v ? 'on' : ''}" data-f="${v}" type="button">${n}</button>`).join('')

    // segunda fila: el embudo entero como chips — solo los pasos con gente,
    // en el orden del trámite, con su cuenta. Más el modo agrupado.
    const cuentaPaso = {}
    for (const x of vivos) cuentaPaso[x.reprocann_estado] = (cuentaPaso[x.reprocann_estado] || 0) + 1
    const QCOLOR = { club: 'var(--dan)', paciente: 'var(--amb)', medico: 'var(--vio)', organismo: 'var(--muted)' }
    const chipsRc = (MU.pasos || [])
      .filter((p) => cuentaPaso[p.id])
      .map((p) => `<button class="chip ${muFiltro === 'paso:' + p.id ? 'on' : ''}" data-f="paso:${p.id}" type="button" title="${P.esc(p.ayuda)}">
        <i style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${p.id === 'aprobado' || p.id === 'autocultivo' ? 'var(--grn)' : (QCOLOR[p.quien] || 'var(--muted)')};margin-right:5px;vertical-align:1px"></i>${P.esc(p.nombre)} <b>${cuentaPaso[p.id]}</b></button>`)
      .join('')
    const rc = cont.querySelector('#mu-chips-rc')
    if (rc) rc.innerHTML = `
      <span class="k" style="align-self:center;margin-right:2px">REPROCANN</span>${chipsRc}
      <span class="pn-sp"></span>
      <button class="chip ${muAgrupar ? 'on' : ''}" id="mu-agrupar" type="button" title="Ver la lista partida en secciones por estado del trámite">☰ Agrupar por estado</button>`

    let lista = socios.filter(muPasa)
    if (muQ) {
      lista = lista.filter((s) =>
        `${s.nombre || ''} ${s.email || ''} ${s.documento || ''} ${s.telefono || ''} ${s.nota || ''} ${s.reprocann_codigo || ''}`
          .toLowerCase().includes(muQ))
    }
    const caja = cont.querySelector('#mu-lista')
    if (!lista.length) {
      caja.innerHTML = '<div class="vacio">Nadie coincide con ese filtro.</div>'
    } else if (muAgrupar && muFiltro !== 'papelera') {
      // la lista entera partida por estado del trámite, en el orden del embudo
      const sinPapelera = lista.filter((x) => !x.papelera && !x.sinFicha)
      const QTAG = { club: ['Nos toca', 'tag-mal'], paciente: ['Le toca al paciente', 'tag-deb'], medico: ['Le toca a Ezequiel', 'tag-auto'], organismo: ['Ministerio', 'tag-off'] }
      caja.innerHTML = (MU.pasos || []).map((p) => {
        const grupo = sinPapelera.filter((x) => x.reprocann_estado === p.id)
        if (!grupo.length) return ''
        const [qtxt, qcls] = QTAG[p.quien] || ['', 'tag-ok']
        return `<div style="margin-bottom:14px">
          <div class="fila" style="margin-bottom:6px">
            <b style="font-size:13px">${P.esc(p.nombre)}</b>
            ${qtxt ? `<span class="tag ${qcls}">${qtxt}</span>` : '<span class="tag tag-ok">al día</span>'}
            <span style="color:var(--muted);font-size:12px">· ${grupo.length}</span>
            <span class="pn-sp"></span>
            <span style="color:var(--muted);font-size:11px">${P.esc(p.ayuda)}</span>
          </div>
          ${muTabla(grupo)}</div>`
      }).join('') || '<div class="vacio">Nadie coincide.</div>'
    } else if (muQ || muFiltro) {
      // buscando o filtrando: una sola tabla plana con todo lo que matchea
      caja.innerHTML = muTabla(lista)
    } else {
      // vista por defecto: los vivos arriba, lo demás plegado
      const activos = lista.filter((s) => !s.sinFicha && s._score >= 3)
      const dormidos = lista.filter((s) => !s.sinFicha && s._score < 3)
      const soloCarta = lista.filter((s) => s.sinFicha)
      caja.innerHTML = `
        ${activos.length ? muTabla(activos) : '<div class="vacio">Sin socios activos.</div>'}
        ${dormidos.length ? `<details style="margin-top:10px"><summary style="cursor:pointer;color:var(--muted);font-size:13px;font-weight:600">
          ${dormidos.length} ficha(s) dormida(s) — sin membresía ni retiros recientes</summary>
          ${P.puede('papelera_gestionar') ? `<div class="fila" style="margin:8px 0 0">
            <p class="so-help" style="margin:0">Para depurar el padrón del Excel: marcá las que no correspondan y mandalas a la papelera (siempre se pueden restaurar).</p>
            <span class="pn-sp"></span>
            <button class="btn mu-papelera-bulk" type="button">🗑 A la papelera (<span id="mu-sel-n">0</span>)</button></div>` : ''}
          <div style="margin-top:6px">${muTabla(dormidos, P.puede('papelera_gestionar'))}</div></details>` : ''}
        ${soloCarta.length ? `<details style="margin-top:10px"><summary style="cursor:pointer;color:var(--muted);font-size:13px;font-weight:600">
          ${soloCarta.length} con acceso a la carta y sin ficha</summary>
          <div style="margin-top:6px">${muTabla(soloCarta)}</div></details>` : ''}`
    }
    const total = cont.querySelector('#mu-total')
    if (total) total.textContent = `${lista.length} de ${socios.length}`
    guardarNav()
  }

  // WhatsApp contextual por paso (los textos viven también en el drawer)
  function muWa(s) {
    const nom = (s.nombre || '').split(' ')[0]
    const T = {
      esperando_codigo: `Hola ${nom}! Para arrancar tu REPROCANN necesitamos tu código de vinculación. Lo sacás de tu cuenta en Mi Argentina y lo cargás acá: https://floraong.ar/socios/reprocann/`,
      revisar: `Hola ${nom}! Estamos ordenando los trámites de REPROCANN del club. ¿Nos contás cómo está el tuyo? Si te falta cargarlo, es acá: https://floraong.ar/socios/reprocann/`,
      sin_iniciar: `Hola ${nom}! ¿Arrancamos tu REPROCANN? El primer paso es tu código de vinculación: https://floraong.ar/socios/reprocann/`,
      cargado: `Hola ${nom}! Tu trámite de REPROCANN ya está cargado. Falta un paso tuyo: entrá a reprocann.msal.gob.ar con tu Mi Argentina y aceptá el consentimiento. Con eso seguimos nosotros.`,
      observado: `Hola ${nom}! Tu trámite de REPROCANN tiene una observación. Entrá a reprocann.msal.gob.ar y fijate qué dice, así lo resolvemos.`,
      aprobado: `Hola ${nom}! Tu REPROCANN está aprobado 🌿`,
      vencido: `Hola ${nom}! Tu certificado de REPROCANN venció. Escribinos y arrancamos la renovación.`,
    }
    const txt = T[s.reprocann_estado] || `Hola ${nom}! Ya sos socio de Flora. Entrá a la carta del club con tu cuenta de Google (${s.email}): https://floraong.ar/socios/carta/`
    return `https://wa.me/${digitsOnly(s.telefono)}?text=${encodeURIComponent(txt)}`
  }

  /* ---------- solicitudes (formulario web + intentos de login) ---------- */
  function endpointDe(item) { return item && item.tipo === 'formulario' ? EP_SOLICITUDES : EP_INTENTOS }

  function filaSolicitud(i) {
    const badge = i.tipo === 'formulario'
      ? (i.intent === 'entrevista'
          ? '<span class="tag tag-deb">Quiere entrevista médica</span>'
          : '<span class="tag tag-ok">Dice tener REPROCANN</span>')
      : `<span class="tag tag-deb">${P.fmtN(i.attempts || 1)} intento${i.attempts === 1 ? '' : 's'} de ingreso</span>`
    const fecha = i.tipo === 'formulario'
      ? `Solicitud ${P.esc(fmtRel(i.creado))} · ${P.esc(fmtFecha(i.creado))}`
      : `Último intento ${P.esc(fmtRel(i.lastAttempt))} · ${P.esc(fmtFecha(i.lastAttempt))}`
    const tel = i.phone
      ? `<div class="so-sol-meta">Tel: <a href="https://wa.me/${P.esc(digitsOnly(i.phone))}" target="_blank" rel="noopener">${P.esc(i.phone)}</a></div>`
      : ''
    const adjunto = i.tieneAdjunto
      ? `<div class="so-sol-meta"><a href="/api/socios/admin/solicitud-adjunto?email=${encodeURIComponent(i.email)}" target="_blank" rel="noopener">Ver REPROCANN adjunto</a></div>`
      : ''
    const acciones = editar
      ? `<div class="so-sol-acts">
          <button class="btn btn-pri so-sol-add" data-email="${P.esc(i.email)}" type="button">Agregar como socio</button>
          <select class="sel so-sol-dias" data-email="${P.esc(i.email)}" title="Cuánto le dura el acceso de prueba" style="max-width:118px">
            <option value="1">por 24 horas</option>
            <option value="7" selected>por 7 días</option>
            <option value="30">por 30 días</option>
            <option value="60">por 60 días</option>
          </select>
          <button class="btn so-sol-temp" data-email="${P.esc(i.email)}" data-name="${P.esc(i.name || '')}" type="button">Dar acceso de prueba</button>
          <button class="btn btn-peligro so-sol-del" data-email="${P.esc(i.email)}" data-tipo="${P.esc(i.tipo)}" type="button">Descartar</button>
        </div>`
      : ''
    return `<div class="so-sol">
      <span class="av">${P.esc(P.iniciales(i.name || i.email))}</span>
      <div class="so-sol-main">
        <div class="fila" style="flex-wrap:wrap;gap:6px">
          <strong>${P.esc(i.name || '(sin nombre)')}</strong>${badge}
        </div>
        <div class="so-sol-mail">${P.esc(i.email)}</div>
        ${tel}${adjunto}
        <div class="so-sol-meta">${fecha}</div>
      </div>
      ${acciones}
    </div>`
  }

  function renderSolicitudes() {
    const el = cont.querySelector('#so-sol-lista')
    el.innerHTML = SOLICITUDES.length
      ? SOLICITUDES.map(filaSolicitud).join('')
      : '<div class="vacio">No hay solicitudes pendientes.</div>'
    // contador en el sub-tab
    const cnt = cont.querySelector('#so-sol-cnt')
    cnt.hidden = !SOLICITUDES.length
    cnt.textContent = SOLICITUDES.length || ''
  }

  async function cargarSolicitudes() {
    const el = cont.querySelector('#so-sol-lista')
    if (!SOLICITUDES.length) el.innerHTML = '<div class="vacio">⏳ Cargando…</div>'
    try {
      const [resInt, resSol] = await Promise.all([
        fetch(EP_INTENTOS, { credentials: 'include' }),
        fetch(EP_SOLICITUDES, { credentials: 'include' }),
      ])
      const [dataInt, dataSol] = await Promise.all([
        resInt.json().catch(() => ({})),
        resSol.json().catch(() => ({})),
      ])
      if (!resInt.ok && !resSol.ok) { el.innerHTML = `<div class="vacio">${P.esc(errHttp(resInt.status))}</div>`; return }
      const intentos = (resInt.ok && dataInt.ok) ? (dataInt.intentos || []).map((i) => ({ ...i, tipo: 'intento' })) : []
      const solicitudes = (resSol.ok && dataSol.ok) ? (dataSol.solicitudes || []).map((s) => ({ ...s, tipo: 'formulario' })) : []
      SOLICITUDES = [...solicitudes, ...intentos].sort((a, b) => {
        const fa = a.tipo === 'formulario' ? a.creado : a.lastAttempt
        const fb = b.tipo === 'formulario' ? b.creado : b.lastAttempt
        return String(fb || '').localeCompare(String(fa || ''))
      })
      renderSolicitudes()
    } catch {
      el.innerHTML = '<div class="vacio">Error de red al cargar las solicitudes.</div>'
    }
  }

  // `conservarAdjunto`: la sacamos de la lista porque entró (alta o acceso de
  // prueba), así que su REPROCANN adjunto tiene que sobrevivir — es el papel
  // con el que después verificamos la modalidad y armamos el legajo. Sin el
  // flag (descarte de verdad) el archivo se borra, que es lo que corresponde
  // con los datos de alguien que no entró.
  async function descartarSolicitud(email, item, conservarAdjunto) {
    await fetch(endpointDe(item), {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, conservar_adjunto: conservarAdjunto === true }),
    })
  }


  // Acciones de la pestaña Solicitudes (delegadas desde el listener del módulo)
  async function onClick(e) {
    const add = e.target.closest('.so-sol-add')
    if (add) {
      const email = add.dataset.email
      const item = SOLICITUDES.find((i) => i.email === email)
      const notaBase = item && item.tipo === 'formulario'
        ? (item.intent === 'entrevista' ? 'Solicitud web · entrevista médica' : 'Solicitud web · ya tiene REPROCANN') + (item.phone ? ' · ' + item.phone : '')
        : 'Vía intento de acceso'
      add.disabled = true
      add.textContent = 'Agregando…'
      const { ok, error } = await saveSocio(email, notaBase)
      if (ok) {
        await descartarSolicitud(email, item, true)
        avisoSol('✔ agregado al padrón', 'ok')
        muCargar(true); cargarSolicitudes()
      } else {
        add.disabled = false
        add.textContent = 'Agregar como socio'
        avisoSol(`✗ ${error || 'no se pudo agregar'} — probá de nuevo`, 'err')
      }
      return
    }
    const temp = e.target.closest('.so-sol-temp')
    if (temp) {
      const email = temp.dataset.email
      const name = temp.dataset.name || ''
      const item = SOLICITUDES.find((i) => i.email === email)
      const selDias = temp.parentElement?.querySelector('.so-sol-dias')
      const dias = Number(selDias?.value) || 1
      const cuanto = dias === 1 ? '24 horas' : `${dias} días`
      if (!(await P.confirmar(`¿Darle a ${name || email} acceso de prueba a la carta por ${cuanto}? Le llega un mail avisándole que ya puede entrar. El reloj arranca en su primer ingreso.`, 'Sí, dar acceso'))) return
      temp.disabled = true
      temp.textContent = 'Dando acceso…'
      const { ok, error, mailEnviado, mailError } = await saveSocio(email, `Acceso de prueba (${cuanto} desde el primer login)`, { name, temporal: true, temporal_dias: dias })
      if (ok) {
        await descartarSolicitud(email, item, true)
        muCargar(true); cargarSolicitudes()
        if (mailEnviado === false) {
          avisoSol(`Se aprobó, pero el mail NO salió (${mailError || 'error desconocido'}) — avisale vos por WhatsApp.`, 'err', 12000)
        } else {
          avisoSol('✔ acceso temporal aprobado y mail enviado', 'ok')
        }
      } else {
        temp.disabled = false
        temp.textContent = 'Dar acceso de prueba'
        avisoSol(`✗ ${error || 'no se pudo aprobar'} — probá de nuevo`, 'err')
      }
      return
    }
    const desc = e.target.closest('.so-sol-del')
    if (desc) {
      const email = desc.dataset.email
      const item = SOLICITUDES.find((i) => i.email === email)
      if (!(await P.confirmar(`¿Descartar la solicitud de ${email}?`, 'Sí, descartar'))) return
      await descartarSolicitud(email, item)
      cargarSolicitudes()
    }
  }

  async function onAlta(e) {
    e.preventDefault()
    const emailEl = cont.querySelector('#so-alta-email')
    const notaEl = cont.querySelector('#so-alta-nota')
    const msg = cont.querySelector('#so-alta-msg')
    const email = emailEl.value.trim().toLowerCase()
    if (!email) return
    msg.className = 'msg'; msg.textContent = '⏳ guardando…'
    const { ok, error } = await saveSocio(email, notaEl.value.trim())
    msg.className = 'msg ' + (ok ? 'ok' : 'err')
    msg.textContent = ok ? '✔ socio agregado' : `✗ ${error || 'no se pudo agregar'} — probá de nuevo`
    if (ok) { emailEl.value = ''; notaEl.value = ''; muCargar(true) }
    setTimeout(() => { msg.textContent = ''; msg.className = 'msg' }, 6000)
  }


  /* ---------- registro ---------- */
  // ============ Alta unificada (al-): un socio, de una sola vez ============
  // Crea acceso a la carta (KV) + ficha financiera (D1) + membresía, con
  // precarga desde la solicitud web y cobro opcional en el mismo acto.
  const ALTA_PASOS = ['Quién es', 'Membresía', 'Listo']

  // Hooks de recarga para el kanban de Inicio: cuando el alta completa o la
  // conversión salen desde una card de lead, al terminar avisan para que el
  // tablero se refresque (los setea window.PanelLeads).
  let altaCb = null
  let cvCb = null

  function altaAbrir() {
    let paso = 1
    let tarifas = []
    let datos = { email: '', nombre: '', telefono: '', documento: '', reprocann_estado: 'esperando_codigo', reprocann_codigo: '', reprocann_vence: '', nota: '', tier: 'NINGUNA' }
    // Precarga desde "Unificar pacientes" (módulo REPROCANN): nombre y DNI
    // oficiales del portal. Al nacer con documento, el socio queda enganchado
    // a la sincronización del próximo volcado.
    try {
      const pre = JSON.parse(sessionStorage.getItem('so-alta-prefill') || 'null')
      sessionStorage.removeItem('so-alta-prefill')
      if (pre) Object.assign(datos, pre)
    } catch { /* precarga rota: alta vacía normal */ }

    const ov = P.modal('Socio nuevo', '<div id="al-cuerpo"></div>')
    const cuerpo = ov.querySelector('#al-cuerpo')

    const pasosHtml = () => `<div class="al-pasos">${ALTA_PASOS.map((n, i) =>
      `<span class="${i + 1 === paso ? 'on' : i + 1 < paso ? 'ok' : ''}">${i + 1}. ${n}</span>`).join('')}</div>`

    function pintar1() {
      cuerpo.innerHTML = `${pasosHtml()}
        <div style="display:grid;gap:10px">
          <div><label class="lb" for="al-email">Email de Google</label>
            <input class="input" id="al-email" type="email" value="${P.esc(datos.email)}"
              placeholder="socio@gmail.com" autocomplete="off" />
            <p class="so-help" id="al-precarga" style="margin:6px 0 0"></p></div>
          <div class="grid2">
            <div><label class="lb" for="al-nombre">Nombre y apellido</label>
              <input class="input" id="al-nombre" value="${P.esc(datos.nombre)}" /></div>
            <div><label class="lb" for="al-tel">Teléfono</label>
              <input class="input" id="al-tel" type="tel" value="${P.esc(datos.telefono)}" placeholder="+54 9 299…" /></div>
          </div>
          <div><label class="lb" for="al-dni">DNI</label>
            <input class="input" id="al-dni" inputmode="numeric" maxlength="10" value="${P.esc(datos.documento)}" placeholder="sin puntos" style="max-width:180px" />
            <p class="so-help" style="margin:6px 0 0">Lo pide el trámite de REPROCANN y es lo que une su ficha con la del médico.</p></div>
          <div><label class="lb" for="al-repro">¿Cómo está su REPROCANN?</label>
            <select class="sel" id="al-repro">
              <option value="esperando_codigo">Todavía no lo tiene — se lo gestionamos</option>
              <option value="codigo_listo">Ya me pasó su código de vinculación</option>
              <option value="cargado">Trámite ya cargado por el médico</option>
              <option value="en_evaluacion">En evaluación del Ministerio</option>
              <option value="aprobado">Ya lo tiene aprobado y vigente</option>
              <option value="autocultivo">Es autocultivador</option>
            </select></div>
          <div id="al-repro-extra"></div>
          <div><label class="lb" for="al-nota">Nota</label>
            <input class="input" id="al-nota" value="${P.esc(datos.nota)}" placeholder="Referido por…" /></div>
          <div class="fila"><span class="pn-sp"></span>
            <button class="btn btn-pri" id="al-sig1" type="button">Seguir →</button></div>
        </div>`
      const inputRepro = cuerpo.querySelector('#al-repro')
      inputRepro.value = datos.reprocann_estado || 'esperando_codigo'
      // El código de vinculación (13 caracteres) es lo que destraba el trámite:
      // pedirlo acá evita el ida y vuelta por WhatsApp.
      const pintarExtra = () => {
        const e = inputRepro.value
        const box = cuerpo.querySelector('#al-repro-extra')
        if (e === 'codigo_listo' || e === 'cargado' || e === 'en_evaluacion') {
          box.innerHTML = `<label class="lb" for="al-cod">Código de vinculación</label>
            <input class="input" id="al-cod" maxlength="13" value="${P.esc(datos.reprocann_codigo)}"
              placeholder="13 caracteres, se lo da su cuenta de Mi Argentina" style="letter-spacing:.08em" />
            <p class="so-help" style="margin:6px 0 0">Si todavía no te lo pasó, dejalo vacío: al terminar te damos el link para pedírselo.</p>`
        } else if (e === 'aprobado') {
          box.innerHTML = `<div class="grid2">
            <div><label class="lb" for="al-cod">Código de vinculación</label>
              <input class="input" id="al-cod" maxlength="13" value="${P.esc(datos.reprocann_codigo)}" placeholder="opcional" style="letter-spacing:.08em" /></div>
            <div><label class="lb" for="al-vence">Vence</label>
              <input class="input" id="al-vence" type="date" value="${P.esc(datos.reprocann_vence)}" /></div>
          </div>`
        } else if (e === 'autocultivo') {
          // Viene con credencial propia: para vincularse a Flora tiene que
          // renunciar al autocultivo (las modalidades son excluyentes), y eso
          // se firma. Pedimos acá lo único que falta para armar el papel, así
          // sale junto con el alta y no hay que volver después.
          box.innerHTML = `<div class="card" style="box-shadow:none;background:var(--card2);padding:12px 14px">
            <b style="font-size:13px">Se quiere pasar a Flora</b>
            <p class="so-help" style="margin:4px 0 10px">Para vincularse tiene que renunciar al autocultivo: no se pueden
              tener las dos modalidades a la vez. Completá esto y al terminar el alta te sale la declaración jurada
              lista para mandarle.</p>
            <div class="grid2" style="gap:10px">
              <div><label class="lb" for="al-dom">Domicilio</label>
                <input class="input" id="al-dom" value="${P.esc(datos.domicilio || '')}" placeholder="Calle y número" /></div>
              <div><label class="lb" for="al-vence">Vence su credencial</label>
                <input class="input" id="al-vence" type="date" value="${P.esc(datos.reprocann_vence)}" /></div>
            </div>
            <div class="grid2" style="gap:10px;margin-top:10px">
              <div><label class="lb" for="al-loc">Localidad</label>
                <input class="input" id="al-loc" value="${P.esc(datos.localidad || '')}" /></div>
              <div><label class="lb" for="al-prov">Provincia</label>
                <input class="input" id="al-prov" value="${P.esc(datos.provincia || 'Neuquén')}" /></div>
            </div>
            <div style="margin-top:10px"><label class="lb" for="al-diag">Diagnóstico</label>
              <input class="input" id="al-diag" maxlength="300" value="${P.esc(datos.diagnostico || '')}"
                placeholder="…acredita la existencia de ___" /></div>
            <p class="so-help" style="margin:6px 0 0">Lo define el médico. Si todavía no lo tenés, dejalo vacío:
              el alta sigue igual y la declaración la generás después desde su ficha.</p>
          </div>`
        } else if (e === 'esperando_codigo') {
          box.innerHTML = `<p class="so-help" style="margin:0">Al terminar el alta te damos el mensaje listo para pedirle
            que genere su código de vinculación en Mi Argentina.</p>`
        } else { box.innerHTML = '' }
      }
      inputRepro.addEventListener('change', pintarExtra)
      pintarExtra()
      const email = cuerpo.querySelector('#al-email')
      email.focus()
      let t = null
      email.addEventListener('input', () => {
        clearTimeout(t)
        t = setTimeout(() => altaPrecargar(email.value.trim()), 400)
      })
      cuerpo.querySelector('#al-sig1').addEventListener('click', () => {
        datos.email = email.value.trim().toLowerCase()
        datos.nombre = cuerpo.querySelector('#al-nombre').value.trim()
        datos.telefono = cuerpo.querySelector('#al-tel').value.trim()
        datos.documento = cuerpo.querySelector('#al-dni').value.replace(/\D/g, '')
        datos.reprocann_estado = inputRepro.value
        const campoCod = cuerpo.querySelector('#al-cod')
        datos.reprocann_codigo = campoCod ? campoCod.value.trim() : ''
        const campoVence = cuerpo.querySelector('#al-vence')
        datos.reprocann_vence = campoVence ? campoVence.value : ''
        // datos de la declaración jurada (solo existen si eligió autocultivo)
        const val = (sel) => { const el = cuerpo.querySelector(sel); return el ? el.value.trim() : '' }
        datos.domicilio = val('#al-dom')
        datos.localidad = val('#al-loc')
        datos.provincia = val('#al-prov')
        datos.diagnostico = val('#al-diag')
        if (datos.reprocann_codigo && datos.reprocann_codigo.length !== 13) {
          const aviso = cuerpo.querySelector('#al-precarga')
          aviso.className = 'msg err'; aviso.textContent = 'El código de vinculación tiene 13 caracteres.'; return
        }
        if (datos.documento && (datos.documento.length < 7 || datos.documento.length > 8)) {
          const aviso = cuerpo.querySelector('#al-precarga')
          aviso.className = 'msg err'; aviso.textContent = 'El DNI tiene 7 u 8 números (sin puntos).'; return
        }
        datos.nota = cuerpo.querySelector('#al-nota').value.trim()
        const aviso = cuerpo.querySelector('#al-precarga')
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email)) {
          aviso.className = 'msg err'; aviso.textContent = 'Falta un email válido.'; return
        }
        if (!datos.nombre) { aviso.className = 'msg err'; aviso.textContent = 'Falta el nombre.'; return }
        paso = 2; pintar2()
      })
    }

    async function altaPrecargar(email) {
      const aviso = cuerpo.querySelector('#al-precarga')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { aviso.textContent = ''; return }
      const r = await fetch(`/api/panel/alta?email=${encodeURIComponent(email)}`, { credentials: 'include' })
      if (!r.ok) return
      const d = await r.json()
      tarifas = d.tarifas || []
      const avisos = []
      if (d.solicitud) {
        if (d.solicitud.nombre && !cuerpo.querySelector('#al-nombre').value) cuerpo.querySelector('#al-nombre').value = d.solicitud.nombre
        if (d.solicitud.telefono && !cuerpo.querySelector('#al-tel').value) cuerpo.querySelector('#al-tel').value = d.solicitud.telefono
        if (d.solicitud.dni && !cuerpo.querySelector('#al-dni').value) cuerpo.querySelector('#al-dni').value = d.solicitud.dni
        avisos.push(`Dejó una solicitud web${d.solicitud.intent === 'acceso' ? ' (ya tiene REPROCANN)' : ' (pidió entrevista)'}${d.solicitud.adjunto ? ' con adjunto' : ''} — datos precargados.`)
        if (d.solicitud.intent === 'acceso') {
          const sel = cuerpo.querySelector('#al-repro')
          if (sel.value === 'esperando_codigo') { sel.value = 'aprobado'; sel.dispatchEvent(new Event('change')) }
        }
      }
      if (d.yaTieneAcceso) avisos.push('Ya tiene acceso a la carta.')
      if (d.yaTieneFicha) {
        avisos.push(`Ya tiene ficha en el padrón (${P.esc(d.yaTieneFicha.nombre)}) — se completa, no se duplica.`)
        if (d.yaTieneFicha.documento && !cuerpo.querySelector('#al-dni').value) cuerpo.querySelector('#al-dni').value = d.yaTieneFicha.documento
      }
      aviso.className = 'so-help'
      aviso.textContent = avisos.join(' ')
    }

    function pintar2() {
      const opciones = tarifas.length ? tarifas : [
        { item: 'SMALL', gramos: 10, contado: 200000, debito: 160000 },
        { item: 'MEDIUM', gramos: 20, contado: 375000, debito: 300000 },
        { item: 'LARGE', gramos: 30, contado: 525000, debito: 420000 },
        { item: 'EXTRA LARGE', gramos: 40, contado: 625000, debito: 500000 },
      ]
      cuerpo.innerHTML = `${pasosHtml()}
        <p class="so-help" style="margin:0 0 10px">Elegí la membresía de ${P.esc(datos.nombre.split(' ')[0])}.
        El precio con débito automático lleva el 20% por 3 meses.</p>
        <div class="al-tiers">${opciones.map((t) => `
          <button class="al-tier ${datos.tier === t.item ? 'on' : ''}" data-tier="${P.esc(t.item)}"
            data-precio="${t.contado}" type="button">
            <b>${P.esc(t.item)}</b><span>${t.gramos} g por mes</span>
            <span class="al-precio">${P.fmt(t.contado)}</span>
            <span class="al-deb">débito ${P.fmt(t.debito)}</span>
          </button>`).join('')}
          <button class="al-tier ${datos.tier === 'NINGUNA' ? 'on' : ''}" data-tier="NINGUNA" data-precio="0" type="button">
            <b>Sin membresía</b><span>por ahora</span></button>
        </div>
        <div class="fila" style="margin-top:14px">
          <button class="btn" id="al-atras" type="button">← Atrás</button><span class="pn-sp"></span>
          <button class="btn btn-pri" id="al-sig2" type="button">Seguir →</button></div>`
      cuerpo.querySelectorAll('.al-tier').forEach((b) => b.addEventListener('click', () => {
        datos.tier = b.dataset.tier
        datos.precio = Number(b.dataset.precio)
        cuerpo.querySelectorAll('.al-tier').forEach((x) => x.classList.toggle('on', x === b))
      }))
      cuerpo.querySelector('#al-atras').addEventListener('click', () => { paso = 1; pintar1() })
      cuerpo.querySelector('#al-sig2').addEventListener('click', () => { paso = 3; pintar3() })
    }

    function pintar3() {
      const conMemb = datos.tier !== 'NINGUNA'
      // el 20% del débito es solo para trámite subido (aprobado o en evaluación)
      const reproOk = ['aprobado', 'en_evaluacion'].includes(datos.reprocann_estado)
      cuerpo.innerHTML = `${pasosHtml()}
        <div class="card" style="box-shadow:none;background:var(--card2);margin-bottom:10px">
          <b>${P.esc(datos.nombre)}</b>
          <div style="color:var(--muted);font-size:12px;margin-top:2px">${P.esc(datos.email)}
          ${conMemb ? ` · ${P.esc(datos.tier)}` : ' · sin membresía'}</div>
        </div>
        ${conMemb ? `<p class="so-help" style="margin:0 0 10px">¿Cómo arranca?</p>
        <div class="grid2" style="gap:10px">
          <button class="btn al-fin" data-cobro="efectivo" type="button" style="padding:14px;text-align:left;height:auto">
            <b style="display:block">Cobré ${P.fmt(datos.precio || 0)}</b>
            <span style="color:var(--muted);font-weight:400;font-size:12px">Registra el pago y le habilita los gramos</span>
          </button>
          ${reproOk ? `<button class="btn btn-pri al-fin" data-cobro="debito" type="button" style="padding:14px;text-align:left;height:auto">
            <b style="display:block">Mandarle el débito −20%</b>
            <span style="opacity:.85;font-weight:400;font-size:12px">El link del plan, listo para WhatsApp</span>
          </button>` : `<div class="card" style="box-shadow:none;background:var(--card2);padding:14px">
            <b style="display:block;font-size:13px">Débito −20%: todavía no</b>
            <span style="color:var(--muted);font-size:12px">Se ofrece cuando su trámite esté subido a REPROCANN (aprobado o en evaluación).</span>
          </div>`}
        </div>
        <div class="fila" style="margin-top:10px"><button class="btn al-fin" data-cobro="ninguno" type="button">Después paga</button>
        <span class="pn-sp"></span><span class="msg" id="al-msg"></span></div>`
        : `<div class="fila"><button class="btn btn-pri al-fin" data-cobro="ninguno" type="button">Dar de alta</button>
           <span class="msg" id="al-msg"></span></div>`}`
      cuerpo.querySelectorAll('.al-fin').forEach((b) => b.addEventListener('click', () => altaEnviar(b.dataset.cobro)))
    }

    async function altaEnviar(cobro) {
      const msg = cuerpo.querySelector('#al-msg')
      cuerpo.querySelectorAll('.al-fin').forEach((b) => { b.disabled = true })
      msg.className = 'msg'; msg.textContent = '⏳ dando de alta…'
      const r = await fetch('/api/panel/alta', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...datos,
          cobro: cobro === 'efectivo' ? 'efectivo' : 'ninguno',
          monto: cobro === 'efectivo' ? datos.precio : 0,
          medio: 'efectivo',
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        cuerpo.querySelectorAll('.al-fin').forEach((b) => { b.disabled = false })
        msg.className = 'msg err'; msg.textContent = '✗ ' + (d.error || 'error ' + r.status)
        return
      }
      // Alta hecha. Si pidió débito, el link es el del PLAN precargado en el
      // panel de MP (nunca links personalizados — decisión 01/08).
      let extra = ''
      if (cobro === 'debito') {
        const t = tarifas.find((x) => x.item === datos.tier)
        if (t && t.debito_link) {
          const tierL = datos.tier.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())
          const waDeb = `https://wa.me/${(datos.telefono || '').replace(/\D/g, '')}?text=${encodeURIComponent(
            `Hola ${datos.nombre.split(' ')[0]}! Ya sos socio de Flora 🌿 Tu plan ${tierL} de ${t.gramos} gramos por mes que vale ${P.fmt(t.contado)} tiene un 20% de descuento adhiriéndote al débito automático por 3 meses, te queda en ${P.fmt(t.debito)}. Se autoriza una vez desde MercadoPago, podés usar el medio de pago que prefieras (crédito/débito/saldo) y podés cancelarlo si te arrepentís. Suscribite acá: ${t.debito_link}`)}`
          extra = `<div style="margin-top:10px"><span class="k">Link del débito (plan ${P.esc(datos.tier)})</span>
            <input class="input" value="${P.esc(t.debito_link)}" readonly onclick="this.select()" style="margin-top:6px" />
            <a class="btn btn-pri" href="${P.esc(waDeb)}" target="_blank" rel="noopener" id="al-wa-debito" style="margin-top:6px;display:inline-block">Mandar por WhatsApp</a></div>`
          // registrar el envío (para el "mandado hace N días" de Finanzas)
          fetch('/api/panel/mp/enviar', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ socio_id: d.socioId, via: 'whatsapp' }),
          }).catch(() => { /* el registro nunca bloquea el alta */ })
        } else {
          extra = `<p class="msg err" style="margin-top:10px">No hay plan de Mercado Pago cargado para ${P.esc(datos.tier)} — el socio quedó dado de alta igual; mandale el link desde Finanzas → Débito automático.</p>`
        }
      }
      // Autocultivador que se pasa: la declaración jurada sale acá mismo,
      // contra la ficha que se acaba de crear. El domicilio viaja con ella y
      // queda guardado. Si falta el diagnóstico, el alta igual queda hecha.
      let ddjj = null
      if (datos.reprocann_estado === 'autocultivo' && datos.diagnostico && datos.domicilio && d.socioId) {
        try {
          const rd = await fetch('/api/panel/declaracion', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              socio_id: d.socioId, diagnostico: datos.diagnostico, domicilio: datos.domicilio,
              localidad: datos.localidad, provincia: datos.provincia,
            }),
          })
          const dd = await rd.json().catch(() => ({}))
          ddjj = rd.ok ? { ok: true, html: dd.html } : { ok: false, error: dd.error || 'error ' + rd.status }
        } catch { ddjj = { ok: false, error: 'no se pudo conectar' } }
      }

      const nom = datos.nombre.split(' ')[0]
      const faltaCodigo = datos.reprocann_estado === 'esperando_codigo' ||
        (['codigo_listo', 'cargado', 'en_evaluacion'].includes(datos.reprocann_estado) && !datos.reprocann_codigo)
      const txtBase = `Hola ${nom}! Ya sos socio de Flora 🌿 ${d.gramos ? `Tu membresía ${datos.tier} te da ${d.gramos} g por mes. ` : ''}Entrá a la carta con tu cuenta de Google (${datos.email}): https://floraong.ar/socios/`
      const txtCodigo = `Hola ${nom}! Ya sos socio de Flora 🌿 Para arrancar tu REPROCANN necesitamos tu código de vinculación: lo generás en tu cuenta de Mi Argentina y lo cargás acá, con el paso a paso: https://floraong.ar/socios/reprocann/`
      const wa = `https://wa.me/${(datos.telefono || '').replace(/\D/g, '')}?text=${encodeURIComponent(faltaCodigo ? txtCodigo : txtBase)}`
      cuerpo.innerHTML = `
        <div style="text-align:center;padding:6px 0 4px">
          <div style="font-family:var(--font-display);font-size:28px;color:var(--grn)">Listo</div>
          <p style="color:var(--ink2);margin:6px 0 0">${P.esc(datos.nombre)} ya tiene acceso a la carta y ficha en el padrón${d.gramos ? ` con ${d.gramos} g por mes` : ''}.</p>
          <p class="so-help" style="margin:8px 0 0">${d.mailEnviado
            ? 'Le llegó el mail de bienvenida.'
            : `El mail de bienvenida NO salió (${P.esc(d.mailError || 'sin detalle')}) — avisale vos.`}</p>
          ${faltaCodigo ? `<div style="margin-top:14px;padding:12px 16px;background:var(--amb-soft);border-radius:12px;text-align:left">
            <b style="color:var(--amb);font-size:13px">Falta su código de vinculación</b>
            <p class="so-help" style="margin:4px 0 0">Sin ese código no se puede arrancar el trámite de REPROCANN.
            El botón de WhatsApp de acá abajo ya lleva el mensaje con el link y el paso a paso.</p>
          </div>` : ''}
        </div>
        ${extra}
        ${ddjj ? (ddjj.ok
          ? `<div style="margin-top:14px;padding:12px 16px;background:var(--card2);border-radius:12px;text-align:left">
              <b style="font-size:13px">Declaración jurada lista</b>
              <p class="so-help" style="margin:4px 0 10px">Guardala como PDF y mandásela para que la firme.
                Cuando vuelva firmada, la subís desde su ficha.</p>
              <button class="btn btn-pri" id="al-ddjj-ver" type="button">Abrir para imprimir</button>
              ${datos.telefono ? `<a class="btn" id="al-ddjj-wa" target="_blank" rel="noopener" href="#" style="margin-left:6px">Mandar por WhatsApp</a>` : ''}
            </div>`
          : `<p class="msg err" style="margin-top:10px">El socio quedó dado de alta, pero la declaración no salió
              (${P.esc(ddjj.error)}). Generala desde su ficha.</p>`) : ''}
        <div class="pn-mod-acciones">
          ${datos.telefono ? `<a class="btn ${faltaCodigo ? 'btn-pri' : ''}" href="${P.esc(wa)}" target="_blank" rel="noopener">${faltaCodigo ? 'Pedirle el código' : 'Saludar por WhatsApp'}</a>` : ''}
          <button class="btn btn-pri" onclick="Panel.cerrarModal()" type="button">Cerrar</button>
        </div>`
      if (ddjj && ddjj.ok) {
        cuerpo.querySelector('#al-ddjj-ver')?.addEventListener('click', () => {
          const w = window.open('', '_blank')
          if (w) { w.document.write(ddjj.html); w.document.close() }
        })
        const waDj = cuerpo.querySelector('#al-ddjj-wa')
        if (waDj) {
          waDj.href = `https://wa.me/${(datos.telefono || '').replace(/\D/g, '')}?text=${encodeURIComponent(
            `Hola ${nom}! Te paso la declaración jurada para que puedas pasarte a Flora. Es el papel que pide el registro cuando alguien deja el autocultivo y se vincula a una asociación: no se pueden tener las dos modalidades a la vez.\n\nImprimila, firmala y mandanos una foto. Con eso seguimos nosotros el trámite.`)}`
        }
      }
      if (cont) muCargar(true)
      if (altaCb) { try { altaCb() } catch { /* nada */ } altaCb = null }
    }

    pintar1()
  }


  // ============ Convertir autocultivador (cv-): del PDF a la DDJJ ============
  // El circuito que Sofi hacía saltando entre pantallas, en un solo modal:
  // arrastra el PDF del certificado, el servidor lo lee (texto o visión),
  // usa o crea la ficha, guarda el certificado y genera la declaración.
  // Cierra con el WhatsApp que lo invita a firmar en el portal.

  // El mismo mensaje de waDdjj (mod-socio-detalle.js): invita a firmar desde
  // su cuenta, sin imprimir nada. wa.me quiere el número internacional: a los
  // celulares argentinos de 10 cifras se les antepone 549.
  function cvTxtFirma(nombre) {
    const nom = String(nombre || '').split(' ')[0]
    return `Hola ${nom}! Ya está lista tu declaración jurada para pasarte a Flora. `
      + `Es el paso que pide el registro cuando alguien deja el autocultivo y se vincula a una asociación: `
      + `no se pueden tener las dos modalidades a la vez.\n\n`
      + `La podés firmar directo desde tu cuenta, sin imprimir nada:\n`
      + `1. Entrá a https://floraong.ar/socios/ con tu Google\n`
      + `2. En "Mi cuenta" vas a ver la tarjeta DECLARACIÓN JURADA\n`
      + `3. Leela y firmala con tu nombre y tu DNI\n\n`
      + `Con eso seguimos nosotros el trámite. Cualquier duda antes de firmar, escribime.`
  }
  function cvWa(nombre, telefono) {
    let tel = digitsOnly(telefono)
    if (tel.length === 10) tel = '549' + tel
    return `https://wa.me/${tel}?text=${encodeURIComponent(cvTxtFirma(nombre))}`
  }
  // Sin teléfono, el mismo texto va por mail: es la cuenta de Google con la
  // que va a entrar a firmar, así que el mail siempre existe en modo lead.
  function cvMailto(nombre, email) {
    return `mailto:${email}?subject=${encodeURIComponent('Tu declaración jurada para pasarte a Flora')}`
      + `&body=${encodeURIComponent(cvTxtFirma(nombre))}`
  }

  // `lead` (opcional) = modo lead: { email, nombre, telefono, reprocann }.
  // El aspirante ya subió su credencial desde el portal — el asistente
  // arranca leyéndola del servidor, sin pedir el PDF de nuevo.
  function cvAbrir(lead) {
    let pdfB64 = null            // se reenvía con la confirmación (el server no lo retiene)
    let leadCtx = lead || null   // si se sube otro PDF a mano, el modo lead se apaga
    let socioIdPend = null       // socio ya resuelto, esperando diagnóstico/domicilio

    const ov = P.modal('Convertir autocultivador', '<div id="cv-cuerpo"></div>')
    const cuerpo = ov.querySelector('#cv-cuerpo')
    const setMsg = (texto, err) => {
      const el = cuerpo.querySelector('#cv-msg')
      if (!el) return
      el.className = 'msg' + (err ? ' err' : '')
      el.textContent = texto
    }

    async function cvPost(body, boton) {
      if (boton) boton.disabled = true
      setMsg('⏳ procesando…')
      let r, d
      try {
        r = await fetch('/api/panel/conversion', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        d = await r.json().catch(() => ({}))
      } catch {
        if (boton) boton.disabled = false
        setMsg('✗ sin conexión — probá de nuevo', true)
        return
      }
      if (!r.ok) {
        if (boton) boton.disabled = false
        setMsg('✗ ' + (d.error || errHttp(r.status)), true)
        return
      }
      if (d.paso === 'revisar') pintarRevisar(d)
      else if (d.paso === 'falta_diagnostico') { if (cont) muCargar(true); if (leadCtx && cvCb) { try { cvCb() } catch { /* nada */ } } pintarFalta(d) }
      else if (d.paso === 'listo') { if (cont) muCargar(true); if (leadCtx && cvCb) { try { cvCb() } catch { /* nada */ } } pintarListo(d) }
      else setMsg('✗ respuesta inesperada del servidor', true)
    }

    // De dónde sale el PDF en cada POST: del lead (ya subido al portal) o
    // del base64 que se arrastró acá.
    const cvFuente = () => (leadCtx ? { lead_email: leadCtx.email } : { pdf_base64: pdfB64 })

    /* Paso 1 del modo lead: no hay nada que subir, se lee lo que ya mandó */
    function pintarLeyendoLead() {
      cuerpo.innerHTML = `
        <p class="so-help" style="margin:0 0 12px">
          <b>${P.esc(leadCtx.nombre || leadCtx.email)}</b> ya subió su credencial REPROCANN desde el portal.
          Se usa esa: con su DNI se busca o se crea la ficha, el certificado queda guardado y sale la
          declaración jurada para que la firme con su cuenta (${P.esc(leadCtx.email)}).</p>
        <p class="msg" id="cv-msg" style="margin:10px 0 0" aria-live="polite"></p>`
      cvPost({ lead_email: leadCtx.email })
    }

    /* Paso 1: el PDF del certificado */
    function pintarSubir() {
      cuerpo.innerHTML = `
        <p class="so-help" style="margin:0 0 12px">Subí el certificado REPROCANN (PDF) del autocultivador.
        Se lee solo: con su DNI se busca o se crea la ficha, el certificado queda guardado y sale la
        declaración jurada para que la firme en el portal.</p>
        <div class="cv-drop" id="cv-drop" role="button" tabindex="0" aria-label="Elegir el PDF del certificado">
          <b>Arrastrá el PDF acá</b>
          <span>o hacé click para elegirlo (máx. 8 MB)</span>
        </div>
        <input type="file" id="cv-file" accept="application/pdf" hidden />
        <p class="msg" id="cv-msg" style="margin:10px 0 0" aria-live="polite"></p>`
      const drop = cuerpo.querySelector('#cv-drop')
      const file = cuerpo.querySelector('#cv-file')
      drop.addEventListener('click', () => file.click())
      drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click() } })
      ;['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('on') }))
      ;['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('on') }))
      drop.addEventListener('drop', (e) => cvArchivo(e.dataTransfer && e.dataTransfer.files[0]))
      file.addEventListener('change', () => cvArchivo(file.files[0]))
    }

    function cvArchivo(f) {
      if (!f) return
      if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name || '')) { setMsg('✗ Tiene que ser un PDF', true); return }
      if (f.size > 8 * 1024 * 1024) { setMsg('✗ El PDF es muy pesado (máx. 8 MB)', true); return }
      const drop = cuerpo.querySelector('#cv-drop')
      if (drop) drop.innerHTML = `<b>📄 ${P.esc(f.name)}</b><span>⏳ leyendo el certificado…</span>`
      const fr = new FileReader()
      fr.onerror = () => setMsg('✗ No se pudo leer el archivo', true)
      fr.onload = () => {
        pdfB64 = String(fr.result).replace(/^data:[^;]*;base64,/, '')
        cvPost({ pdf_base64: pdfB64 })
      }
      fr.readAsDataURL(f)
    }

    /* Paso 2: revisar lo leído antes de crear a nadie */
    function pintarRevisar(d) {
      const L = d.leido || {}
      cuerpo.innerHTML = `
        <p class="so-help" style="margin:0 0 4px">Esto es lo que se pudo leer del PDF — corregí lo que haga falta.</p>
        <p class="so-help" style="margin:0 0 12px"><b>${L.dni ? 'Ese DNI no está en el padrón: se crea una ficha nueva.'
          : 'No se pudo leer el DNI: completalo a mano.'}</b>
          Si el DNI es de un socio ya cargado, al confirmar se usa su ficha (no se duplica).</p>
        <div style="display:grid;gap:10px">
          <div class="grid2">
            <div><label class="lb" for="cv-nombre">Nombre y apellido</label>
              <input class="input" id="cv-nombre" value="${P.esc(L.nombre || '')}" /></div>
            <div><label class="lb" for="cv-dni">DNI</label>
              <input class="input" id="cv-dni" inputmode="numeric" maxlength="10" value="${P.esc(L.dni || '')}" placeholder="sin puntos" /></div>
          </div>
          <div class="grid2">
            <div><label class="lb" for="cv-dom">Domicilio</label>
              <input class="input" id="cv-dom" value="${P.esc(L.domicilio || '')}" placeholder="Calle y número" /></div>
            <div><label class="lb" for="cv-vence">Vence su credencial</label>
              <input class="input" id="cv-vence" type="date" value="${P.esc(L.vence || '')}" /></div>
          </div>
          <div class="grid2">
            <div><label class="lb" for="cv-loc">Localidad</label>
              <input class="input" id="cv-loc" value="${P.esc(L.localidad || '')}" /></div>
            <div><label class="lb" for="cv-prov">Provincia</label>
              <input class="input" id="cv-prov" value="${P.esc(L.provincia || 'Neuquén')}" /></div>
          </div>
          <div class="grid2">
            <div><label class="lb" for="cv-diag">Diagnóstico</label>
              <input class="input" id="cv-diag" maxlength="300" value="${P.esc(L.diagnostico || '')}"
                placeholder="…acredita la existencia de ___" /></div>
            <div><label class="lb" for="cv-tel">Teléfono</label>
              <input class="input" id="cv-tel" type="tel" placeholder="+54 9 299…"
                value="${P.esc((leadCtx && leadCtx.telefono) || '')}" /></div>
          </div>
        </div>
        <div class="pn-mod-acciones">
          <button class="btn" id="cv-otra" type="button">← Otro PDF</button>
          <button class="btn btn-pri" id="cv-conf" type="button">Confirmar y seguir</button>
        </div>
        <p class="msg" id="cv-msg" style="margin:8px 0 0" aria-live="polite"></p>`
      // «Otro PDF» apaga el modo lead: si el de la credencial subida no
      // sirve, se sigue con el circuito manual de siempre.
      cuerpo.querySelector('#cv-otra').addEventListener('click', () => { pdfB64 = null; leadCtx = null; pintarSubir() })
      cuerpo.querySelector('#cv-conf').addEventListener('click', (ev) => {
        const val = (sel) => { const el = cuerpo.querySelector(sel); return el ? el.value.trim() : '' }
        const documento = val('#cv-dni').replace(/\D/g, '')
        if (!val('#cv-nombre')) { setMsg('✗ Falta el nombre', true); return }
        if (documento.length < 7 || documento.length > 8) { setMsg('✗ El DNI tiene 7 u 8 números', true); return }
        cvPost({
          ...cvFuente(), confirmar_creacion: true,
          nombre: val('#cv-nombre'), documento,
          domicilio: val('#cv-dom'), localidad: val('#cv-loc'), provincia: val('#cv-prov'),
          vence: val('#cv-vence'), diagnostico: val('#cv-diag'), telefono: val('#cv-tel'),
        }, ev.target)
      })
    }

    /* Paso 3: lo que el PDF no dijo (diagnóstico, y teléfono/domicilio si faltan) */
    function pintarFalta(d) {
      socioIdPend = d.socio_id
      const s = d.socio || {}
      cuerpo.innerHTML = `
        <div class="card" style="box-shadow:none;background:var(--card2);margin-bottom:10px">
          <b>${P.esc(s.nombre || '')}</b>
          <div style="color:var(--muted);font-size:12px;margin-top:2px">${s.creado ? 'Ficha nueva creada' : 'Ficha ya existente'} · certificado guardado</div>
        </div>
        <p class="so-help" style="margin:0 0 10px">Para armar la declaración jurada falta lo de acá abajo.
        El diagnóstico lo define el médico: es lo que funda la prescripción.</p>
        <div style="display:grid;gap:10px">
          <div><label class="lb" for="cv-diag2">Diagnóstico</label>
            <input class="input" id="cv-diag2" maxlength="300" value="${P.esc(d.diagnostico || '')}"
              placeholder="…acredita la existencia de ___" /></div>
          ${d.falta_domicilio ? `<div><label class="lb" for="cv-dom2">Domicilio</label>
            <input class="input" id="cv-dom2" placeholder="Calle y número" /></div>` : ''}
          ${d.falta_telefono ? `<div><label class="lb" for="cv-tel2">Teléfono</label>
            <input class="input" id="cv-tel2" type="tel" placeholder="+54 9 299… (para mandarle el WhatsApp)" /></div>` : ''}
        </div>
        <div class="pn-mod-acciones">
          <button class="btn btn-pri" id="cv-gen" type="button">Generar la declaración</button>
        </div>
        <p class="msg" id="cv-msg" style="margin:8px 0 0" aria-live="polite"></p>`
      cuerpo.querySelector('#cv-gen').addEventListener('click', (ev) => {
        const val = (sel) => { const el = cuerpo.querySelector(sel); return el ? el.value.trim() : '' }
        const diag = val('#cv-diag2')
        if (!diag) { setMsg('✗ Falta el diagnóstico', true); return }
        if (d.falta_domicilio && !val('#cv-dom2')) { setMsg('✗ Falta el domicilio: la declaración lo lleva', true); return }
        const body = { socio_id: socioIdPend, diagnostico: diag }
        if (d.falta_domicilio) body.domicilio = val('#cv-dom2')
        if (d.falta_telefono && val('#cv-tel2')) body.telefono = val('#cv-tel2')
        cvPost(body, ev.target)
      })
    }

    /* Paso final: resumen + WhatsApp de firma + ficha. En modo lead, si no
       hay teléfono, el mismo texto sale por mail a su cuenta de Google. */
    function pintarListo(d) {
      const s = d.socio || {}
      const tel = s.telefono || (leadCtx && leadCtx.telefono) || ''
      const mail = s.email || (leadCtx && leadCtx.email) || ''
      cuerpo.innerHTML = `
        <div style="text-align:center;padding:6px 0 4px">
          <div class="cv-ok">✓ Listo</div>
          <p style="color:var(--ink2);margin:8px 0 0"><b>${P.esc(s.nombre || '')}</b> —
            ${s.creado ? 'ficha nueva creada' : 'ficha ya existente'}, certificado guardado.</p>
          <p class="so-help" style="margin:6px 0 0">${d.ya_firmada
            ? 'Ya tenía su declaración firmada: no se generó otra. No falta nada de este trámite.'
            : 'La declaración jurada quedó generada. Falta que la firme desde su cuenta en el portal.'}</p>
        </div>
        <div class="pn-mod-acciones">
          ${!d.ya_firmada && tel ? `<a class="btn btn-pri" href="${P.esc(cvWa(s.nombre, tel))}"
            target="_blank" rel="noopener" title="Abre el chat con el mensaje escrito: lo invita a firmar desde su cuenta.">Mandarle el WhatsApp de firma</a>` : ''}
          ${!d.ya_firmada && !tel ? `<span class="so-help">Sin teléfono en la ficha${mail ? ':' : ': avisale vos que firme en floraong.ar/socios/'}</span>` : ''}
          ${!d.ya_firmada && !tel && mail ? `<a class="btn btn-pri" href="${P.esc(cvMailto(s.nombre, mail))}"
            title="Abre tu mail con el mismo mensaje: lo invita a firmar desde su cuenta.">Mandarle el mail de firma</a>` : ''}
          <button class="btn" id="cv-ficha" type="button">Abrir ficha</button>
          <button class="btn ${d.ya_firmada || (!tel && !mail) ? 'btn-pri' : ''}" onclick="Panel.cerrarModal()" type="button">Cerrar</button>
        </div>`
      cuerpo.querySelector('#cv-ficha').addEventListener('click', () => {
        P.cerrarModal()
        window.PanelSocioDetalle.abrir(Number(s.id), () => muCargar(true))
      })
    }

    if (leadCtx) pintarLeyendoLead()
    else pintarSubir()
  }


  // ============ Unificar pacientes (ru-): el volcado oficial del portal ============
  // El portal de REPROCANN (cuenta de la ONG) es la única fuente con el DNI
  // oficial de cada trámite. El volcado entra acá, el matching propone pares
  // contra el padrón y CADA vínculo se confirma a mano. Una vez confirmado,
  // los volcados siguientes actualizan a ese socio solos.
  let ruDatos = null

  const RU_ESTADOS = {
    Aprobado: ['Aprobado', 'tag-ok'], PendienteEvaluacion: ['En evaluación', 'tag-off'],
    PendienteConsentimientoPaciente: ['Espera su firma', 'tag-deb'], PendienteConsentimiento: ['Espera su firma', 'tag-deb'],
    ObservadoPorPaciente: ['Observado', 'tag-deb'], PendienteVinculacionCultivador: ['Nos toca vincular', 'tag-mal'],
    PendienteRevisionMedica: ['Volvió al médico', 'tag-auto'], Rechazado: ['Rechazado', 'tag-mal'], Anulado: ['Anulado', 'tag-mal'],
  }
  const ruEstado = (e) => {
    const [txt, cls] = RU_ESTADOS[e] || [e, 'tag-off']
    return `<span class="tag ${cls}">${P.esc(txt)}</span>`
  }
  const CHIP = {
    dni: ['DNI', 'tag-ok'], nombre: ['nombre', 'tag-auto'], nombre_parcial: ['nombre parcial', 'tag-deb'],
  }
  const ruChips = (sen) => {
    if (!sen) return ''
    const m = (sen.match || []).map((s) => { const [t, c] = CHIP[s] || [s, 'tag-off']; return `<span class="tag ${c}">${t}</span>` })
    const conf = (sen.conflictos || []).map((s) => `<span class="tag tag-mal">${s === 'dni' ? 'DNI distinto' : P.esc(s)}</span>`)
    return m.concat(conf).join(' ')
  }

  async function ruCargar() {
    const caja = cont.querySelector('#ru-panel')
    caja.innerHTML = '<div class="vacio">⏳ Buscando pares…</div>'
    const r = await fetch('/api/panel/reprocann/unificar', { credentials: 'include' })
    if (!r.ok) { caja.innerHTML = `<div class="vacio">El servidor respondió ${r.status}.</div>`; return }
    ruDatos = await r.json()
    ruPintar()
  }

  function ruPintar() {
    const d = ruDatos
    const caja = cont.querySelector('#ru-panel')
    const simples = d.pares.filter((g) => g.candidatos.length === 1 && (g.candidatos[0].senales || {}).confianza !== 'revisar')
    const revisar = d.pares.filter((g) => g.candidatos.length > 1 || (g.candidatos[0].senales || {}).confianza === 'revisar')
    const cnt = cont.querySelector('#ru-cnt')
    if (cnt) { cnt.hidden = !d.pares.length; cnt.textContent = d.pares.length }

    caja.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <span class="k">Volcado del portal</span>
        <p class="so-help" style="margin:6px 0 8px">Pegá el JSON de trámites del portal de REPROCANN (cuenta de la ONG)
        o subí el archivo. Cada carga actualiza sola a los ${d.vinculados} socio(s) ya vinculados y propone pares nuevos.
        ${d.ultimaCarga ? `Última carga: ${P.esc(d.ultimaCarga.slice(0, 16).replace('T', ' '))}.` : 'Todavía no se cargó ninguno.'}</p>
        <div class="fila" style="flex-wrap:wrap;gap:6px">
          <textarea class="input" id="ru-json" rows="2" placeholder='Pegar acá el JSON…' style="flex:1;min-width:220px;font-size:12px;font-family:var(--font-ui)"></textarea>
          <input type="file" id="ru-file" accept="application/json,.json" hidden />
          <button class="btn" id="ru-subir" type="button">Subir archivo</button>
          <button class="btn btn-pri" id="ru-procesar" type="button">Procesar</button>
        </div>
        <p class="msg" id="ru-msg" style="margin:8px 0 0"></p>
      </div>

      ${simples.length ? `<div class="card" style="margin-bottom:14px;border-left:3px solid var(--vio)">
        <span class="k">Pares por confirmar (${simples.length})</span>
        <p class="so-help">El matching dice que son la misma persona. Nada se une sin tu click.</p>
        ${simples.map((g) => ruFila(g, g.candidatos[0])).join('')}
      </div>` : ''}

      ${revisar.length ? `<div class="card" style="margin-bottom:14px;border-left:3px solid var(--amb)">
        <span class="k">Revisar con cuidado (${revisar.length})</span>
        <p class="so-help">Datos que se contradicen o más de un socio posible — mirá bien antes de confirmar.</p>
        ${revisar.map((g) => g.candidatos.length === 1 ? ruFila(g, g.candidatos[0], true)
          : `<div style="padding:9px 0;border-top:1px solid var(--line)">
              <div><b>${P.esc(g.persona.nombre + ' ' + g.persona.apellido)}</b>
                <span style="color:var(--muted)">· DNI ${P.esc(g.dni)}</span> ${ruEstado(g.persona.estado)}</div>
              <div class="so-help" style="margin:4px 0 6px">¿Cuál de estos socios es?</div>
              ${g.candidatos.map((c) => `<div class="fila" style="padding:4px 0">
                <span>${P.esc(c.socio.nombre)}${c.socio.email ? ` <span style="color:var(--muted);font-size:11px">${P.esc(c.socio.email)}</span>` : ''} ${ruChips(c.senales)}</span>
                <span class="pn-sp"></span>
                <button class="btn ru-si" data-dni="${P.esc(g.dni)}" data-socio="${c.socio_id}" type="button">Es él</button>
              </div>`).join('')}
              <div class="fila" style="padding:4px 0"><span class="pn-sp"></span>
                <button class="btn ru-ninguno" data-dni="${P.esc(g.dni)}" data-socios="${g.candidatos.map((c) => c.socio_id).join(',')}" type="button">Ninguno de estos</button></div>
            </div>`).join('')}
      </div>` : ''}

      ${!simples.length && !revisar.length ? `<div class="card" style="margin-bottom:14px"><div class="vacio">
        No hay pares pendientes${d.vinculados ? ` — ${d.vinculados} socio(s) vinculados se actualizan solos con cada volcado` : ''}.</div></div>` : ''}

      ${d.sinMatch.length ? `<details class="card" style="margin-bottom:14px">
        <summary style="cursor:pointer;font-weight:600;font-size:13px">Sin match en el padrón (${d.sinMatch.length})</summary>
        <p class="so-help" style="margin-top:6px">Trámites de la ONG cuya persona no se parece a ningún socio.
        Con «Dar de alta» se abre el alta de socio ya precargada con su nombre y DNI oficiales.</p>
        <table class="tabla"><thead><tr><th>Persona</th><th>DNI</th><th>Trámite</th><th>Vence</th><th class="r"></th></tr></thead>
        <tbody>${d.sinMatch.map((p) => `<tr>
          <td><b>${P.esc(p.nombre + ' ' + p.apellido)}</b>${p.renovacion ? ' <span class="tag tag-off">renovación</span>' : ''}</td>
          <td style="font-family:var(--font-ui)">${P.esc(p.dni)}</td>
          <td>${ruEstado(p.estado)}${p.plantas ? ` <span style="color:var(--muted);font-size:11px">${p.plantas} plantas</span>` : ''}</td>
          <td style="color:var(--muted)">${p.vence ? P.esc(p.vence) : '—'}</td>
          <td class="r"><button class="btn ru-alta" data-dni="${P.esc(p.dni)}" type="button">Dar de alta</button></td>
        </tr>`).join('')}</tbody></table>
      </details>` : ''}`

    const msg = caja.querySelector('#ru-msg')
    const file = caja.querySelector('#ru-file')
    caja.querySelector('#ru-subir').addEventListener('click', () => file.click())
    file.addEventListener('change', async () => {
      if (file.files[0]) caja.querySelector('#ru-json').value = await file.files[0].text()
    })
    caja.querySelector('#ru-procesar').addEventListener('click', async () => {
      let crudo
      try { crudo = JSON.parse(caja.querySelector('#ru-json').value) } catch {
        msg.className = 'msg err'; msg.textContent = '✗ Eso no es un JSON válido — copialo entero, sin recortar.'; return
      }
      msg.className = 'msg'; msg.textContent = '⏳ procesando…'
      const r = await fetch('/api/panel/reprocann/sincronizar', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(crudo),
      })
      const res = await r.json().catch(() => ({}))
      if (!r.ok) { msg.className = 'msg err'; msg.textContent = '✗ ' + (res.error || 'error ' + r.status); return }
      msg.className = 'msg ok'
      msg.textContent = `✔ ${res.personas} persona(s) del portal · ${res.sincronizados} actualizadas solas · ${res.candidatosNuevos} par(es) nuevos por confirmar`
      setTimeout(() => { ruCargar(); muCargar(true) }, 900)
    })
  }

  function ruFila(g, c, cuidado) {
    return `<div class="fila" style="padding:9px 0;border-top:1px solid var(--line);flex-wrap:wrap">
      <span><b>${P.esc(c.socio.nombre)}</b>${c.socio.email ? ` <span style="color:var(--muted);font-size:11px">${P.esc(c.socio.email)}</span>` : ''}
        <span style="color:var(--muted)"> ↔ </span>
        <b>${P.esc(g.persona.nombre + ' ' + g.persona.apellido)}</b>
        <span style="color:var(--muted)">· DNI ${P.esc(g.dni)}</span>
        ${ruEstado(g.persona.estado)}${g.persona.vence ? ` <span style="color:var(--muted);font-size:11px">vence ${P.esc(g.persona.vence)}</span>` : ''}
        ${ruChips(c.senales)}</span>
      <span class="pn-sp"></span>
      <button class="btn ru-si ${cuidado ? '' : 'btn-pri'}" data-dni="${P.esc(g.dni)}" data-socio="${c.socio_id}" ${cuidado ? 'data-cuidado="1"' : ''} type="button">Sí, es él</button>
      <button class="btn ru-no" data-dni="${P.esc(g.dni)}" data-socio="${c.socio_id}" type="button">No es</button>
    </div>`
  }

  async function ruDecidir(body, boton) {
    if (boton) boton.disabled = true
    const r = await fetch('/api/panel/reprocann/vinculo', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { alert(d.error || 'No se pudo: error ' + r.status); if (boton) boton.disabled = false; return }
    if (d.avisoDni) alert(d.avisoDni)
    ruCargar()
    muCargar(true)
  }



  /* ============ Piezas de LEADS que sobreviven al tablero ============ */
  // El tablero de la pestaña Leads se FUSIONÓ en el kanban de Inicio
  // (decisión de Guille 08/08): acá quedan solo los modales y acciones que
  // el kanban reusa vía window.PanelLeads (abajo de todo). Los endpoints no
  // cambiaron; lo que se borró es el render viejo y sus listeners.
  function ldBadgeOrigen(l) {
    if (l.origen === 'solicitud_web') return l.intent === 'entrevista'
      ? '<span class="tag tag-deb">pidió entrevista</span>'
      : '<span class="tag tag-ok">dice tener REPROCANN</span>'
    if (l.origen === 'intento') return '<span class="tag tag-off">probó entrar</span>'
    if (l.origen === 'consultorio') return '<span class="tag tag-auto">consultorio</span>'
    return '<span class="tag tag-off">manual</span>'
  }

  /* El ciclo de pago del consultorio, visible de un vistazo: la reserva
     retenida muestra su cuenta regresiva, el pago aprobado su tilde, y la
     vencida queda marcada para perseguirla. */
  function ldChipPago(l) {
    if (l.origen !== 'consultorio' || !l.pago_estado) return ''
    if (l.pago_estado === 'aprobado') return '<span class="tag tag-ok">✓ pagado</span>'
    if (l.pago_estado === 'vencido') return '<span class="tag tag-mal">venció sin pagar</span>'
    if (l.pago_estado === 'retenido') {
      const min = l.pago_vence
        ? Math.ceil((Date.parse(String(l.pago_vence).replace(' ', 'T') + 'Z') - Date.now()) / 60000)
        : 0
      return min > 0
        ? `<span class="tag tag-deb">⏳ esperando pago · ${min} min</span>`
        : '<span class="tag tag-deb">⏳ esperando pago</span>'
    }
    return ''
  }

  /* La credencial REPROCANN ya leída del aspirante (modo aspirante del
     portal): el chip resume lo que se sabe y habilita convertirlo sin
     volver a pedirle el PDF. */
  const ldFechaCorta = (v) => {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v || '')
  }
  function ldChipReprocann(l) {
    const rc = l.reprocann
    if (!rc) return ''
    const partes = []
    if (rc.modalidad) partes.push(rc.modalidad)
    if (rc.plantas !== undefined && rc.plantas !== null) partes.push(`${rc.plantas} plantas`)
    if (rc.vence) partes.push(`vence ${ldFechaCorta(rc.vence)}`)
    return `<div style="margin-top:4px"><span class="tag tag-ok cv-lead-chip">🌱 REPROCANN ✓${partes.length ? ' ' + P.esc(partes.join(' · ')) : ''}</span></div>`
  }

  function ldTurnoLinea(l) {
    if (!l.turno_fecha) return ''
    const f = new Date(String(l.turno_fecha).replace(' ', 'T') + 'Z')
    const txt = f.toLocaleString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires' })
    return `<div style="color:var(--muted);font-size:12px">🗓 turno ${P.esc(txt)} hs</div>`
  }

  // Declaración jurada directo desde el lead: el REPROCANN que mandó a la
  // vista mientras se completa lo que falta, y el papel listo para descargar
  // y mandárselo. No se registra nada todavía — no hay ficha a la cual
  // colgarlo. Queda anotado cuando vuelve firmada.
  async function ldDdjj(id) {
    const ov = P.modal('Declaración jurada', '<div class="vacio">⏳ Buscando lo que cargó…</div>')
    const cuerpo = ov.querySelector('.pn-mod-cuerpo')
    const r = await fetch(`/api/panel/declaracion?lead_id=${id}`, { credentials: 'include' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { cuerpo.innerHTML = `<p style="color:var(--dan);margin:0">${P.esc(d.error || 'Error ' + r.status)}</p>`; return }
    const L = d.lead
    const visor = L.tieneAdjunto
      ? `<iframe src="/api/socios/admin/solicitud-adjunto?email=${encodeURIComponent(L.email)}"
           style="width:100%;height:340px;border:1px solid var(--line);border-radius:4px;background:var(--bg2)"
           title="REPROCANN que mandó"></iframe>
         <p class="so-help" style="margin:6px 0 0">Chequeá que diga <b>autocultivo</b> y que esté aprobado.</p>`
      : '<p class="so-help" style="margin:0">No mandó adjunto.</p>'

    cuerpo.innerHTML = `
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;align-items:start">
        <div>${visor}</div>
        <div style="display:grid;gap:6px">
          <div><label class="lb" for="dj-nom">Nombre completo</label>
            <input class="input" id="dj-nom" value="${P.esc(L.nombre || '')}" /></div>
          <div><label class="lb" for="dj-dni">DNI</label>
            <input class="input" id="dj-dni" inputmode="numeric" maxlength="10" value="${P.esc(L.dni || '')}"
              placeholder="${L.dni ? '' : 'no lo cargó, pedíselo'}" /></div>
          <div><label class="lb" for="dj-dom">Domicilio</label>
            <input class="input" id="dj-dom" placeholder="Calle y número" /></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            <div><label class="lb" for="dj-loc">Localidad</label><input class="input" id="dj-loc" /></div>
            <div><label class="lb" for="dj-prov">Provincia</label><input class="input" id="dj-prov" value="Neuquén" /></div>
          </div>
          <div><label class="lb" for="dj-diag">Diagnóstico</label>
            <input class="input" id="dj-diag" maxlength="300" placeholder="…acredita la existencia de ___" /></div>
          <p class="so-help" style="margin:0">Firma ${P.esc(d.plantilla.medico)} (${P.esc(d.plantilla.matricula)}) como director médico.</p>
        </div>
      </div>
      <div class="pn-mod-acciones">
        ${L.telefono ? `<a class="btn" id="dj-wa" target="_blank" rel="noopener" href="#">Abrir WhatsApp</a>` : ''}
        <button class="btn btn-pri" id="dj-gen" type="button">Generar y descargar</button>
      </div>
      <p class="msg" id="dj-msg" style="margin:8px 0 0"></p>`

    const msg = cuerpo.querySelector('#dj-msg')
    const wa = cuerpo.querySelector('#dj-wa')
    if (wa) {
      const nom = String(L.nombre || '').split(' ')[0]
      wa.href = `https://wa.me/${String(L.telefono).replace(/\D/g, '')}?text=${encodeURIComponent(
        `Hola ${nom}! Te paso la declaración jurada para que puedas pasarte a Flora. Es el papel que pide el registro cuando alguien deja el autocultivo y se vincula a una asociación: no se pueden tener las dos modalidades a la vez.\n\nImprimila, firmala y mandanos una foto. Con eso seguimos nosotros el trámite.`)}`
    }
    cuerpo.querySelector('#dj-gen').addEventListener('click', async (ev) => {
      const val = (sel) => cuerpo.querySelector(sel).value.trim()
      ev.target.disabled = true
      msg.className = 'msg'; msg.textContent = '⏳ armando el documento…'
      const res = await fetch('/api/panel/declaracion', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: id, nombre: val('#dj-nom'), dni: val('#dj-dni'), domicilio: val('#dj-dom'),
          localidad: val('#dj-loc'), provincia: val('#dj-prov'), diagnostico: val('#dj-diag'),
        }),
      })
      const dd = await res.json().catch(() => ({}))
      ev.target.disabled = false
      if (!res.ok) { msg.className = 'msg err'; msg.textContent = '✗ ' + (dd.error || 'no se pudo'); return }
      const w = window.open('', '_blank')
      if (w) { w.document.write(dd.html); w.document.close() }
      msg.className = 'msg ok'
      msg.textContent = w ? '✔ listo — imprimí o guardá como PDF desde la pestaña que se abrió'
        : '✔ generada, pero el navegador bloqueó la pestaña: permitila y probá de nuevo'
    })
  }

  // PATCH genérico de un lead. Devuelve {ok, error} y avisa al caller con
  // `cb`: el kanban de Inicio decide cómo refrescarse.
  async function ldPatch(id, body, cb) {
    const r = await fetch('/api/panel/leads', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Number(id), ...body }),
    })
    const d = r.ok ? {} : await r.json().catch(() => ({}))
    if (r.ok && cb) { try { cb() } catch { /* el refresco nunca rompe la acción */ } }
    return { ok: r.ok, error: d.error || null }
  }

  function ldNuevo(cb) {
    const ov = P.modal('Lead nuevo', `
      <div style="display:grid;gap:10px">
        <div><label class="lb" for="ld-n-nombre">Nombre</label><input class="input" id="ld-n-nombre" /></div>
        <div class="grid2">
          <div><label class="lb" for="ld-n-tel">Teléfono</label><input class="input" id="ld-n-tel" placeholder="+54 9 299…" /></div>
          <div><label class="lb" for="ld-n-email">Email (si lo tenés)</label><input class="input" id="ld-n-email" type="email" /></div>
        </div>
        <div><label class="lb" for="ld-n-nota">Nota</label><input class="input" id="ld-n-nota" placeholder="De dónde salió, qué busca…" /></div>
        <div class="fila"><span class="pn-sp"></span><button class="btn btn-pri" id="ld-n-ok" type="button">Crear lead</button></div>
        <p class="msg" id="ld-n-msg"></p>
      </div>`)
    ov.querySelector('#ld-n-ok').addEventListener('click', async () => {
      const msg = ov.querySelector('#ld-n-msg')
      msg.className = 'msg'; msg.textContent = '⏳ creando…'
      const r = await fetch('/api/panel/leads', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: ov.querySelector('#ld-n-nombre').value.trim(),
          telefono: ov.querySelector('#ld-n-tel').value.trim(),
          email: ov.querySelector('#ld-n-email').value.trim(),
          nota: ov.querySelector('#ld-n-nota').value.trim(),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { msg.className = 'msg err'; msg.textContent = '✗ ' + (d.error || 'error'); return }
      P.cerrarModal()
      if (cb) { try { cb() } catch { /* nada */ } }
    })
  }

  /* ============ registro del módulo ============ */
  P.registrar('socios', {
    init(el) {
      cont = el
      editar = P.puede('padron_editar')
      el.innerHTML = `
        <div class="subs" id="so-subs">
          <button type="button" class="on" data-sub="maestra">Socios</button>
          ${P.puede('reprocann_editar') ? '<button type="button" data-sub="unificar">Unificar<span class="cnt" id="ru-cnt" hidden style="margin-left:6px"></span></button>' : ''}
        </div>

        <div id="so-maestra">
          ${editar ? `
          <div class="card" style="margin-bottom:10px">
            <div class="fila"><span class="k">Socio nuevo</span><span class="pn-sp"></span>
              ${P.puede('reprocann_editar') ? `<button class="btn" id="so-convertir" type="button"
                title="Subís el PDF de su certificado y sale la ficha + la declaración jurada lista para firmar">🌱 Convertir autocultivador</button>` : ''}
              <button class="btn btn-pri" id="so-alta-completa" type="button">+ Dar de alta</button></div>
            <p class="so-help">El alta completa: acceso a la carta, ficha en el padrón, membresía y el primer cobro
            — todo de una vez. Si dejó una solicitud web, sus datos vienen precargados.</p>
          </div>
          <details class="card" style="margin-bottom:10px">
            <summary style="cursor:pointer;font-size:13px;color:var(--muted);font-weight:600">Alta rápida (solo acceso a la carta)</summary>
            <p class="so-help" style="margin-top:10px">Le da acceso a la carta pero NO le crea ficha en el padrón.</p>
            <form id="so-alta" class="fila so-alta">
              <input class="input" id="so-alta-email" type="email" required placeholder="email@gmail.com" autocomplete="off" />
              <input class="input" id="so-alta-nota" type="text" placeholder="Nota (ej. Gastón — WhatsApp)" autocomplete="off" />
              <button class="btn btn-pri" type="submit">Agregar socio</button>
              <span id="so-alta-msg" class="msg"></span>
            </form>
          </details>` : ''}
          <div id="mu-tiles"></div>
          <div id="mu-sugerencias"></div>
          <div class="card">
            <div class="fila" style="flex-wrap:wrap">
              <input class="input" id="mu-buscar" type="search" placeholder="Buscar por nombre, email, DNI, código…" autocomplete="off" style="max-width:300px" />
              <div id="mu-chips" class="fila" style="flex-wrap:wrap"></div>
              <div id="mu-chips-rc" class="fila" style="flex-wrap:wrap;flex-basis:100%;margin-top:6px;gap:4px"></div>
              <span class="pn-sp"></span>
              <span id="mu-total" style="color:var(--muted);font-size:12px"></span>
              <span id="so-msg" class="msg"></span>
            </div>
            <div id="mu-lista" style="margin-top:10px"><div class="vacio">⏳ Cargando…</div></div>
          </div>
        </div>

        <div id="so-unificar" hidden>
          <p class="so-help" style="max-width:78ch;margin:0 0 12px">El volcado oficial del portal de REPROCANN
          (cuenta de la ONG): actualiza solo a los vinculados y propone pares para confirmar. Nada se une sin tu click.</p>
          <div id="ru-panel"></div>
        </div>`

      // precarga del alta que llega desde Unificar ("Dar de alta")
      try {
        const pre = JSON.parse(sessionStorage.getItem('so-alta-prefill') || 'null')
        if (pre && editar) { /* se consume dentro de altaAbrir */ }
      } catch { /* nada */ }
      if (editar && sessionStorage.getItem('so-alta-prefill')) altaAbrir()
      window.addEventListener('so-alta-prefill', () => {
        if (editar && sessionStorage.getItem('so-alta-prefill')) altaAbrir()
      })

      // sub-tabs
      el.querySelector('#so-subs').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-sub]')
        if (!b) return
        el.querySelectorAll('#so-subs button').forEach((x) => x.classList.toggle('on', x === b))
        el.querySelector('#so-maestra').hidden = b.dataset.sub !== 'maestra'
        const uni = el.querySelector('#so-unificar')
        if (uni) uni.hidden = b.dataset.sub !== 'unificar'
        if (b.dataset.sub === 'unificar') ruCargar()
        if (b.dataset.sub === 'maestra') muCargar()
        guardarNav(b.dataset.sub)
      })

      el.querySelector('#mu-buscar').addEventListener('input', (e) => {
        muQ = e.target.value.trim().toLowerCase()
        muRender()
        el.querySelector('#mu-buscar').focus()
      })

      const altaBtn = el.querySelector('#so-alta-completa')
      if (altaBtn) altaBtn.addEventListener('click', () => altaAbrir())
      const convBtn = el.querySelector('#so-convertir')
      if (convBtn) convBtn.addEventListener('click', () => cvAbrir())
      const altaForm = el.querySelector('#so-alta')
      if (altaForm) altaForm.addEventListener('submit', onAlta)

      // delegación de clicks del módulo
      el.addEventListener('click', async (e) => {
        // tiles y chips = filtros de la misma lista
        const tile = e.target.closest('.mu-tile')
        if (tile) { muFiltro = muFiltro === tile.dataset.f ? '' : tile.dataset.f; muRender(); return }
        const agr = e.target.closest('#mu-agrupar')
        if (agr) { muAgrupar = !muAgrupar; muRender(); return }
        const chip = e.target.closest('#mu-chips .chip, #mu-chips-rc .chip')
        if (chip && chip.dataset.f !== undefined) {
          muFiltro = muFiltro === chip.dataset.f ? '' : chip.dataset.f
          muRender()
          return
        }
        // sugerencias de email
        const sug = e.target.closest('.mu-sug')
        if (sug) {
          const r = await fetch('/api/panel/padron/sugerencia', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ socio_id: Number(sug.dataset.id), aceptar: !!sug.dataset.ok }),
          })
          const d = await r.json().catch(() => ({}))
          aviso(r.ok ? (d.aplicado ? '✔ email vinculado' : 'descartado') : '✗ ' + (d.error || 'error'), r.ok ? 'ok' : 'err')
          muCargar(true)
          return
        }
        // sugerencias de cruce carta↔ficha (huérfano con nombre parecido)
        const sc = e.target.closest('.mu-sugcarta')
        if (sc) {
          if (!sc.dataset.ok) {
            try {
              const v = JSON.parse(sessionStorage.getItem('so-cruces-no') || '[]')
              v.push(sc.dataset.id + ':' + sc.dataset.email)
              sessionStorage.setItem('so-cruces-no', JSON.stringify(v))
            } catch { /* nada */ }
            muRender()
            return
          }
          const r = await fetch('/api/panel/padron/socio', {
            method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: Number(sc.dataset.id), email: sc.dataset.email }),
          })
          const d = await r.json().catch(() => ({}))
          aviso(r.ok ? '✔ unidos: el email quedó en la ficha' : '✗ ' + (d.error || 'error'), r.ok ? 'ok' : 'err')
          muCargar(true)
          return
        }
        // crear ficha para un huérfano solo-carta
        const crear = e.target.closest('.mu-crear')
        if (crear) {
          sessionStorage.setItem('so-alta-prefill', JSON.stringify({
            email: crear.dataset.email, nombre: crear.dataset.nombre,
            telefono: crear.dataset.tel, nota: crear.dataset.nota,
          }))
          altaAbrir()
          return
        }
        // link de pago rápido desde la fila
        const mp = e.target.closest('.mu-mp')
        if (mp) {
          window.PanelSocioDetalle.modalDebito({ id: Number(mp.dataset.id), nombre: mp.dataset.nombre, telefono: mp.dataset.tel })
          return
        }
        // papelera: selección múltiple y acciones
        if (e.target.id === 'mu-check-all') {
          const on = e.target.checked
          cont.querySelectorAll('.mu-check').forEach((c) => { c.checked = on })
          const n = cont.querySelector('#mu-sel-n')
          if (n) n.textContent = cont.querySelectorAll('.mu-check:checked').length
          return
        }
        if (e.target.classList && e.target.classList.contains('mu-check')) {
          const n = cont.querySelector('#mu-sel-n')
          if (n) n.textContent = cont.querySelectorAll('.mu-check:checked').length
          return
        }
        const bulk = e.target.closest('.mu-papelera-bulk')
        if (bulk) {
          const ids = [...cont.querySelectorAll('.mu-check:checked')].map((c) => Number(c.dataset.id))
          if (!ids.length) { aviso('Marcá al menos una ficha', 'err'); return }
          if (!(await P.confirmar(`¿Mandar ${ids.length} ficha(s) a la papelera? Desaparecen de todas las vistas pero se pueden restaurar cuando quieras.`, 'Sí, a la papelera'))) return
          const r = await fetch('/api/panel/padron/papelera', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, accion: 'mandar' }),
          })
          aviso(r.ok ? `✔ ${ids.length} a la papelera` : '✗ no se pudo', r.ok ? 'ok' : 'err')
          muCargar(true)
          return
        }
        const rest = e.target.closest('.mu-restaurar')
        if (rest) {
          const r = await fetch('/api/panel/padron/papelera', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [Number(rest.dataset.id)], accion: 'restaurar' }),
          })
          aviso(r.ok ? '✔ restaurado' : '✗ no se pudo', r.ok ? 'ok' : 'err')
          muCargar(true)
          return
        }
        const purg = e.target.closest('.mu-purgar')
        if (purg) {
          if (!(await P.confirmar(`BORRAR DEFINITIVAMENTE a ${purg.dataset.nombre}. Solo se puede si no tiene ningún pago, retiro ni trámite — si tiene historia, queda en la papelera. ¿Seguro?`, 'Sí, borrar'))) return
          const r = await fetch('/api/panel/padron/purgar', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: Number(purg.dataset.id) }),
          })
          const d = await r.json().catch(() => ({}))
          aviso(r.ok ? '✔ borrado definitivo' : '✗ ' + (d.error || 'no se pudo'), r.ok ? 'ok' : 'err', 9000)
          muCargar(true)
          return
        }
        // abrir la ficha 360° (el WhatsApp no la abre)
        if (e.target.closest('.mu-wa')) return
        const fila = e.target.closest('.mu-fila')
        if (fila && fila.dataset.id) {
          window.PanelSocioDetalle.abrir(Number(fila.dataset.id), () => muCargar(true))
          return
        }
        // unificar pacientes (ru-)
        const si = e.target.closest('.ru-si')
        if (si) {
          if (si.dataset.cuidado && !confirm('Los datos no coinciden del todo. ¿Vincular igual?')) return
          ruDecidir({ dni: si.dataset.dni, socio_id: Number(si.dataset.socio), aceptar: true }, si); return
        }
        const no = e.target.closest('.ru-no')
        if (no) { ruDecidir({ dni: no.dataset.dni, socio_id: Number(no.dataset.socio), aceptar: false }, no); return }
        const ning = e.target.closest('.ru-ninguno')
        if (ning) { ruDecidir({ dni: ning.dataset.dni, rechazar_socio_ids: ning.dataset.socios.split(',').map(Number) }, ning); return }
        const altaRu = e.target.closest('.ru-alta')
        if (altaRu) {
          const p = (ruDatos && ruDatos.sinMatch || []).find((x) => x.dni === altaRu.dataset.dni)
          if (!p) return
          const PASO = { Aprobado: 'aprobado', PendienteEvaluacion: 'en_evaluacion', PendienteVinculacionCultivador: 'cargado', PendienteConsentimientoPaciente: 'cargado', PendienteConsentimiento: 'cargado', ObservadoPorPaciente: 'cargado', PendienteRevisionMedica: 'en_evaluacion' }
          sessionStorage.setItem('so-alta-prefill', JSON.stringify({
            nombre: `${p.nombre} ${p.apellido}`.trim(), documento: p.dni,
            reprocann_estado: PASO[p.estado] || 'esperando_codigo', reprocann_vence: p.vence || '',
          }))
          altaAbrir()
          return
        }
      })

      // badge de pares pendientes de Unificar, sin abrir la pestaña
      if (editar) {
        fetch('/api/panel/reprocann/unificar', { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (!d) return
            ruDatos = d
            const cnt = el.querySelector('#ru-cnt')
            if (cnt) { cnt.hidden = !d.pares.length; cnt.textContent = d.pares.length }
          })
          .catch(() => { /* sin red no hay badge */ })
      }

      muCargar()
      // volver al sub-tab donde estaba (regla F5 de la casa). La pestaña
      // Leads ya no existe: su tablero vive en el kanban de Inicio, así que
      // un `sub:'leads'` guardado manda para allá.
      try {
        const nav = JSON.parse(sessionStorage.getItem('so-nav') || '{}')
        if (nav.sub === 'leads') {
          nav.sub = 'maestra'
          sessionStorage.setItem('so-nav', JSON.stringify(nav))
          P.ir('inicio')
        } else if (nav.sub && nav.sub !== 'maestra') {
          const b = el.querySelector(`#so-subs button[data-sub="${nav.sub}"]`)
          if (b) b.click()
        }
        const busca = el.querySelector('#mu-buscar')
        if (busca && muQ) busca.value = muQ
      } catch { /* nada */ }
    },
  })

  /* ============ API pública: window.PanelLeads ============ */
  // El kanban de Inicio absorbió el tablero de Leads (decisión 08/08). Estas
  // son las piezas vivas del embudo: los modales existentes (alta completa,
  // + Lead, conversión, DDJJ) y las acciones sueltas del viejo menú ⋯, sin
  // nada de render. Todo callback `cb` es "refrescate": lo pone el kanban.
  window.PanelLeads = {
    // + Lead (alta manual): mismo modal de siempre
    nuevoLead: (cb) => ldNuevo(cb),

    // Alta completa desde un lead: precarga la ficha (y trae el DNI de su
    // solicitud, que no vive en el lead) y abre el asistente de siempre.
    async darDeAlta(lead, cb) {
      const pre = { nombre: lead.nombre || '', email: lead.email || '', telefono: lead.telefono || '', nota: lead.nota || '' }
      try {
        const rd = await fetch(`/api/panel/declaracion?lead_id=${lead.id}`, { credentials: 'include' })
        if (rd.ok) { const dd = await rd.json(); if (dd.lead?.dni) pre.documento = dd.lead.dni }
      } catch { /* sin DNI se completa a mano, el alta sigue igual */ }
      sessionStorage.setItem('so-alta-prefill', JSON.stringify(pre))
      altaCb = cb || null
      altaAbrir()
    },

    // Convertir al aspirante con su credencial ya subida (asistente cv-)
    convertir(lead, cb) {
      if (!lead || !lead.email) return
      cvCb = cb || null
      cvAbrir({ email: lead.email, nombre: lead.nombre || '', telefono: lead.telefono || '', reprocann: lead.reprocann || null })
    },

    // Declaración jurada directo desde el lead (modal existente)
    ddjj: (id) => ldDdjj(id),

    // Acciones del embudo (el menú ⋯ del kanban las llama)
    avanzarEtapa: (id, etapa, cb) => ldPatch(id, { etapa }, cb),
    marcarPerdido: (id, cb) => ldPatch(id, { etapa: 'perdido' }, cb),
    guardarNota: (id, nota, cb) => ldPatch(id, { nota: String(nota || '').slice(0, 300) }, cb),

    async borrar(lead, cb) {
      const quien = lead.nombre || lead.email || 'este lead'
      const yaEsSocio = lead.etapa === 'convertido'
      const texto = yaEsSocio
        ? `¿Sacar a ${quien} del embudo?\n\nDesaparece esta tarjeta y el rastro de por dónde entró.\n\nSu ficha de socio NO se toca: sigue en el padrón con todo lo suyo.`
        : `¿Borrar a ${quien} del todo?\n\nSe va la tarjeta, su solicitud y el archivo que hubiera subido. No se puede recuperar.\n\nSi es alguien real que no cerró, mejor marcalo como Perdido.`
      if (!(await P.confirmar(texto, yaEsSocio ? 'Sí, sacar' : 'Sí, borrar'))) return { ok: false, cancelado: true }
      const r = await fetch('/api/panel/leads', {
        method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lead.id, forzar: yaEsSocio }),
      })
      const d = r.ok ? {} : await r.json().catch(() => ({}))
      if (r.ok && cb) { try { cb() } catch { /* nada */ } }
      return { ok: r.ok, error: d.error || null }
    },

    // Acceso de prueba a la carta por 7 días, sin dejar de ser lead
    async accesoCarta(lead, cb) {
      if (!lead.email) return { ok: false, error: 'sin email' }
      if (!(await P.confirmar(
        `¿Darle a ${lead.nombre || lead.email} acceso de prueba a la carta por 7 días?\n\nLe llega un mail avisándole. Los 7 días arrancan recién en su primer ingreso.`,
        'Sí, dar acceso'))) return { ok: false, cancelado: true }
      const hoy = new Date().toLocaleDateString('es-AR')
      const res = await saveSocio(lead.email, 'Acceso de prueba (7 días desde el primer login) · desde Leads', {
        name: lead.nombre || '', telefono: lead.telefono || '', temporal: true, temporal_dias: 7,
      })
      if (!res.ok) return { ok: false, error: res.error || 'no se pudo dar el acceso' }
      // rastro en la nota, la marca adelante (el server corta en 300)
      const marca = `Acceso carta 7 días (${hoy})`
      await ldPatch(lead.id, { nota: (marca + (lead.nota ? ' · ' + lead.nota : '')).slice(0, 300) }, cb)
      return { ok: true, mailEnviado: res.mailEnviado !== false, mailError: res.mailError || null }
    },

    whatsappDe(lead) {
      const tel = digitsOnly(lead.telefono)
      if (!tel) return null
      const nom = String(lead.nombre || '').split(' ')[0]
      const saludo = nom ? `Hola ${nom}! ` : 'Hola! '
      return `https://wa.me/${tel}?text=${encodeURIComponent(saludo + 'Te escribimos de Flora 🌿')}`
    },

    // Helpers de render que las cards del kanban reusan tal cual
    ui: { badgeOrigen: ldBadgeOrigen, chipPago: ldChipPago, chipReprocann: ldChipReprocann, turnoLinea: ldTurnoLinea },
  }
})()
