/* Módulo Reservas (prefijo rv-): los pedidos de la carta, con estados,
   reasignación de la cuenta compartida y ranking de lo más reservado.
   Porteo del panel viejo (/socios/admin/) — mismos endpoints, UI nueva. */
(() => {
  'use strict'
  const P = window.Panel

  const EP_PEDIDOS = '/api/socios/admin/pedidos'
  const EP_SOCIOS = '/api/socios/admin/socios'
  const EP_MOSTRADOR = '/api/socios/admin/mostrador'
  // Cuentas que se usan para atender en el living: varios socios reservan con
  // ESA sesión, no la propia. Ahora se configuran desde el botón "Mostrador"
  // de esta misma pestaña y las lee también el backend, que es quien decide
  // si una cuenta puede reservar a nombre de otra. Antes era una constante
  // acá adentro: el mismo dato escrito en dos lados y solo el front lo sabía.
  let CUENTAS_MOSTRADOR = ['floraclubdecultivo@gmail.com']

  let cont = null
  let PEDIDOS = []
  let SOCIOS = []          // cache para el buscador de reasignación
  let filtroPed = 'activos' // 'activos' | '' (todas)
  let reasignarCtx = null   // { id, estadoAlConfirmar }

  const BADGE = {
    pendiente: ['Pendiente', 'tag-deb'],
    listo: ['Lista para retirar', 'tag-ok'],
    entregado: ['Entregada', 'tag-off'],
    cancelado: ['Cancelada', 'tag-off'],
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
  function esCompartida(p) { return CUENTAS_MOSTRADOR.includes(p.email) || !!p.reasignadoDe }
  // Reserva cargada en el mostrador YA a nombre del socio: no hay nada que
  // reasignar, el aviso de "lista" le va a llegar a él.
  function esDeMostrador(p) { return !!p.mostrador }

  let msgT = null
  function aviso(texto, clase, ms) {
    const el = cont.querySelector('#rv-msg')
    if (!el) return
    el.className = 'msg' + (clase ? ' ' + clase : '')
    el.textContent = texto
    clearTimeout(msgT)
    if (texto) msgT = setTimeout(() => { el.textContent = ''; el.className = 'msg' }, ms || 6000)
  }

  /* ---------- render ---------- */
  function itemsHtml(p) {
    return (p.items || [])
      .map((i) => `<li>${P.esc(`${i.cantidad} ${i.formato === 'flor' ? 'g' : 'u'} — ${i.nombre}`)}${i.formato === 'preroll' ? ' <span class="tag tag-auto">preroll</span>' : ''}</li>`)
      .join('')
  }
  // Una sola acción primaria (triage rápido); Cancelar y Asignar a socio
  // viven en el menú secundario de tres puntos.
  function accionesHtml(p) {
    const reasignarBtn = esCompartida(p) && !esDeMostrador(p)
      ? `<button type="button" class="btn rv-reasignar" data-id="${P.esc(p.id)}">${p.reasignadoDe ? 'Reasignar de nuevo' : 'Asignar a socio'}</button>`
      : ''
    const esFinal = p.estado === 'entregado' || p.estado === 'cancelado'
    const cancelBtn = esFinal ? '' : `<button type="button" class="btn btn-peligro rv-accion" data-id="${P.esc(p.id)}" data-estado="cancelado">Cancelar reserva</button>`
    const cuerpoMenu = reasignarBtn + cancelBtn
    const menu = cuerpoMenu
      ? `<div class="rv-menu">
          <button type="button" class="btn rv-menubtn" data-menu="${P.esc(p.id)}" aria-label="Más acciones">⋯</button>
          <div class="rv-menupanel" data-menupanel="${P.esc(p.id)}" hidden>${cuerpoMenu}</div>
        </div>`
      : ''
    if (p.estado === 'pendiente') {
      return `<button type="button" class="btn btn-pri rv-accion" data-id="${P.esc(p.id)}" data-estado="listo">Marcar lista</button>${menu}`
    }
    if (p.estado === 'listo') {
      return `<button type="button" class="btn btn-pri rv-accion" data-id="${P.esc(p.id)}" data-estado="entregado">Marcar entregada</button>${menu}`
    }
    return menu
  }
  function tarjeta(p) {
    const [label, cls] = BADGE[p.estado] || [p.estado, 'tag-off']
    return `<article class="card rv-card">
      <div class="rv-main">
        <div class="fila" style="flex-wrap:wrap;gap:8px">
          <strong>${P.esc(p.name || p.email)}</strong>
          <span class="tag ${cls}">${P.esc(label)}</span>
          <span class="rv-fecha">${P.esc(fmtFecha(p.creado))}</span>
          ${esDeMostrador(p) ? '<span class="tag tag-auto">Mostrador</span>' : ''}
        </div>
        <div class="rv-mail">${P.esc(p.email)}</div>
        ${p.reasignadoDe ? `<div class="rv-meta">Reasignada — pedido original de ${P.esc(p.reasignadoDe)}</div>` : ''}
        <ul class="rv-items">${itemsHtml(p)}</ul>
        ${p.nota ? `<div class="rv-meta">Nota: ${P.esc(p.nota)}</div>` : ''}
      </div>
      <div class="rv-acciones">${accionesHtml(p)}</div>
    </article>`
  }

  // Ranking "más reservado": suma cantidades por producto en las reservas no
  // canceladas — mismo dato que ya viaja en PEDIDOS, sin otro endpoint.
  function renderTop() {
    const top = cont.querySelector('#rv-top')
    const cantidades = new Map()
    for (const p of PEDIDOS) {
      if (p.estado === 'cancelado') continue
      for (const i of p.items || []) {
        const clave = i.nombre || '(sin nombre)'
        cantidades.set(clave, (cantidades.get(clave) || 0) + (i.cantidad || 0))
      }
    }
    const ranking = [...cantidades.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    if (!ranking.length) { top.hidden = true; top.innerHTML = ''; return }
    top.hidden = false
    top.innerHTML = '<span class="k">Más reservado</span>' +
      ranking.map(([nombre, n]) => `<span class="rv-top-chip">${P.esc(nombre)} <strong>${P.fmtN(n)}</strong></span>`).join('')
  }

  function render() {
    const lista = cont.querySelector('#rv-lista')
    // Triage: pendientes primero, después listas, después el histórico
    const peso = { pendiente: 0, listo: 1, entregado: 2, cancelado: 2 }
    const ordenadas = [...PEDIDOS].sort((a, b) =>
      (peso[a.estado] ?? 3) - (peso[b.estado] ?? 3) || String(b.creado || '').localeCompare(String(a.creado || '')))
    const filtradas = filtroPed === 'activos'
      ? ordenadas.filter((p) => p.estado === 'pendiente' || p.estado === 'listo')
      : ordenadas
    const activas = PEDIDOS.filter((p) => p.estado === 'pendiente' || p.estado === 'listo').length
    cont.querySelector('#rv-count').textContent = `${P.fmtN(activas)} activas · ${P.fmtN(PEDIDOS.length)} en total`
    renderTop()
    lista.innerHTML = filtradas.length
      ? filtradas.map(tarjeta).join('')
      : `<div class="vacio">${filtroPed === 'activos' ? 'No hay reservas activas ahora mismo.' : 'Todavía no entró ninguna reserva.'}</div>`
  }

  // Qué cuentas atienden mostrador. Si el GET falla (rol sin permiso, red),
  // se sigue con el default: el panel solo pierde el marcado, no se rompe.
  async function cargarMostrador() {
    try {
      const res = await fetch(EP_MOSTRADOR, { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) CUENTAS_MOSTRADOR = (data.cuentas || []).map((c) => c.email)
    } catch { /* queda el default */ }
  }

  function abrirMostrador() {
    const pintar = (cuentas) => `
      <p class="rv-help">Estas cuentas atienden en el living: al reservar desde la carta pueden elegir a qué socio le queda la reserva, y el aviso de "lista para retirar" le llega a esa persona.</p>
      <div id="rv-mo-lista" class="rv-res-resultados">${
        cuentas.length
          ? cuentas.map((c) => `
              <div class="rv-mo-fila">
                <span><b>${P.esc(c.name || c.email)}</b>${c.name ? `<span class="rv-res-mail"> · ${P.esc(c.email)}</span>` : ''}${c.existe ? '' : '<span class="tag tag-off">ya no es socia</span>'}</span>
                <button type="button" class="btn btn-peligro rv-mo-quitar" data-email="${P.esc(c.email)}">Quitar</button>
              </div>`).join('')
          : '<div class="vacio" style="padding:14px">Ninguna cuenta atiende mostrador. Sin esto, las reservas del living quedan a nombre del club.</div>'
      }</div>
      <label class="k" style="display:block;margin-top:14px">Sumar una cuenta</label>
      <input class="input" id="rv-mo-buscar" type="search" placeholder="Nombre o email…" autocomplete="off" />
      <div id="rv-mo-resultados" class="rv-res-resultados"></div>
      <div class="pn-mod-acciones"><button type="button" class="btn" id="rv-mo-cerrar">Listo</button></div>`

    let cuentas = []
    const ov = P.modal('Cuentas que atienden en el living', pintar(cuentas))
    // Solo el cuerpo: reescribir la tarjeta entera se lleva puesto el <h3>
    // que arma P.modal y el envoltorio .pn-mod-cuerpo del que cuelga el CSS.
    const refrescar = () => { ov.querySelector('.pn-mod-cuerpo').innerHTML = pintar(cuentas); wire() }

    const guardar = async (emails) => {
      try {
        const res = await fetch(EP_MOSTRADOR, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cuentas: emails }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) { aviso(data.error || errHttp(res.status), 'err'); return false }
        cuentas = data.cuentas || []
        CUENTAS_MOSTRADOR = cuentas.map((c) => c.email)
        render()
        return true
      } catch { aviso('Error de red al guardar.', 'err'); return false }
    }

    function wire() {
      const buscar = ov.querySelector('#rv-mo-buscar')
      if (buscar) buscar.addEventListener('input', (e) => {
        const caja = ov.querySelector('#rv-mo-resultados')
        const term = e.target.value.trim().toLowerCase()
        if (!term) { caja.innerHTML = ''; return }
        const yaEstan = cuentas.map((c) => c.email)
        const matches = SOCIOS
          .filter((s) => !yaEstan.includes(s.email))
          .filter((s) => s.email.toLowerCase().includes(term) || (s.name || '').toLowerCase().includes(term))
          .slice(0, 8)
        caja.innerHTML = matches.length
          ? matches.map((s) => `<button type="button" class="rv-res-opt rv-mo-sumar" data-email="${P.esc(s.email)}"><span>${P.esc(s.name || s.email)}</span>${s.name ? `<span class="rv-res-mail">${P.esc(s.email)}</span>` : ''}</button>`).join('')
          : '<div class="vacio" style="padding:14px">Sin coincidencias.</div>'
      })
    }

    ov.addEventListener('click', async (e) => {
      if (e.target.id === 'rv-mo-cerrar') { P.cerrarModal(); return }
      const sumar = e.target.closest('.rv-mo-sumar')
      if (sumar) { if (await guardar([...cuentas.map((c) => c.email), sumar.dataset.email])) refrescar(); return }
      const quitar = e.target.closest('.rv-mo-quitar')
      if (quitar) {
        if (!(await P.confirmar('¿Sacar esta cuenta del mostrador? Va a dejar de poder reservar a nombre de otros socios.', 'Sí, sacarla'))) return
        if (await guardar(cuentas.filter((c) => c.email !== quitar.dataset.email).map((c) => c.email))) refrescar()
      }
    })

    ;(async () => {
      try {
        const [rm, rs] = await Promise.all([
          fetch(EP_MOSTRADOR, { credentials: 'include' }).then((r) => r.json()).catch(() => ({})),
          SOCIOS.length ? Promise.resolve(null) : fetch(EP_SOCIOS, { credentials: 'include' }).then((r) => r.json()).catch(() => ({})),
        ])
        if (rm && rm.ok) cuentas = rm.cuentas || []
        if (rs && rs.ok) SOCIOS = rs.socios || []
        refrescar()
      } catch { /* el modal queda con lo que haya */ }
    })()
  }

  async function cargar() {
    const lista = cont.querySelector('#rv-lista')
    if (!PEDIDOS.length) lista.innerHTML = '<div class="vacio">⏳ Cargando…</div>'
    try {
      const res = await fetch(EP_PEDIDOS, { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) { lista.innerHTML = `<div class="vacio">${P.esc(data.error || errHttp(res.status))}</div>`; return }
      PEDIDOS = data.pedidos || []
      render()
    } catch {
      lista.innerHTML = '<div class="vacio">Error de red al cargar las reservas — revisá la conexión y probá de nuevo.</div>'
    }
  }

  /* ---------- cambios de estado / reasignación ---------- */
  async function marcarPedido(body, btn) {
    aviso(body.reasignarA ? '⏳ asignando…' : '⏳ actualizando…')
    try {
      const res = await fetch(EP_PEDIDOS, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        mostrarAviso(data.aviso)
        await cargar()
      } else {
        if (btn) btn.disabled = false
        aviso(data.error || `No se pudo actualizar (${res.status}) — probá de nuevo.`, 'err')
        if (data.conflict) await cargar() // trae el estado real, aunque el click no haya aplicado
      }
    } catch {
      if (btn) btn.disabled = false
      aviso('Error de red — probá de nuevo.', 'err')
    }
  }

  // Qué pasó con el aviso al socio: mail automático + botón de WhatsApp.
  function mostrarAviso(a) {
    if (!a) { aviso(''); return }
    const mailTxt = a.mail === null ? 'aviso por mail desactivado'
      : a.mail.enviado ? '✉️ mail enviado al socio'
      : 'el mail NO salió' + (a.mail.error ? ` (${a.mail.error})` : '')
    if (a.wa) {
      P.modal('Aviso al socio', `
        <p style="color:var(--ink2);margin:0 0 4px">${P.esc(mailTxt)}.</p>
        <p style="color:var(--muted);font-size:12.5px;margin:0">¿Se lo mandás también por WhatsApp? El texto ya va escrito.</p>
        <div class="pn-mod-acciones">
          <button class="btn" onclick="Panel.cerrarModal()" type="button">Listo</button>
          <a class="btn btn-pri" href="${P.esc(a.wa.link)}" target="_blank" rel="noopener" onclick="Panel.cerrarModal()">Mandar por WhatsApp</a>
        </div>`)
      aviso('')
    } else {
      aviso(a.mail && !a.mail.enviado && a.mail !== null ? '✗ ' + mailTxt : '✔ ' + mailTxt, a.mail && a.mail.enviado === false ? 'err' : 'ok')
    }
  }

  /* ---------- editor de plantillas de avisos ---------- */
  const NOMBRE_AVISO = { listo: 'Lista para retirar', entregado: 'Entregada (gracias)' }

  async function abrirEditorAvisos() {
    const r = await fetch('/api/socios/admin/avisos', { credentials: 'include' })
    if (!r.ok) { aviso('No se pudieron cargar las plantillas (' + r.status + ')', 'err'); return }
    const d = await r.json()
    const bloque = (estado) => {
      const pl = d.avisos[estado]
      return `
        <fieldset class="rv-av-bloque" data-estado="${estado}" style="border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 12px;min-width:0">
          <legend style="padding:0 6px;font-weight:600;font-size:13px">${NOMBRE_AVISO[estado]}</legend>
          <label class="fila" style="gap:8px;font-size:12.5px;color:var(--ink2);margin-bottom:8px;cursor:pointer">
            <input type="checkbox" class="rv-av-activo" ${pl.activo ? 'checked' : ''} /> Mandar el mail automáticamente
          </label>
          <div class="campo"><label class="lb">Asunto del mail</label>
            <input class="input rv-av-asunto" maxlength="150" value="${P.esc(pl.asunto)}" /></div>
          <div class="campo"><label class="lb">Cuerpo del mail (una línea en blanco = párrafo nuevo)</label>
            <textarea class="input rv-av-cuerpo" rows="6" maxlength="2000" style="resize:vertical">${P.esc(pl.cuerpo)}</textarea></div>
          <div class="campo"><label class="lb">Texto del WhatsApp (el botón de un toque)</label>
            <textarea class="input rv-av-wa" rows="3" maxlength="2000" style="resize:vertical">${P.esc(pl.wa)}</textarea></div>
        </fieldset>`
    }
    const ov = P.modal('Avisos al socio', `
      <p style="color:var(--muted);font-size:12.5px;margin:0 0 12px">Variables: <code>{{nombre}}</code> (primer nombre),
      <code>{{items}}</code> (lo que reservó) y <code>{{nota}}</code>. El mail sale con el diseño de marca (logo, botón «Ver mi reserva» y pie de contacto).</p>
      <div style="max-height:60vh;overflow-y:auto;padding-right:4px">${bloque('listo')}${bloque('entregado')}</div>
      <div class="pn-mod-acciones">
        <button class="btn" id="rv-av-defaults" type="button">Restaurar textos originales</button>
        <span class="pn-sp"></span>
        <button class="btn" onclick="Panel.cerrarModal()" type="button">Cancelar</button>
        <button class="btn btn-pri" id="rv-av-guardar" type="button">Guardar</button>
      </div>
      <p class="msg" id="rv-av-msg" style="margin:8px 0 0"></p>`, { fijo: true })

    ov.querySelector('#rv-av-defaults').addEventListener('click', () => {
      ov.querySelectorAll('.rv-av-bloque').forEach((b) => {
        const def = d.defaults[b.dataset.estado]
        b.querySelector('.rv-av-activo').checked = def.activo
        b.querySelector('.rv-av-asunto').value = def.asunto
        b.querySelector('.rv-av-cuerpo').value = def.cuerpo
        b.querySelector('.rv-av-wa').value = def.wa
      })
    })
    ov.querySelector('#rv-av-guardar').addEventListener('click', async () => {
      const body = {}
      ov.querySelectorAll('.rv-av-bloque').forEach((b) => {
        body[b.dataset.estado] = {
          activo: b.querySelector('.rv-av-activo').checked,
          asunto: b.querySelector('.rv-av-asunto').value,
          cuerpo: b.querySelector('.rv-av-cuerpo').value,
          wa: b.querySelector('.rv-av-wa').value,
        }
      })
      const msg = ov.querySelector('#rv-av-msg')
      msg.className = 'msg'; msg.textContent = '⏳ guardando…'
      const rr = await fetch('/api/socios/admin/avisos', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const dd = await rr.json().catch(() => ({}))
      if (rr.ok) { P.cerrarModal(); aviso('✔ plantillas guardadas', 'ok') }
      else { msg.className = 'msg err'; msg.textContent = '✗ ' + (dd.error || 'error ' + rr.status) }
    })
  }

  function pintarResultados(q) {
    const caja = document.getElementById('rv-res-resultados')
    if (!caja) return
    const term = q.trim().toLowerCase()
    if (!term) { caja.innerHTML = '' ; return }
    const matches = SOCIOS
      .filter((s) => !CUENTAS_MOSTRADOR.includes(s.email))
      .filter((s) => s.email.toLowerCase().includes(term) || (s.name || '').toLowerCase().includes(term))
      .slice(0, 8)
    caja.innerHTML = matches.length
      ? matches.map((s) => `
          <button type="button" class="rv-res-opt" data-email="${P.esc(s.email)}">
            <span>${P.esc(s.name || s.email)}</span>
            ${s.name ? `<span class="rv-res-mail">${P.esc(s.email)}</span>` : ''}
          </button>`).join('')
      : '<div class="vacio" style="padding:14px">Sin coincidencias.</div>'
  }

  async function abrirReasignar(pedidoId, estadoAlConfirmar) {
    reasignarCtx = { id: pedidoId, estadoAlConfirmar: estadoAlConfirmar || null }
    const ov = P.modal('¿Quién se lo llevó?', `
      <p class="rv-help">Buscá al socio que retiró este pedido — la reserva pasa a su cuenta.</p>
      <input class="input" id="rv-res-buscar" type="search" placeholder="Nombre o email…" autocomplete="off" />
      <div id="rv-res-resultados" class="rv-res-resultados"></div>
      <div class="pn-mod-acciones">
        ${estadoAlConfirmar ? '<button type="button" class="btn" id="rv-res-skip">Dejar en la cuenta del club</button>' : ''}
        <button type="button" class="btn" id="rv-res-cerrar">Cerrar</button>
      </div>`)
    const buscar = ov.querySelector('#rv-res-buscar')
    buscar.focus()
    buscar.addEventListener('input', (e) => pintarResultados(e.target.value))
    ov.addEventListener('click', async (e) => {
      const opt = e.target.closest('.rv-res-opt')
      if (opt) {
        const ctx = reasignarCtx
        reasignarCtx = null
        P.cerrarModal()
        const body = { id: ctx.id, reasignarA: opt.dataset.email }
        if (ctx.estadoAlConfirmar) body.estado = ctx.estadoAlConfirmar
        await marcarPedido(body)
        return
      }
      if (e.target.id === 'rv-res-skip') {
        const ctx = reasignarCtx
        reasignarCtx = null
        P.cerrarModal()
        if (ctx && ctx.estadoAlConfirmar) await marcarPedido({ id: ctx.id, estado: ctx.estadoAlConfirmar })
        return
      }
      if (e.target.id === 'rv-res-cerrar') { reasignarCtx = null; P.cerrarModal() }
    })
    // primera vez en la sesión: trae el padrón para poder buscar
    if (!SOCIOS.length) {
      try {
        const res = await fetch(EP_SOCIOS, { credentials: 'include' })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.ok) SOCIOS = data.socios || []
        // si ya tipeó mientras cargaba, refresca los resultados
        if (buscar.value) pintarResultados(buscar.value)
      } catch { /* el buscador queda sin resultados; se puede cerrar y reintentar */ }
    }
  }

  /* ---------- registro ---------- */
  P.registrar('reservas', {
    init(el) {
      cont = el
      el.innerHTML = `
        <div class="fila rv-toolbar" style="flex-wrap:wrap">
          <button type="button" class="chip on" data-f="activos">Activas</button>
          <button type="button" class="chip" data-f="">Todas</button>
          <button type="button" class="btn" id="rv-refresh">Actualizar</button>
          ${P.puede('avisos_editar') ? '<button type="button" class="btn" id="rv-avisos" title="Textos del mail y el WhatsApp que le llegan al socio">✉️ Avisos</button>' : ''}
          ${P.puede('carta_gestionar') ? '<button type="button" class="btn" id="rv-mostrador" title="Cuentas que atienden en el living y reservan a nombre de un socio">🏪 Cuentas del living</button>' : ''}
          <span id="rv-count" class="msg"></span>
          <span class="pn-sp"></span>
          <span id="rv-msg" class="msg"></span>
        </div>
        <div id="rv-top" class="fila rv-top" hidden></div>
        <div id="rv-lista" class="rv-lista"><div class="vacio">⏳ Cargando…</div></div>`

      el.querySelector('#rv-refresh').addEventListener('click', () => cargar())
      el.querySelector('#rv-avisos')?.addEventListener('click', abrirEditorAvisos)
      el.querySelectorAll('.rv-toolbar .chip').forEach((b) => b.addEventListener('click', () => {
        el.querySelectorAll('.rv-toolbar .chip').forEach((x) => x.classList.toggle('on', x === b))
        filtroPed = b.dataset.f
        render()
      }))

      el.addEventListener('click', async (e) => {
        // menú de tres puntos por tarjeta
        const mbtn = e.target.closest('.rv-menubtn')
        if (mbtn) {
          const panel = el.querySelector(`[data-menupanel="${CSS.escape(mbtn.dataset.menu)}"]`)
          const abrir = panel.hidden
          el.querySelectorAll('.rv-menupanel').forEach((p) => { p.hidden = true })
          panel.hidden = !abrir
          return
        }
        if (!e.target.closest('.rv-menupanel')) el.querySelectorAll('.rv-menupanel').forEach((p) => { p.hidden = true })

        if (e.target.id === 'rv-mostrador') { abrirMostrador(); return }

        const rbtn = e.target.closest('.rv-reasignar')
        if (rbtn) {
          el.querySelectorAll('.rv-menupanel').forEach((p) => { p.hidden = true })
          abrirReasignar(rbtn.dataset.id, null)
          return
        }

        const btn = e.target.closest('.rv-accion')
        if (!btn) return
        const estado = btn.dataset.estado
        if (estado === 'cancelado' && !(await P.confirmar('¿Cancelar esta reserva? El socio la va a ver como cancelada.', 'Sí, cancelar'))) return
        // Al entregar un pedido de la cuenta compartida del living, primero
        // se ofrece asignarlo al socio real que se lo llevó.
        if (estado === 'entregado') {
          const pedido = PEDIDOS.find((p) => p.id === btn.dataset.id)
          if (pedido && esCompartida(pedido) && !esDeMostrador(pedido)) {
            abrirReasignar(btn.dataset.id, 'entregado')
            return
          }
        }
        btn.disabled = true
        await marcarPedido({ id: btn.dataset.id, estado }, btn)
      })

      // Reservas frescas sin tocar nada: refresh cada 60s SOLO con la
      // sección visible y la pestaña del navegador activa.
      setInterval(() => {
        if (document.visibilityState === 'visible' && cont.closest('.pn-sec').classList.contains('on')) cargar()
      }, 60000)

      cargarMostrador()
      cargar()
    },
  })
})()
