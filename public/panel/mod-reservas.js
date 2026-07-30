/* Módulo Reservas (prefijo rv-): los pedidos de la carta, con estados,
   reasignación de la cuenta compartida y ranking de lo más reservado.
   Porteo del panel viejo (/socios/admin/) — mismos endpoints, UI nueva. */
(() => {
  'use strict'
  const P = window.Panel

  const EP_PEDIDOS = '/api/socios/admin/pedidos'
  const EP_SOCIOS = '/api/socios/admin/socios'
  // Cuenta que se usa en el living del club: varios socios reservan con ESTA
  // sesión, no la propia — por eso al entregar se ofrece asignar al socio real.
  const CUENTA_COMPARTIDA = 'floraclubdecultivo@gmail.com'

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
  function esCompartida(p) { return p.email === CUENTA_COMPARTIDA || !!p.reasignadoDe }

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
    const reasignarBtn = esCompartida(p)
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
        aviso('')
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

  function pintarResultados(q) {
    const caja = document.getElementById('rv-res-resultados')
    if (!caja) return
    const term = q.trim().toLowerCase()
    if (!term) { caja.innerHTML = '' ; return }
    const matches = SOCIOS
      .filter((s) => s.email !== CUENTA_COMPARTIDA)
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
          <span id="rv-count" class="msg"></span>
          <span class="pn-sp"></span>
          <span id="rv-msg" class="msg"></span>
        </div>
        <div id="rv-top" class="fila rv-top" hidden></div>
        <div id="rv-lista" class="rv-lista"><div class="vacio">⏳ Cargando…</div></div>`

      el.querySelector('#rv-refresh').addEventListener('click', () => cargar())
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
          if (pedido && esCompartida(pedido)) {
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

      cargar()
    },
  })
})()
