/* ============================================================
   Panel del club v2 — shell
   Contrato con los módulos (mismo espíritu que roalbaine.team):
     window.Panel.registrar(nombre, { init, cap })
   El shell llama init(cont) UNA sola vez, la primera vez que se
   entra a la sección. `cap` es la capacidad requerida — si el rol
   no la tiene, el botón del rail ni aparece.
   Helpers compartidos: Panel.$, Panel.esc, Panel.fmt, Panel.puede,
   Panel.modal / Panel.confirmar, Panel.me (email, rol, capacidades).
   ============================================================ */
(() => {
  'use strict'

  const $ = (id) => document.getElementById(id)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
  const fmt = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR')
  const fmtN = (n) => (Number(n) || 0).toLocaleString('es-AR')
  const iniciales = (s) => String(s || '?').trim().split(/[\s@.]+/).slice(0, 2).map((p) => (p[0] || '').toUpperCase()).join('') || '?'

  // ---------- cazador de errores: nunca pantalla en blanco muda ----------
  function fatal(msg) {
    const box = $('pn-fatal')
    if (!box) return
    box.querySelector('span').textContent = 'Algo se rompió: ' + msg
    box.classList.add('on')
  }
  window.addEventListener('error', (e) => fatal(e.message || 'error de script'))
  window.addEventListener('unhandledrejection', (e) => fatal((e.reason && e.reason.message) || 'promesa rechazada'))

  // ---------- estado ----------
  const modulos = {}          // nombre -> { init, cap }
  const inicializadas = new Set()
  let me = null               // { email, rol, capacidades }
  let secActual = null

  const NAV_KEY = 'flora_panel_nav'

  const puede = (cap) => !!(me && me.capacidades && me.capacidades.includes(cap))

  // ---------- navegación ----------
  function ir(nombre, silencioso) {
    const sec = $('sec-' + nombre)
    if (!sec) return
    document.querySelectorAll('.pn-sec').forEach((s) => s.classList.toggle('on', s === sec))
    document.querySelectorAll('.pn-rail button[data-sec]').forEach((b) => {
      b.classList.toggle('on', b.dataset.sec === nombre)
      if (b.dataset.sec === nombre) {
        const titulo = $('pn-titulo')
        if (titulo) titulo.textContent = b.dataset.nom || nombre
      }
    })
    secActual = nombre
    const mod = modulos[nombre]
    if (mod && !inicializadas.has(nombre)) {
      inicializadas.add(nombre)
      try { mod.init(sec) } catch (err) { fatal(nombre + ': ' + err.message) }
    }
    if (!silencioso) guardarNav()
  }

  function guardarNav() {
    try {
      const prev = JSON.parse(localStorage.getItem(NAV_KEY) || '{}')
      const y = prev.y || {}
      if (secActual) y[secActual] = window.scrollY
      localStorage.setItem(NAV_KEY, JSON.stringify({ sec: secActual, y }))
    } catch { /* localStorage lleno o bloqueado: se pierde la posición, nada más */ }
  }
  let scrollT = null
  window.addEventListener('scroll', () => {
    clearTimeout(scrollT); scrollT = setTimeout(guardarNav, 300)
  }, { passive: true })

  // F5 vuelve a la misma sección y scroll (reintenta mientras el contenido crece)
  function restaurarNav() {
    let nav = null
    try { nav = JSON.parse(localStorage.getItem(NAV_KEY) || 'null') } catch { /* json roto */ }
    // secciones que se fusionaron: el que trabajaba ahí cae parado en la nueva
    const ALIAS = { reprocann: 'socios' }
    if (nav && ALIAS[nav.sec]) nav.sec = ALIAS[nav.sec]
    const visibles = [...document.querySelectorAll('.pn-rail button[data-sec]')].filter((b) => !b.hidden)
    const primera = visibles.length ? visibles[0].dataset.sec : null
    const destino = nav && nav.sec && visibles.some((b) => b.dataset.sec === nav.sec) ? nav.sec : primera
    if (!destino) return
    ir(destino, true)
    const objetivoY = nav && nav.y ? nav.y[destino] || 0 : 0
    if (!objetivoY) return
    let intentos = 0
    let cancelado = false
    const cancelar = () => { cancelado = true }
    ;['wheel', 'touchstart', 'keydown'].forEach((ev) => window.addEventListener(ev, cancelar, { once: true, passive: true }))
    const timer = setInterval(() => {
      if (cancelado || ++intentos > 24) return clearInterval(timer)
      window.scrollTo(0, objetivoY)
      if (Math.abs(window.scrollY - objetivoY) < 4) clearInterval(timer)
    }, 250)
  }

  // ---------- modal único ----------
  let modAbierto = null
  function modal(titulo, cuerpoHtml, opts = {}) {
    cerrarModal()
    const ov = document.createElement('div')
    ov.className = 'pn-mod-overlay'
    ov.innerHTML = `<div class="pn-mod-card" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <h3>${esc(titulo)}</h3><div class="pn-mod-cuerpo">${cuerpoHtml}</div></div>`
    ov.addEventListener('click', (e) => { if (e.target === ov && !opts.fijo) cerrarModal() })
    document.body.appendChild(ov)
    modAbierto = ov
    document.addEventListener('keydown', escHandler)
    return ov
  }
  function escHandler(e) { if (e.key === 'Escape') cerrarModal() }
  function cerrarModal() {
    if (modAbierto) { modAbierto.remove(); modAbierto = null }
    document.removeEventListener('keydown', escHandler)
  }
  // confirmación de marca (nada de confirm() nativo)
  function confirmar(pregunta, textoOk = 'Sí, seguir') {
    return new Promise((resolve) => {
      const ov = modal('Confirmar', `<p style="margin:0;color:var(--ink2)">${esc(pregunta)}</p>
        <div class="pn-mod-acciones">
          <button class="btn" data-r="no" type="button">Cancelar</button>
          <button class="btn btn-pri" data-r="si" type="button">${esc(textoOk)}</button>
        </div>`, { fijo: true })
      ov.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-r]')
        if (!b) return
        cerrarModal(); resolve(b.dataset.r === 'si')
      })
    })
  }

  // ---------- arranque ----------
  async function quienSoy() {
    const res = await fetch('/api/panel/me', { credentials: 'include' })
    if (res.status === 401) return { estado: 'sin-sesion' }
    if (res.status === 403) return { estado: 'sin-rol' }
    if (!res.ok) return { estado: 'error', detalle: res.status }
    return { estado: 'ok', me: await res.json() }
  }

  function mostrarApp() {
    $('pn-login').hidden = true
    $('pn-forbidden').hidden = true
    $('pn-app').hidden = false
    // identidad
    $('pn-quien-ini').textContent = iniciales(me.email)
    $('pn-quien-mail').textContent = me.email
    // El rol interno es 'dueno'; en la ONG el cargo real es Presidente.
    const ETIQUETA = { dueno: 'Presidente', socio_ong: 'Socio', socio_ong_carga: 'Socio · carga', mostrador: 'Mostrador' }
    $('pn-rol').textContent = ETIQUETA[me.rol] || me.rol
    // el rail solo muestra lo que el rol puede
    document.querySelectorAll('.pn-rail button[data-sec]').forEach((b) => {
      const cap = b.dataset.cap
      b.hidden = !!(cap && !puede(cap))
    })
    restaurarNav()
  }

  async function arrancar() {
    const r = await quienSoy()
    if (r.estado === 'ok') { me = r.me; window.Panel.me = me; mostrarApp(); return }
    if (r.estado === 'sin-rol') { $('pn-login').hidden = true; $('pn-forbidden').hidden = false; return }
    if (r.estado === 'error') {
      $('pn-login-msg').textContent = `El servidor respondió ${r.detalle}. Esperá un momento y recargá.`
      $('pn-login-msg').hidden = false
    }
    // sin sesión: queda la pantalla de login (Google renderiza su botón solo)
  }

  // callback global del botón de Google (mismo flujo que el panel viejo)
  window.handleGoogleCredential = async (response) => {
    try {
      const res = await fetch('/api/socios/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // Contexto admin: el backend no exige el checkbox de términos al staff.
        body: JSON.stringify({ credential: response.credential, appContext: 'admin' }),
      })
      if (!res.ok) {
        $('pn-login-msg').textContent = 'No se pudo iniciar sesión. Probá de nuevo.'
        $('pn-login-msg').hidden = false
        return
      }
      await arrancar()
    } catch (err) {
      $('pn-login-msg').textContent = 'Error de red al iniciar sesión: ' + err.message
      $('pn-login-msg').hidden = false
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.pn-rail button[data-sec]').forEach((b) =>
      b.addEventListener('click', () => ir(b.dataset.sec)))
    const salir = $('pn-salir')
    if (salir) salir.addEventListener('click', async () => {
      await fetch('/api/socios/logout', { method: 'POST', credentials: 'include' })
      try { localStorage.removeItem(NAV_KEY) } catch { /* nada */ }
      location.reload()
    })
    const fatalBox = $('pn-fatal')
    if (fatalBox) fatalBox.querySelector('button').addEventListener('click', () => fatalBox.classList.remove('on'))
    arrancar()
  })

  // ---------- API pública para los módulos ----------
  window.Panel = {
    // El primero que registra gana: los módulos reales cargan antes que
    // mod-placeholders.js, así el placeholder solo cubre lo que falta.
    registrar(nombre, mod) { if (!modulos[nombre]) modulos[nombre] = mod },
    ir,
    get me() { return me },
    set me(v) { me = v },
    puede,
    $, esc, fmt, fmtN, iniciales,
    modal, cerrarModal, confirmar,
    fatal,
  }
})()
