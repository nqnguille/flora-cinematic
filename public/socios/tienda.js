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
  const carrito = new Map() // id → cantidad

  function render() {
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

  function barra() {
    const bar = document.getElementById('td-bar')
    let unidades = 0, total = 0
    for (const [id, qty] of carrito) {
      const it = ITEMS.find((x) => x.id === id)
      if (it && qty > 0) { unidades += qty; total += qty * it.precio }
    }
    bar.classList.toggle('is-on', unidades > 0)
    if (unidades > 0) {
      document.getElementById('td-bar-info').innerHTML =
        `${unidades} ítem${unidades > 1 ? 's' : ''} · <strong>${fmt(total)}</strong>`
    }
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.td-step-btn')
    if (!btn) return
    const stepper = btn.closest('.td-stepper')
    const id = stepper.getAttribute('data-id')
    const d = Number(btn.getAttribute('data-d'))
    const next = Math.max(0, Math.min(10, (carrito.get(id) || 0) + d))
    if (next === 0) carrito.delete(id)
    else carrito.set(id, next)
    render()
  })

  async function cargarActivo() {
    try {
      const res = await fetch('/api/socios/pedidos', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      const chip = document.getElementById('td-activo')
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
    const btn = document.getElementById('td-bar-btn')
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
        alert(data.error || 'No se pudo enviar la reserva.')
        return
      }
      carrito.clear()
      render()
      const done = document.getElementById('td-done')
      const lineas = data.pedido.items
        .map((i) => `· ${i.cantidad} × ${i.nombre}${i.formato === 'flor' ? ' (g de flores)' : i.formato === 'preroll' ? ' (preroll)' : ''}`)
        .join('<br>')
      done.querySelector('.td-done-items').innerHTML = lineas
      done.querySelector('h3').textContent = data.fusionado ? 'Reserva actualizada ✓' : 'Reserva enviada ✓'
      done.classList.add('is-on')
      done.scrollIntoView({ behavior: 'smooth', block: 'center' })
      cargarActivo()
    } catch {
      alert('Error de red al enviar la reserva.')
    } finally {
      btn.disabled = false
      btn.textContent = 'Reservar'
    }
  }
  document.getElementById('td-bar-btn').addEventListener('click', reservar)

  function showContent(precios) {
    ITEMS = Array.isArray(precios[CFG.categoria]) ? precios[CFG.categoria] : []
    document.getElementById('td-login').hidden = true
    document.getElementById('td-content').hidden = false
    render()
    cargarActivo()
  }

  function showLoginError(message) {
    const msg = document.getElementById('td-login-msg')
    msg.textContent = message
    msg.hidden = false
  }

  async function loadPrecios() {
    const res = await fetch('/api/socios/precios', { credentials: 'include' })
    if (!res.ok) return false
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

  document.getElementById('td-logout').addEventListener('click', async () => {
    await fetch('/api/socios/logout', { method: 'POST', credentials: 'include' })
    location.href = '/socios/'
  })

  if (CFG.googleClientId) {
    window.addEventListener('load', () => {
      google.accounts.id.initialize({ client_id: CFG.googleClientId, callback: window.handleGoogleCredential })
      google.accounts.id.renderButton(document.getElementById('g_id_button'), {
        theme: 'filled_black', size: 'large', text: 'signin_with',
      })
    })
  } else {
    showLoginError('Falta configurar el Google Client ID del sitio.')
  }

  loadPrecios()
})()
