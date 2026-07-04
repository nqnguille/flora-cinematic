// ═══════════════════════════════════════════════
// TIENDA DE RESERVAS — motor compartido del portal
// Cada página define window.TIENDA = { categoria, fotos?, iconos?, layout }
// antes de cargar este script. Reusa la sesión/API de la carta.
// ═══════════════════════════════════════════════
(function () {
  const CFG = window.TIENDA || {}
  const fmt = (n) => '$ ' + Number(n).toLocaleString('es-AR')
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  let ITEMS = []           // productos de la categoría (de /api/socios/precios)
  let ACTIVO = null         // reserva activa del socio (pendiente/listo)
  let EDIT = null           // copia editable de los ítems del activo (id|formato → cantidad)
  const TOPE = { flor: 50, preroll: 20, producto: 10 }
  const carrito = new Map() // id → cantidad (selección local de esta página)

  // ── Panel de carrito (drawer): se crea una sola vez, en todas las páginas ──
  function montarCart() {
    if (document.getElementById('td-cart')) return
    const wrap = document.createElement('div')
    wrap.id = 'td-cart'
    wrap.innerHTML = `
      <div class="td-cart-overlay" data-cart-close></div>
      <aside class="td-cart-panel" role="dialog" aria-modal="true" aria-label="Carrito de reservas">
        <div class="td-cart-head">
          <h2>Tu carrito <em>de reservas</em></h2>
          <button type="button" class="td-cart-close" data-cart-close aria-label="Cerrar">✕</button>
        </div>
        <div class="td-cart-body">
          <section class="td-cart-sec" id="td-cart-sel-sec" hidden>
            <h3>Para reservar ahora</h3>
            <div id="td-cart-sel"></div>
            <div class="td-cart-total"><span>Total estimado</span><strong id="td-cart-total"></strong></div>
            <button type="button" class="td-bar-btn td-cart-send" id="td-cart-send">Confirmar reserva</button>
          </section>
          <section class="td-cart-sec" id="td-cart-activo-sec" hidden>
            <h3>Reserva en curso <span id="td-cart-estado" class="td-cart-badge"></span></h3>
            <div id="td-cart-activo"></div>
            <div class="td-cart-act-actions">
              <button type="button" class="td-bar-btn td-cart-guardar" id="td-cart-guardar" hidden>Guardar cambios</button>
              <button type="button" class="td-cart-cancel" id="td-cart-cancel" hidden>Cancelar reserva</button>
            </div>
          </section>
          <p class="td-cart-vacio" id="td-cart-vacio">Tu carrito está vacío. Sumá productos con los botones <b>+</b> de cada ficha, o abrí la carta de flores.</p>
          <p class="td-cart-msg" id="td-cart-msg" hidden></p>
          <a class="td-cart-carta" href="/socios/carta/">🌿 Abrir la carta de flores →</a>
          <p class="td-cart-hint">Es una <strong>reserva</strong>: la retirás y abonás en el club. Por el sitio no se cobra nada.</p>
          <div class="td-cart-foot">
            <a class="td-cart-cuenta" href="/socios/cuenta/">Mi cuenta</a>
            <button type="button" class="td-cart-logout nav-logout-action">Cerrar sesión</button>
          </div>
        </div>
      </aside>`
    document.body.appendChild(wrap)
    wrap.addEventListener('click', (e) => { if (e.target.closest('[data-cart-close]')) cerrarCart() })
    document.getElementById('td-cart-send').addEventListener('click', reservar)
    document.getElementById('td-cart-cancel').addEventListener('click', cancelarActivo)
    document.getElementById('td-cart-guardar').addEventListener('click', guardarActivo)
  }
  function abrirCart() { montarCart(); renderCart(); document.getElementById('td-cart').classList.add('is-open'); document.body.style.overflow = 'hidden' }
  function cerrarCart() { document.getElementById('td-cart')?.classList.remove('is-open'); document.body.style.overflow = '' }

  function renderCart() {
    montarCart()
    const selSec = document.getElementById('td-cart-sel-sec')
    const actSec = document.getElementById('td-cart-activo-sec')
    const vacio = document.getElementById('td-cart-vacio')
    // selección local
    const sel = [...carrito.entries()].filter(([, q]) => q > 0)
    let total = 0
    if (sel.length) {
      selSec.hidden = false
      document.getElementById('td-cart-sel').innerHTML = sel.map(([id, qty]) => {
        const it = ITEMS.find((x) => x.id === id)
        if (!it) return ''
        total += qty * it.precio
        return `
          <div class="td-cart-row">
            <span class="td-cart-row-nombre">${esc(it.label)}${it.detalle ? ` <i>${esc(it.detalle)}</i>` : ''}</span>
            <div class="td-stepper" data-id="${esc(id)}">
              <button type="button" class="td-step-btn" data-d="-1" aria-label="Quitar uno">−</button>
              <span class="td-step-num">${qty}</span>
              <button type="button" class="td-step-btn" data-d="1" aria-label="Sumar uno" ${qty >= 10 ? 'disabled' : ''}>+</button>
            </div>
            <span class="td-cart-row-precio">${fmt(qty * it.precio)}</span>
          </div>`
      }).join('')
      document.getElementById('td-cart-total').textContent = fmt(total)
    } else {
      selSec.hidden = true
    }
    // reserva activa — editable ítem por ítem mientras esté pendiente
    if (ACTIVO) {
      actSec.hidden = false
      const est = document.getElementById('td-cart-estado')
      est.textContent = ACTIVO.estado === 'listo' ? 'Lista para retirar' : 'En preparación'
      est.className = 'td-cart-badge is-' + ACTIVO.estado
      const editable = ACTIVO.estado === 'pendiente'
      if (editable && !EDIT) {
        EDIT = new Map(ACTIVO.items.map((i) => [`${i.id}|${i.formato}`, i.cantidad]))
      }
      document.getElementById('td-cart-activo').innerHTML = ACTIVO.items.map((i) => {
        const k = `${i.id}|${i.formato}`
        const qty = editable ? (EDIT.get(k) ?? 0) : i.cantidad
        const unidad = i.formato === 'flor' ? ' g' : ''
        if (!editable) {
          return `<div class="td-cart-row td-cart-row-activo"><span class="td-cart-row-nombre">${esc(i.nombre)}</span><span class="td-cart-row-cant">× ${i.cantidad}${unidad}</span></div>`
        }
        const tope = TOPE[i.formato] ?? 10
        return `
          <div class="td-cart-row td-cart-row-activo${qty === 0 ? ' is-quitado' : ''}">
            <span class="td-cart-row-nombre">${esc(i.nombre)}${qty === 0 ? ' <i>(se quita)</i>' : ''}</span>
            <div class="td-stepper td-stepper-act" data-act="${esc(k)}">
              <button type="button" class="td-step-btn" data-d="-1" aria-label="Quitar uno" ${qty ? '' : 'disabled'}>−</button>
              <span class="td-step-num">${qty}${unidad}</span>
              <button type="button" class="td-step-btn" data-d="1" aria-label="Sumar uno" ${qty >= tope ? 'disabled' : ''}>+</button>
            </div>
          </div>`
      }).join('')
      // ¿hay cambios respecto de la reserva original?
      let dirty = false
      if (editable && EDIT) {
        for (const i of ACTIVO.items) {
          if ((EDIT.get(`${i.id}|${i.formato}`) ?? 0) !== i.cantidad) { dirty = true; break }
        }
      }
      document.getElementById('td-cart-guardar').hidden = !dirty
      document.getElementById('td-cart-cancel').hidden = !editable
    } else {
      actSec.hidden = true
      EDIT = null
    }
    vacio.hidden = !!(sel.length || ACTIVO)
  }

  async function guardarActivo() {
    if (!ACTIVO || !EDIT) return
    const btn = document.getElementById('td-cart-guardar')
    btn.disabled = true
    btn.textContent = 'Guardando…'
    const items = [...EDIT.entries()]
      .filter(([, q]) => q > 0)
      .map(([k, cantidad]) => {
        const [id, formato] = k.split('|')
        return { id, formato, cantidad }
      })
    try {
      const res = await fetch('/api/socios/pedidos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: ACTIVO.id, items }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { mensajeCart(data.error || 'No se pudo actualizar.'); return }
      ACTIVO = data.pedido || null
      EDIT = null
      mensajeCart(data.cancelada ? 'Reserva cancelada (quedó vacía).' : 'Reserva actualizada ✓')
      renderCart(); actualizarBadge()
    } catch { mensajeCart('Error de red al actualizar.') } finally {
      btn.disabled = false
      btn.textContent = 'Guardar cambios'
    }
  }

  async function cancelarActivo() {
    if (!ACTIVO) return
    const btn = document.getElementById('td-cart-cancel')
    btn.disabled = true
    try {
      const res = await fetch('/api/socios/pedidos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: ACTIVO.id }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { mensajeCart(data.error || 'No se pudo cancelar.'); return }
      ACTIVO = null
      EDIT = null
      mensajeCart('Reserva cancelada.')
      renderCart(); actualizarBadge()
    } catch { mensajeCart('Error de red al cancelar.') } finally { btn.disabled = false }
  }

  function mensajeCart(texto) {
    const m = document.getElementById('td-cart-msg')
    if (!m) return
    m.textContent = texto
    m.hidden = false
    setTimeout(() => { m.hidden = true }, 5000)
  }

  function render() {
    // Modo estático: el markup viene server-rendered (ej. fichas técnicas de
    // aceites); acá solo se rellenan precio y stepper en los slots por data-id.
    if (CFG.static) {
      for (const it of ITEMS) {
        const qty = carrito.get(it.id) || 0
        const buyRow = document.querySelector(`[data-buy="${it.id}"]`)
        if (buyRow) buyRow.hidden = false
        const precioEl = document.querySelector(`.td-precio[data-id="${it.id}"]`)
        if (precioEl) precioEl.textContent = fmt(it.precio)
        const slot = document.querySelector(`.td-slot[data-id="${it.id}"]`)
        if (slot) slot.innerHTML = `
          <div class="td-stepper" data-id="${esc(it.id)}">
            <button type="button" class="td-step-btn" data-d="-1" aria-label="Quitar uno" ${qty ? '' : 'disabled'}>−</button>
            <span class="td-step-num">${qty}</span>
            <button type="button" class="td-step-btn" data-d="1" aria-label="Sumar uno" ${qty >= 10 ? 'disabled' : ''}>+</button>
          </div>`
      }
      barra()
      return
    }
    const cont = document.getElementById('td-items')
    const esMenu = CFG.layout === 'menu'
    cont.innerHTML = ITEMS.map((it) => {
      const qty = carrito.get(it.id) || 0
      const foto = (CFG.fotos || {})[it.id]
      const icono = (CFG.iconos || {})[it.id] || ''
      const stepper = `
        <div class="td-stepper" data-id="${esc(it.id)}">
          <button type="button" class="td-step-btn" data-d="-1" aria-label="Quitar uno" ${qty ? '' : 'disabled'}>−</button>
          <span class="td-step-num">${qty}</span>
          <button type="button" class="td-step-btn" data-d="1" aria-label="Sumar uno" ${qty >= 10 ? 'disabled' : ''}>+</button>
        </div>`
      if (esMenu) {
        return `
          <article class="td-item">
            <span class="td-item-icon" aria-hidden="true">${icono}</span>
            <div class="td-item-body">
              <span class="td-item-text">
                <span class="td-item-label">${esc(it.label)}</span>
                ${it.detalle ? `<span class="td-item-detalle">${esc(it.detalle)}</span>` : ''}
              </span>
              <span class="td-item-precio">${fmt(it.precio)}</span>
              ${stepper}
            </div>
          </article>`
      }
      return `
        <article class="td-item">
          ${foto ? `<img class="td-item-img" src="${esc(foto)}" alt="${esc(it.label)}" loading="lazy" />` : ''}
          <div class="td-item-body">
            <span class="td-item-label">${esc(it.label)}</span>
            ${it.detalle ? `<span class="td-item-detalle">${esc(it.detalle)}</span>` : ''}
            <span class="td-item-precio">${fmt(it.precio)}</span>
            ${stepper}
          </div>
        </article>`
    }).join('')
    barra()
  }

  function actualizarBadge() {
    let n = 0
    for (const [, qty] of carrito) n += qty
    if (ACTIVO) n += ACTIVO.items.reduce((a, i) => a + i.cantidad, 0)
    document.querySelectorAll('[data-carrito-n]').forEach((el) => {
      el.textContent = n
      el.hidden = n === 0
    })
  }
  const barra = actualizarBadge

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.td-step-btn')
    if (!btn) return
    const stepper = btn.closest('.td-stepper')
    const d = Number(btn.getAttribute('data-d'))

    // Stepper de la reserva activa (edición)
    const actKey = stepper.getAttribute('data-act')
    if (actKey) {
      if (!EDIT) return
      const formato = actKey.split('|')[1]
      const tope = TOPE[formato] ?? 10
      const next = Math.max(0, Math.min(tope, (EDIT.get(actKey) ?? 0) + d))
      EDIT.set(actKey, next)
      renderCart()
      return
    }

    // Stepper de selección (fichas o panel)
    const id = stepper.getAttribute('data-id')
    const next = Math.max(0, Math.min(10, (carrito.get(id) || 0) + d))
    if (next === 0) carrito.delete(id)
    else carrito.set(id, next)
    render()
    if (document.getElementById('td-cart')?.classList.contains('is-open')) renderCart()
  })

  // Logout desde la topbar o el drawer
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('.nav-logout, .nav-logout-action')) return
    await fetch('/api/socios/logout', { method: 'POST', credentials: 'include' })
    location.reload()
  })

  // El botón Carrito de la topbar abre el panel (href queda de fallback sin JS)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-cta--carta, .td-pub-carrito')
    if (!btn) return
    e.preventDefault()
    abrirCart()
  })

  async function cargarActivo() {
    try {
      const res = await fetch('/api/socios/pedidos', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      ACTIVO = data.activo || null
      EDIT = null
      actualizarBadge()
      const chip = document.getElementById('td-activo')
      if (!chip) return
      if (data.activo && data.activo.estado === 'pendiente') {
        const n = data.activo.items.reduce((a, i) => a + i.cantidad, 0)
        chip.innerHTML = `Tenés una <strong>reserva en curso</strong> (${n} ítem${n > 1 ? 's' : ''}) — lo que sumes acá se agrega a la misma reserva.`
        chip.classList.add('is-on')
      } else if (data.activo && data.activo.estado === 'listo') {
        chip.innerHTML = `<strong>Tu reserva está lista para retirar</strong> — pasá por el club antes de sumar una nueva.`
        chip.classList.add('is-on')
      }
    } catch { /* silencioso */ }
  }

  async function reservar() {
    const btn = document.getElementById('td-cart-send')
    btn.disabled = true
    btn.textContent = 'Enviando…'
    const items = [...carrito.entries()]
      .filter(([, q]) => q > 0)
      .map(([id, cantidad]) => ({ id, formato: 'producto', cantidad }))
    try {
      const res = await fetch('/api/socios/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ items }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        mensajeCart(data.error || 'No se pudo enviar la reserva.')
        return
      }
      carrito.clear()
      ACTIVO = data.pedido
      render()
      renderCart()
      mensajeCart(data.fusionado ? 'Reserva actualizada ✓ Te esperamos en el club.' : 'Reserva enviada ✓ Te esperamos en el club.')
    } catch {
      mensajeCart('Error de red al enviar la reserva.')
    } finally {
      btn.disabled = false
      btn.textContent = 'Confirmar reserva'
    }
  }

  async function saludar() {
    try {
      const res = await fetch('/api/socios/yo', { credentials: 'include' })
      if (!res.ok) return
      const yo = await res.json()
      const nombre = String(yo.name || '').trim().split(/\s+/)[0] || 'socio'
      document.querySelectorAll('[data-socio-nombre]').forEach((el) => { el.textContent = nombre })
      if (yo.picture) {
        document.querySelectorAll('[data-socio-foto]').forEach((el) => { el.src = yo.picture; el.hidden = false })
      }
      document.querySelectorAll('[data-socio-hola]').forEach((el) => { el.hidden = false })
    } catch { /* el saludo nunca rompe nada */ }
  }

  function showContent(precios) {
    document.body.classList.add('is-socio')
    saludar()
    ITEMS = Array.isArray(precios[CFG.categoria]) ? precios[CFG.categoria] : []
    const login = document.getElementById('td-login')
    if (login) login.hidden = true
    const content = document.getElementById('td-content')
    if (content) content.hidden = false
    const gate = document.getElementById('td-gate')
    if (gate) gate.hidden = true
    render()
    cargarActivo()
  }

  function showLoginError(message) {
    const msg = document.getElementById('td-login-msg')
    if (!msg) return
    msg.textContent = message
    msg.hidden = false
  }

  async function loadPrecios() {
    const res = await fetch('/api/socios/precios', { credentials: 'include' })
    if (!res.ok) {
      if (CFG.public) {
        const gate = document.getElementById('td-gate')
        if (gate) gate.hidden = false
      }
      return false
    }
    const data = await res.json()
    showContent(data.precios || {})
    return true
  }

  window.handleGoogleCredential = async (response) => {
    try {
      const res = await fetch('/api/socios/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credential: response.credential }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        showLoginError(data.error || 'No se pudo verificar tu cuenta.')
        return
      }
      await loadPrecios()
    } catch {
      showLoginError('Error de red al verificar con Google.')
    }
  }

  const logoutBtn = document.getElementById('td-logout')
  if (logoutBtn) logoutBtn.addEventListener('click', async () => {
    await fetch('/api/socios/logout', { method: 'POST', credentials: 'include' })
    location.href = '/socios/'
  })

  const gBtn = document.getElementById('g_id_button')
  if (CFG.googleClientId && gBtn) {
    window.addEventListener('load', () => {
      google.accounts.id.initialize({ client_id: CFG.googleClientId, callback: window.handleGoogleCredential })
      google.accounts.id.renderButton(gBtn, { theme: 'filled_black', size: 'large', text: 'signin_with' })
    })
  } else if (gBtn) {
    showLoginError('Falta configurar el Google Client ID del sitio.')
  }

  loadPrecios()
})()
