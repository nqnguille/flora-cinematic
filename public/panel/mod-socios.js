/* Módulo Socios (prefijo so-): padrón del club + solicitudes de acceso.
   Porteo del panel viejo (/socios/admin/) — mismos endpoints, UI nueva.
   Solo lectura si el rol no tiene la capacidad padron_editar. */
(() => {
  'use strict'
  const P = window.Panel

  // Endpoints existentes (los mismos del panel viejo)
  const EP_SOCIOS = '/api/socios/admin/socios'
  const EP_INTENTOS = '/api/socios/admin/intentos'
  const EP_SOLICITUDES = '/api/socios/admin/solicitudes'

  let cont = null
  let editar = false          // capacidad padron_editar
  let SOCIOS = []
  let SOLICITUDES = []        // formulario web + intentos de login, mezclados
  let orden = { key: 'lastLogin', dir: -1 } // arranca por actividad reciente
  let filtro = ''             // '' (todos) | 'activos30' | 'sin'
  let q = ''

  const FILTROS = {
    activos30: (s) => s.lastLogin && Date.now() - Date.parse(s.lastLogin) < 30 * 86400000,
    sin: (s) => !s.lastLogin,
  }
  const ORDENES = {
    // null/ausente al final, gane quien gane la dirección
    lastLogin: (a, b) => (Date.parse(b.lastLogin || 0) || 0) - (Date.parse(a.lastLogin || 0) || 0),
    nombre: (a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email), 'es'),
    email: (a, b) => String(a.email || '').localeCompare(String(b.email || ''), 'es'),
    alta: (a, b) => (Date.parse(b.alta || b.firstLogin || 0) || 0) - (Date.parse(a.alta || a.firstLogin || 0) || 0),
    logins: (a, b) => (b.logins || 0) - (a.logins || 0),
  }

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

  /* ---------- padrón ---------- */
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
    if (!s.tempExpiraEn) return ' <span class="tag tag-deb" title="Las 24hs corren desde su primer ingreso">Prueba sin usar</span>'
    const ms = new Date(s.tempExpiraEn).getTime() - Date.now()
    if (ms <= 0) return ` <span class="tag tag-mal" title="Venció ${P.esc(fmtFecha(s.tempExpiraEn))}">Prueba vencida</span>`
    const h = Math.max(1, Math.round(ms / 3600000))
    return ` <span class="tag tag-deb" title="Vence ${P.esc(fmtFecha(s.tempExpiraEn))}">Prueba · vence en ${h}h</span>`
  }
  function estadoHtml(s) {
    const base = s.lastLogin
      ? `<span class="tag tag-ok" title="Último ingreso: ${P.esc(fmtFecha(s.lastLogin))}">Activo ${P.esc(fmtRel(s.lastLogin))}</span>`
      : '<span class="tag tag-off">Sin ingresar</span>'
    return base + tempTag(s)
  }

  function filaSocio(s) {
    const nombre = s.name || [s.givenName, s.familyName].filter(Boolean).join(' ')
    // WhatsApp: con teléfono va directo; sin teléfono y sin ingreso, link
    // genérico de invitación (abre WhatsApp para elegir el contacto a mano).
    const waMsg = `Hola! Ya sos socio de Flora. Entrá a la carta del club con tu cuenta de Google (${s.email}): https://floraong.ar/socios/carta/`
    const dig = digitsOnly(s.telefono)
    const waHref = dig
      ? `https://wa.me/${dig}${s.lastLogin ? '' : '?text=' + encodeURIComponent(waMsg)}`
      : (s.lastLogin ? '' : 'https://wa.me/?text=' + encodeURIComponent(waMsg))
    const wa = waHref
      ? `<a class="so-wa" target="_blank" rel="noopener" href="${P.esc(waHref)}" title="${dig ? 'Enviar WhatsApp' : 'Invitar por WhatsApp'}">${ICON_WA}</a>`
      : ''
    const tel = editar
      ? `<input class="input so-tel" data-email="${P.esc(s.email)}" value="${P.esc(s.telefono || '')}" placeholder="+54 9 ..." />`
      : `<span>${P.esc(s.telefono || '—')}</span>`
    const nota = editar
      ? `<input class="input so-nota-in" data-email="${P.esc(s.email)}" value="${P.esc(s.nota || '')}" placeholder="Nota…" />`
      : `<span style="color:var(--ink2)">${P.esc(s.nota || '—')}</span>`
    return `<tr>
      <td><div class="fila"><span class="av">${P.esc(P.iniciales(nombre || s.email))}</span>
        <span style="font-weight:600;white-space:nowrap">${P.esc(nombre || '(sin nombre aún)')}</span></div></td>
      <td style="color:var(--ink2)">${P.esc(s.email)}</td>
      <td><div class="fila so-telcell">${tel}${wa}</div></td>
      <td style="white-space:nowrap">${estadoHtml(s)}</td>
      <td style="color:var(--muted);white-space:nowrap" title="${s.firstLogin ? 'Primer ingreso: ' + P.esc(fmtFecha(s.firstLogin)) : ''}">${s.alta ? P.esc(fmtFecha(s.alta).split(' ')[0]) : '—'}</td>
      <td class="r">${s.logins ? P.fmtN(s.logins) : '<span style="color:var(--muted)">—</span>'}</td>
      <td>${nota}</td>
      ${editar ? `<td class="r"><button class="btn btn-peligro so-del" data-email="${P.esc(s.email)}" type="button">Quitar</button></td>` : ''}
    </tr>`
  }

  function renderPadron() {
    // sub-stats clicables (filtran al tocarlas; tocar la activa la limpia)
    const activos30 = SOCIOS.filter(FILTROS.activos30).length
    const sin = SOCIOS.filter(FILTROS.sin).length
    const chip = (f, html, title) =>
      `<button type="button" class="chip${filtro === f ? ' on' : ''}" data-filtro="${f}" title="${P.esc(title)}">${html}</button>`
    cont.querySelector('#so-stats').innerHTML = [
      chip('', `<strong>${P.fmtN(SOCIOS.length)}</strong> socios`, 'Ver todos'),
      chip('activos30', `<strong>${P.fmtN(activos30)}</strong> activos últimos 30 días`, 'Solo los que entraron este mes'),
      chip('sin', `<strong>${P.fmtN(sin)}</strong> sin ingresar`, 'Solo los que nunca entraron'),
    ].join('')

    let lista = [...SOCIOS].sort(ORDENES[orden.key])
    if (orden.dir === 1) lista.reverse()
    if (filtro && FILTROS[filtro]) lista = lista.filter(FILTROS[filtro])
    if (q) {
      lista = lista.filter((s) =>
        `${s.name || ''} ${s.givenName || ''} ${s.familyName || ''} ${s.email} ${s.nota || ''} ${s.telefono || ''}`.toLowerCase().includes(q))
    }

    const el = cont.querySelector('#so-lista')
    if (!lista.length) {
      el.innerHTML = `<div class="vacio">${q || filtro ? 'Ningún socio coincide con ese filtro.' : 'Todavía no hay socios cargados.'}</div>`
      return
    }
    const COLS = [
      ['nombre', 'Socio'], ['email', 'Email'], [null, 'Teléfono'], ['lastLogin', 'Estado'],
      ['alta', 'Alta'], ['logins', 'Ingresos', 'r'], [null, 'Nota'],
    ]
    if (editar) COLS.push([null, '', 'r'])
    const ths = COLS.map(([key, label, cls]) => {
      if (!key) return `<th${cls ? ` class="${cls}"` : ''}>${label}</th>`
      const on = orden.key === key
      const flecha = on ? (orden.dir === -1 ? ' ↓' : ' ↑') : ''
      return `<th${cls ? ` class="${cls}"` : ''}><button type="button" class="so-th${on ? ' on' : ''}" data-sort="${key}">${label}${flecha}</button></th>`
    }).join('')
    el.innerHTML = `<div class="so-scroll"><table class="tabla">
      <thead><tr>${ths}</tr></thead>
      <tbody>${lista.map(filaSocio).join('')}</tbody></table></div>`
  }

  async function cargarSocios() {
    const el = cont.querySelector('#so-lista')
    if (!SOCIOS.length) el.innerHTML = '<div class="vacio">⏳ Cargando…</div>'
    try {
      const res = await fetch(EP_SOCIOS, { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) { el.innerHTML = `<div class="vacio">${P.esc(data.error || errHttp(res.status))}</div>`; return }
      SOCIOS = data.socios || []
      renderPadron()
    } catch {
      el.innerHTML = '<div class="vacio">Error de red al cargar el padrón — revisá la conexión y probá de nuevo.</div>'
    }
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
          <button class="btn so-sol-temp" data-email="${P.esc(i.email)}" data-name="${P.esc(i.name || '')}" type="button">Aprobar temporal 24h</button>
          <button class="btn btn-peligro so-sol-del" data-email="${P.esc(i.email)}" data-tipo="${P.esc(i.tipo)}" type="button">Descartar</button>
        </div>`
      : ''
    return `<div class="so-sol">
      <span class="av">${P.esc(P.iniciales(i.name || i.email))}</span>
      <div class="so-sol-main">
        <div class="fila" style="flex-wrap:wrap;gap:8px">
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

  async function descartarSolicitud(email, item) {
    await fetch(endpointDe(item), {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
  }

  /* ---------- acciones ---------- */
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
    if (ok) { emailEl.value = ''; notaEl.value = ''; cargarSocios() }
    setTimeout(() => { msg.textContent = ''; msg.className = 'msg' }, 6000)
  }

  async function onClick(e) {
    // ordenar por columna
    const th = e.target.closest('.so-th')
    if (th) {
      const key = th.dataset.sort
      if (orden.key === key) orden.dir *= -1
      else orden = { key, dir: -1 }
      renderPadron()
      return
    }
    // sub-stats como filtros
    const chip = e.target.closest('#so-stats .chip')
    if (chip) {
      const f = chip.dataset.filtro
      filtro = filtro === f ? '' : f
      renderPadron()
      return
    }
    // quitar socio
    const del = e.target.closest('.so-del')
    if (del) {
      const email = del.dataset.email
      if (!(await P.confirmar(`¿Dar de baja a ${email}? Deja de poder entrar a la carta.`, 'Sí, dar de baja'))) return
      const res = await fetch(EP_SOCIOS, {
        method: 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) { aviso('✗ ' + errHttp(res.status), 'err'); return }
      aviso('✔ socio dado de baja', 'ok')
      cargarSocios()
      return
    }
    // solicitud → agregar como socio
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
        await descartarSolicitud(email, item)
        avisoSol('✔ agregado al padrón', 'ok')
        cargarSocios(); cargarSolicitudes()
      } else {
        add.disabled = false
        add.textContent = 'Agregar como socio'
        avisoSol(`✗ ${error || 'no se pudo agregar'} — probá de nuevo`, 'err')
      }
      return
    }
    // solicitud → acceso temporal 24h
    const temp = e.target.closest('.so-sol-temp')
    if (temp) {
      const email = temp.dataset.email
      const name = temp.dataset.name || ''
      const item = SOLICITUDES.find((i) => i.email === email)
      if (!(await P.confirmar(`¿Darle a ${name || email} acceso temporal de 24hs a la carta? Le llega un mail avisándole que ya puede entrar.`, 'Sí, aprobar'))) return
      temp.disabled = true
      temp.textContent = 'Aprobando…'
      const { ok, error, mailEnviado, mailError } = await saveSocio(email, 'Acceso temporal (24h desde el primer login)', { name, temporal: true })
      if (ok) {
        await descartarSolicitud(email, item)
        cargarSocios(); cargarSolicitudes()
        if (mailEnviado === false) {
          // El alta pegó, pero el mail no salió — avisamos fuerte: si no,
          // parece que ya le llegó y nadie le escribe.
          avisoSol(`Se aprobó, pero el mail NO salió (${mailError || 'error desconocido'}) — avisale vos por WhatsApp.`, 'err', 12000)
        } else {
          avisoSol('✔ acceso temporal aprobado y mail enviado', 'ok')
        }
      } else {
        temp.disabled = false
        temp.textContent = 'Aprobar temporal 24h'
        avisoSol(`✗ ${error || 'no se pudo aprobar'} — probá de nuevo`, 'err')
      }
      return
    }
    // solicitud → descartar
    const desc = e.target.closest('.so-sol-del')
    if (desc) {
      const email = desc.dataset.email
      const item = SOLICITUDES.find((i) => i.email === email)
      if (!(await P.confirmar(`¿Descartar la solicitud de ${email}?`, 'Sí, descartar'))) return
      await descartarSolicitud(email, item)
      cargarSolicitudes()
    }
  }

  async function onChange(e) {
    const tel = e.target.closest('.so-tel')
    if (tel) {
      aviso('⏳ guardando teléfono…')
      const email = tel.dataset.email
      const nuevo = tel.value.trim()
      const { ok, error } = await saveSocio(email, undefined, { telefono: nuevo })
      aviso(ok ? '✔ teléfono guardado' : `✗ ${error || 'no se pudo guardar el teléfono'}`, ok ? 'ok' : 'err')
      if (ok) {
        // refresca el link de WhatsApp de la fila sin pisar lo tipeado
        const socio = SOCIOS.find((x) => x.email === email)
        if (socio) socio.telefono = nuevo
        renderPadron()
      }
      return
    }
    const nota = e.target.closest('.so-nota-in')
    if (nota) {
      aviso('⏳ guardando nota…')
      const { ok, error } = await saveSocio(nota.dataset.email, nota.value)
      aviso(ok ? '✔ nota guardada' : `✗ ${error || 'no se pudo guardar la nota'}`, ok ? 'ok' : 'err')
      const socio = SOCIOS.find((x) => x.email === nota.dataset.email)
      if (ok && socio) socio.nota = nota.value
    }
  }

  /* ---------- registro ---------- */
  // ============ Alta unificada (al-): un socio, de una sola vez ============
  // Crea acceso a la carta (KV) + ficha financiera (D1) + membresía, con
  // precarga desde la solicitud web y cobro opcional en el mismo acto.
  const ALTA_PASOS = ['Quién es', 'Membresía', 'Listo']

  function altaAbrir() {
    let paso = 1
    let tarifas = []
    let datos = { email: '', nombre: '', telefono: '', reprocann_estado: 'esperando_codigo', reprocann_codigo: '', reprocann_vence: '', nota: '', tier: 'NINGUNA' }

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
              placeholder="13 caracteres, se lo da su cuenta de Mi Argentina" style="letter-spacing:.08em;text-transform:uppercase" />
            <p class="so-help" style="margin:6px 0 0">Si todavía no te lo pasó, dejalo vacío: al terminar te damos el link para pedírselo.</p>`
        } else if (e === 'aprobado') {
          box.innerHTML = `<div class="grid2">
            <div><label class="lb" for="al-cod">Código de vinculación</label>
              <input class="input" id="al-cod" maxlength="13" value="${P.esc(datos.reprocann_codigo)}" placeholder="opcional" style="letter-spacing:.08em;text-transform:uppercase" /></div>
            <div><label class="lb" for="al-vence">Vence</label>
              <input class="input" id="al-vence" type="date" value="${P.esc(datos.reprocann_vence)}" /></div>
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
        datos.reprocann_estado = inputRepro.value
        const campoCod = cuerpo.querySelector('#al-cod')
        datos.reprocann_codigo = campoCod ? campoCod.value.trim().toUpperCase() : ''
        const campoVence = cuerpo.querySelector('#al-vence')
        datos.reprocann_vence = campoVence ? campoVence.value : ''
        if (datos.reprocann_codigo && datos.reprocann_codigo.length !== 13) {
          const aviso = cuerpo.querySelector('#al-precarga')
          aviso.className = 'msg err'; aviso.textContent = 'El código de vinculación tiene 13 caracteres.'; return
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
        avisos.push(`Dejó una solicitud web${d.solicitud.intent === 'acceso' ? ' (ya tiene REPROCANN)' : ' (pidió entrevista)'}${d.solicitud.adjunto ? ' con adjunto' : ''} — datos precargados.`)
        if (d.solicitud.intent === 'acceso') {
          const sel = cuerpo.querySelector('#al-repro')
          if (sel.value === 'esperando_codigo') { sel.value = 'aprobado'; sel.dispatchEvent(new Event('change')) }
        }
      }
      if (d.yaTieneAcceso) avisos.push('Ya tiene acceso a la carta.')
      if (d.yaTieneFicha) avisos.push(`Ya tiene ficha en el padrón (${P.esc(d.yaTieneFicha.nombre)}) — se completa, no se duplica.`)
      aviso.className = 'so-help'
      aviso.textContent = avisos.join(' ')
    }

    function pintar2() {
      const opciones = tarifas.length ? tarifas : [
        { item: 'SMALL', gramos: 10, contado: 200000, debito: 160000 },
        { item: 'MEDIUM', gramos: 20, contado: 360000, debito: 288000 },
        { item: 'LARGE', gramos: 30, contado: 480000, debito: 384000 },
        { item: 'EXTRA LARGE', gramos: 40, contado: 600000, debito: 480000 },
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
      cuerpo.innerHTML = `${pasosHtml()}
        <div class="card" style="box-shadow:none;background:var(--card2);margin-bottom:12px">
          <b>${P.esc(datos.nombre)}</b>
          <div style="color:var(--muted);font-size:12px;margin-top:2px">${P.esc(datos.email)}
          ${conMemb ? ` · ${P.esc(datos.tier)}` : ' · sin membresía'}</div>
        </div>
        ${conMemb ? `<p class="so-help" style="margin:0 0 10px">¿Cómo arranca?</p>
        <div class="grid2" style="gap:10px">
          <button class="btn al-fin" data-cobro="efectivo" type="button" style="padding:14px;text-align:left;height:auto">
            <b style="display:block">Cobré ${P.fmt(datos.precio || 0)}</b>
            <span style="color:var(--muted);font-weight:400;font-size:11.5px">Registra el pago y le habilita los gramos</span>
          </button>
          <button class="btn btn-pri al-fin" data-cobro="debito" type="button" style="padding:14px;text-align:left;height:auto">
            <b style="display:block">Mandarle el débito −20%</b>
            <span style="opacity:.85;font-weight:400;font-size:11.5px">Crea la suscripción y el link de WhatsApp</span>
          </button>
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
      // Alta hecha. Si pidió débito, encadenamos la suscripción.
      let extra = ''
      if (cobro === 'debito') {
        const rs = await fetch('/api/panel/mp/suscripcion', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ socio_id: d.socioId }),
        })
        const ds = await rs.json().catch(() => ({}))
        if (rs.ok) {
          const waDeb = `https://wa.me/${(datos.telefono || '').replace(/\D/g, '')}?text=${encodeURIComponent(
            `Hola ${datos.nombre.split(' ')[0]}! Ya sos socio de Flora 🌿 Te paso el link para activar el débito automático de tu membresía ${datos.tier} con el 20% de descuento: 3 cuotas de ${P.fmt(ds.monto)} por mes. Se autoriza una sola vez: ${ds.link}`)}`
          extra = `<div style="margin-top:12px"><span class="k">Link del débito</span>
            <input class="input" value="${P.esc(ds.link)}" readonly onclick="this.select()" style="margin-top:6px" />
            <a class="btn btn-pri" href="${P.esc(waDeb)}" target="_blank" rel="noopener" style="margin-top:8px;display:inline-block">Mandar por WhatsApp</a></div>`
        } else {
          extra = `<p class="msg err" style="margin-top:12px">La suscripción no se pudo crear: ${P.esc(ds.error || 'error')}. El socio quedó dado de alta igual.</p>`
        }
      }
      const nom = datos.nombre.split(' ')[0]
      const faltaCodigo = datos.reprocann_estado === 'esperando_codigo' ||
        (['codigo_listo', 'cargado', 'en_evaluacion'].includes(datos.reprocann_estado) && !datos.reprocann_codigo)
      const txtBase = `Hola ${nom}! Ya sos socio de Flora 🌿 ${d.gramos ? `Tu membresía ${datos.tier} te da ${d.gramos} g por mes. ` : ''}Entrá a la carta con tu cuenta de Google (${datos.email}): https://floraong.ar/socios/`
      const txtCodigo = `Hola ${nom}! Ya sos socio de Flora 🌿 Para arrancar tu REPROCANN necesitamos tu código de vinculación: lo generás en tu cuenta de Mi Argentina y lo cargás acá, con el paso a paso: https://floraong.ar/socios/reprocann/`
      const wa = `https://wa.me/${(datos.telefono || '').replace(/\D/g, '')}?text=${encodeURIComponent(faltaCodigo ? txtCodigo : txtBase)}`
      cuerpo.innerHTML = `
        <div style="text-align:center;padding:6px 0 4px">
          <div style="font-family:var(--font-display);font-size:26px;color:var(--grn)">Listo</div>
          <p style="color:var(--ink2);margin:6px 0 0">${P.esc(datos.nombre)} ya tiene acceso a la carta y ficha en el padrón${d.gramos ? ` con ${d.gramos} g por mes` : ''}.</p>
          <p class="so-help" style="margin:8px 0 0">${d.mailEnviado
            ? 'Le llegó el mail de bienvenida.'
            : `El mail de bienvenida NO salió (${P.esc(d.mailError || 'sin detalle')}) — avisale vos.`}</p>
          ${faltaCodigo ? `<div style="margin-top:14px;padding:12px 16px;background:var(--amb-soft);border-radius:10px;text-align:left">
            <b style="color:var(--amb);font-size:13px">Falta su código de vinculación</b>
            <p class="so-help" style="margin:4px 0 0">Sin ese código no se puede arrancar el trámite de REPROCANN.
            El botón de WhatsApp de acá abajo ya lleva el mensaje con el link y el paso a paso.</p>
          </div>` : ''}
        </div>
        ${extra}
        <div class="pn-mod-acciones">
          ${datos.telefono ? `<a class="btn ${faltaCodigo ? 'btn-pri' : ''}" href="${P.esc(wa)}" target="_blank" rel="noopener">${faltaCodigo ? 'Pedirle el código' : 'Saludar por WhatsApp'}</a>` : ''}
          <button class="btn btn-pri" onclick="Panel.cerrarModal()" type="button">Cerrar</button>
        </div>`
      sfCargado = false
      if (sfBox && !sfBox.hidden) sfCargar(true)
      cargarSocios()
    }

    pintar1()
  }

  // ============ Fichas (sf-): padrón financiero D1 ============
  const esc = P.esc
  let sfBox = null
  let sfSocios = []
  let sfSug = []
  let sfQ = ''
  let sfCargado = false
  const SF_TIERS = ['NINGUNA', 'SMALL', 'MEDIUM', 'LARGE', 'EXTRA LARGE']

  function sfMsg(texto, clase) {
    const m = sfBox.querySelector('#sf-msg')
    m.className = 'msg ' + (clase || '')
    m.textContent = texto
    if (texto) setTimeout(() => { if (m.textContent === texto) m.textContent = '' }, 5000)
  }

  async function sfCargar(forzar) {
    if (sfCargado && !forzar) return
    sfCargado = true
    const r = await fetch('/api/panel/padron/lista', { credentials: 'include' })
    if (!r.ok) { sfBox.querySelector('#sf-lista').innerHTML = `<div class="vacio">Error ${r.status} al traer las fichas.</div>`; return }
    const d = await r.json()
    sfSocios = d.socios
    sfSug = d.sugerencias
    const cnt = document.getElementById('sf-cnt')
    cnt.hidden = !sfSug.length
    cnt.textContent = sfSug.length
    sfRender()
  }

  function sfRender() {
    // sugerencias de email para confirmar con un click
    const porId = Object.fromEntries(sfSocios.map((s) => [s.id, s]))
    sfBox.querySelector('#sf-sugerencias').innerHTML = sfSug.length ? `
      <div class="card" style="margin-bottom:14px;border-left:3px solid var(--vio)">
        <span class="k">Cruces por confirmar</span>
        <p class="so-help">Cuentas de Google que entraron a la carta y se parecen a un socio del padrón. Confirmá o descartá.</p>
        ${sfSug.map((g) => `<div class="fila" style="padding:7px 0;border-top:1px solid var(--line);flex-wrap:wrap">
          <span><b>${esc(g.email)}</b> <span style="color:var(--muted)">(Google: ${esc(g.nombre_google || '—')})</span>
          ¿es <b>${esc((porId[g.socio_id] || {}).nombre || '#' + g.socio_id)}</b>?</span>
          <span class="pn-sp"></span>
          <button class="btn sf-sug" data-id="${g.socio_id}" data-ok="1" type="button">Sí, es él</button>
          <button class="btn sf-sug" data-id="${g.socio_id}" data-ok="" type="button">No</button>
        </div>`).join('')}
      </div>` : ''

    const lista = sfSocios.filter((s) => !sfQ ||
      (s.nombre + ' ' + (s.email || '') + ' ' + (s.nota || '')).toLowerCase().includes(sfQ))
    sfBox.querySelector('#sf-lista').innerHTML = lista.length ? `
      <table class="tabla"><thead><tr>
        <th>Socio</th><th>Email (débito)</th><th>Teléfono</th><th>Membresía</th><th>Último pago</th><th>Estado</th>
      </tr></thead><tbody>${lista.map((s) => `<tr>
        <td><div class="fila"><span class="av">${esc(P.iniciales(s.nombre))}</span>
          <div><div style="font-weight:600">${esc(s.nombre)}</div>
          <div style="color:var(--muted);font-size:11px">${s.numero ? '#' + s.numero : ''}${s.reprocann ? ' · ' + esc(s.reprocann) : ''}</div></div></div></td>
        <td>${editar ? `<input class="input sf-campo" data-id="${s.id}" data-campo="email" type="email"
          value="${esc(s.email || '')}" placeholder="sin email" style="min-width:210px;font-size:12px" />`
          : esc(s.email || '—')}</td>
        <td>${editar ? `<input class="input sf-campo" data-id="${s.id}" data-campo="telefono" type="tel"
          value="${esc(s.telefono || '')}" placeholder="+54 9…" style="max-width:130px;font-size:12px" />`
          : esc(s.telefono || '—')}</td>
        <td>${s.modalidad === 'plan' ? `<span class="tag tag-auto">${esc(s.tier)}</span>`
          : editar ? `<select class="sel sf-tier" data-id="${s.id}" style="font-size:12px;max-width:150px">
            ${SF_TIERS.map((t) => `<option value="${t}" ${(s.tier || 'NINGUNA') === t ? 'selected' : ''}>${t === 'NINGUNA' ? '— sin membresía' : t}</option>`).join('')}
          </select>` : esc(s.tier || '—')}</td>
        <td style="color:var(--muted);font-size:12px">${s.ultimo_pago ? esc(s.ultimo_pago.slice(0, 7)) : 'nunca'}</td>
        <td><span class="tag ${s.estado === 'activo' ? 'tag-ok' : 'tag-off'}">${esc(s.estado)}</span></td>
      </tr>`).join('')}</tbody></table>` : '<div class="vacio">No aparece nadie con esa búsqueda.</div>'
  }

  async function sfPatch(id, campo, valor) {
    sfMsg('⏳ guardando…')
    const r = await fetch('/api/panel/padron/socio', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Number(id), [campo]: valor }),
    })
    const d = await r.json().catch(() => ({}))
    if (r.ok) { sfMsg('✔ guardado', 'ok'); return true }
    sfMsg('✗ ' + (d.error || 'error ' + r.status), 'err')
    return false
  }

  function sfInit(box) {
    sfBox = box
    box.querySelector('#sf-buscar').addEventListener('input', (e) => {
      sfQ = e.target.value.trim().toLowerCase()
      sfRender()
    })
    box.addEventListener('change', async (e) => {
      const campo = e.target.closest('.sf-campo')
      if (campo) { sfPatch(campo.dataset.id, campo.dataset.campo, campo.value.trim()); return }
      const tier = e.target.closest('.sf-tier')
      if (tier) {
        const r = await fetch('/api/panel/padron/membresia', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ socio_id: Number(tier.dataset.id), tier: tier.value }),
        })
        sfMsg(r.ok ? '✔ membresía actualizada' : '✗ no se pudo', r.ok ? 'ok' : 'err')
        if (r.ok) sfCargar(true)
      }
    })
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('.sf-sug')
      if (!b) return
      const r = await fetch('/api/panel/padron/sugerencia', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socio_id: Number(b.dataset.id), aceptar: !!b.dataset.ok }),
      })
      const d = await r.json().catch(() => ({}))
      sfMsg(r.ok ? (d.aplicado ? '✔ email vinculado' : 'descartado') : '✗ ' + (d.error || 'error'), r.ok ? 'ok' : 'err')
      sfCargar(true)
    })
  }

  P.registrar('socios', {
    init(el) {
      cont = el
      editar = P.puede('padron_editar')
      el.innerHTML = `
        <div class="subs" id="so-subs">
          <button type="button" class="on" data-sub="padron">Padrón</button>
          <button type="button" data-sub="solicitudes">Solicitudes<span class="cnt" id="so-sol-cnt" hidden></span></button>
          <button type="button" data-sub="fichas">Fichas<span class="cnt" id="sf-cnt" hidden></span></button>
        </div>

        <div id="so-padron">
          ${editar ? `
          <div class="card" style="margin-bottom:14px">
            <div class="fila"><span class="k">Socio nuevo</span><span class="pn-sp"></span>
              <button class="btn btn-pri" id="so-alta-completa" type="button">+ Dar de alta</button></div>
            <p class="so-help">El alta completa: acceso a la carta, ficha en el padrón, membresía y el primer cobro
            — todo de una vez. Si dejó una solicitud web, sus datos vienen precargados.</p>
          </div>
          <details class="card" style="margin-bottom:14px">
            <summary style="cursor:pointer;font-size:12.5px;color:var(--muted);font-weight:600">Alta rápida (solo acceso a la carta)</summary>
            <p class="so-help" style="margin-top:10px">Le da acceso a la carta pero NO le crea ficha en el padrón:
            el Mostrador no lo va a encontrar hasta que completes su ficha.</p>
            <form id="so-alta" class="fila so-alta">
              <input class="input" id="so-alta-email" type="email" required placeholder="email@gmail.com" autocomplete="off" />
              <input class="input" id="so-alta-nota" type="text" placeholder="Nota (ej. Gastón — WhatsApp)" autocomplete="off" />
              <button class="btn btn-pri" type="submit">Agregar socio</button>
              <span id="so-alta-msg" class="msg"></span>
            </form>
          </details>` : ''}
          <div class="card">
            <div class="fila" style="flex-wrap:wrap">
              <input class="input" id="so-buscar" type="search" placeholder="Buscar por nombre, email o nota…" autocomplete="off" style="max-width:280px" />
              <div id="so-stats" class="fila" style="flex-wrap:wrap"></div>
              <span class="pn-sp"></span>
              <span id="so-msg" class="msg"></span>
            </div>
            <div id="so-lista" style="margin-top:14px"><div class="vacio">⏳ Cargando…</div></div>
          </div>
        </div>

        <div id="so-solicitudes" hidden>
          <div class="card">
            <div class="fila"><span class="k">Solicitudes de acceso</span><span class="pn-sp"></span><span id="so-sol-msg" class="msg"></span></div>
            <p class="so-help">Gente que dejó sus datos pidiendo acceso a la carta o su entrevista médica, o que probó entrar con una cuenta de Google que todavía no es socia.</p>
            <div id="so-sol-lista"><div class="vacio">⏳ Cargando…</div></div>
          </div>
        </div>

        <div id="so-fichas" hidden>
          <p class="so-help" style="max-width:76ch">La ficha financiera de cada socio: su email (para el débito
          automático), teléfono y membresía. Viene de la hoja Pacientes del Excel — acá se corrige y se completa.</p>
          <div id="sf-sugerencias"></div>
          <div class="card">
            <div class="fila" style="flex-wrap:wrap">
              <input class="input" id="sf-buscar" type="search" placeholder="Buscar socio…" autocomplete="off" style="max-width:280px" />
              <span class="pn-sp"></span>
              <span id="sf-msg" class="msg"></span>
            </div>
            <div id="sf-lista" style="margin-top:14px"><div class="vacio">⏳ Cargando…</div></div>
          </div>
        </div>`

      // sub-tabs
      el.querySelector('#so-subs').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-sub]')
        if (!b) return
        el.querySelectorAll('#so-subs button').forEach((x) => x.classList.toggle('on', x === b))
        el.querySelector('#so-padron').hidden = b.dataset.sub !== 'padron'
        el.querySelector('#so-solicitudes').hidden = b.dataset.sub !== 'solicitudes'
        el.querySelector('#so-fichas').hidden = b.dataset.sub !== 'fichas'
        if (b.dataset.sub === 'fichas') sfCargar()
      })
      sfInit(el.querySelector('#so-fichas'))

      el.querySelector('#so-buscar').addEventListener('input', (e) => {
        q = e.target.value.trim().toLowerCase()
        renderPadron()
      })
      const alta = el.querySelector('#so-alta')
      if (alta) alta.addEventListener('submit', onAlta)
      const altaC = el.querySelector('#so-alta-completa')
      if (altaC) altaC.addEventListener('click', altaAbrir)
      el.addEventListener('click', onClick)
      el.addEventListener('change', onChange)

      cargarSocios()
      cargarSolicitudes()
    },
  })
})()
