/* Módulo Membresías (prefijo mb-): edita todo lo que se ve en
   /socios/membresias.

   Los planes NO se editan acá: viven en la tabla `precios` de D1, que es la
   misma que usan el alta de socios, la cobranza y el panel de Mercado Pago.
   Arriba se muestran en solo lectura para poder chequearlos de un vistazo, y
   lo editable son los rótulos con que se muestran y los textos de la página.

   Esa página no está enlazada en ningún lado del sitio: se llega solo con el
   link, por eso arriba está a mano para copiarlo. */
(() => {
  'use strict'
  const P = window.Panel

  const EP = '/api/socios/admin/membresias'
  const URL_PUBLICA = 'https://floraong.ar/socios/membresias/'
  const MAX_NOTAS = 8

  let cont = null
  let DOC = null
  let PLANES = []
  let ESTADOS = []
  let sucio = false

  function errHttp(status) {
    if (status === 401) return 'Tu sesión venció. Recargá la página y volvé a entrar.'
    if (status === 403) return 'Tu rol no tiene permiso para editar esto.'
    return 'El servidor respondió ' + status + '. Probá de nuevo en un rato.'
  }

  const pesos = (n) => '$' + Number(n || 0).toLocaleString('es-AR')

  function marcarSucio() {
    sucio = true
    const b = cont.querySelector('#mb-guardar')
    if (b) { b.disabled = false; b.textContent = 'Guardar' }
    const m = cont.querySelector('#mb-msg')
    if (m) { m.textContent = ''; m.style.color = '' }
  }

  /* ---------- planes (solo lectura: viven en la lista de precios) ---------- */
  function pintarPlanes() {
    const caja = cont.querySelector('#mb-filas')
    if (!PLANES.length) {
      caja.innerHTML = '<p class="ct-help" style="margin:8px 0 0">No hay membresías en la lista de precios vigente.</p>'
      return
    }
    caja.innerHTML = PLANES.map((p) => `<div class="mb-fila mb-ro">
      <b>${P.esc(p.item)}</b>
      <span>${p.gramos ? p.gramos + ' g/mes' : '—'}</span>
      <span class="mb-num">${p.contado ? pesos(p.contado) : '—'}</span>
      <span class="mb-num">${p.debito ? pesos(p.debito) : '—'}</span>
      <span class="mb-mp">${p.linkDebito ? '✓ débito' : '—'}</span>
    </div>`).join('')
  }

  /* ---------- quién puede adherirse ---------- */
  function pintarEstados() {
    const caja = cont.querySelector('#mb-estados')
    if (!ESTADOS.length) { caja.innerHTML = '<p class="ct-help" style="margin:0">No se pudieron leer los estados.</p>'; return }
    const activos = new Set(DOC.estadosAdhesion || [])
    caja.innerHTML = ESTADOS.map((e) => `<label class="mb-estado${activos.has(e.id) ? ' on' : ''}">
      <input type="checkbox" class="mb-est-chk" value="${P.esc(e.id)}"${activos.has(e.id) ? ' checked' : ''} />
      <span class="mb-estado-nom">${P.esc(e.nombre)}</span>
      <span class="mb-estado-n">${e.conMembresia} con membresía${e.socios !== e.conMembresia ? ` · ${e.socios} en total` : ''}</span>
      <span class="mb-estado-ay">${P.esc(e.ayuda)}</span>
    </label>`).join('')
    pintarTotal()
  }

  // El número que importa: cuántos socios con membresía activa quedan
  // habilitados con los estados tildados en este momento.
  function pintarTotal() {
    const activos = new Set(DOC.estadosAdhesion || [])
    const hab = ESTADOS.filter((e) => activos.has(e.id)).reduce((s, e) => s + e.conMembresia, 0)
    const tot = ESTADOS.reduce((s, e) => s + e.conMembresia, 0)
    const el = cont.querySelector('#mb-total')
    if (!el) return
    el.textContent = `${hab} de ${tot} socios con membresía activa pueden adherirse`
    el.className = 'mb-total' + (hab === 0 ? ' mal' : '')
  }

  /* ---------- textos ---------- */
  function pintarTextos() {
    const v = (id, val) => { const el = cont.querySelector(id); if (el) el.value = val ?? '' }
    v('#mb-et1', DOC.etiquetaPrecio)
    v('#mb-et2', DOC.etiquetaPrecio2)
    v('#mb-eyebrow', DOC.eyebrow)
    v('#mb-titulo', DOC.titulo)
    v('#mb-titulo-em', DOC.tituloEm)
    v('#mb-lead', DOC.lead)
    v('#mb-nota-titulo', DOC.notaTitulo)
    v('#mb-notas', (DOC.notas || []).join('\n'))
    v('#mb-cta-carta', DOC.ctaCarta)
    v('#mb-cta-wa', DOC.ctaWhatsapp)
  }

  function leerTextos() {
    const g = (id) => (cont.querySelector(id)?.value ?? '').trim()
    DOC.etiquetaPrecio = g('#mb-et1')
    DOC.etiquetaPrecio2 = g('#mb-et2')
    DOC.eyebrow = g('#mb-eyebrow')
    DOC.titulo = g('#mb-titulo')
    DOC.tituloEm = g('#mb-titulo-em')
    DOC.lead = g('#mb-lead')
    DOC.notaTitulo = g('#mb-nota-titulo')
    // Una aclaración por renglón: más simple que una lista de cajitas, cada
    // una con su propio botón de borrar.
    DOC.notas = g('#mb-notas').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, MAX_NOTAS)
    DOC.ctaCarta = g('#mb-cta-carta')
    DOC.ctaWhatsapp = g('#mb-cta-wa')
  }

  /* ---------- guardar ---------- */
  async function guardar() {
    leerTextos()
    const btn = cont.querySelector('#mb-guardar')
    const msg = cont.querySelector('#mb-msg')
    btn.disabled = true
    btn.textContent = 'Guardando…'
    try {
      const res = await fetch(EP, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membresias: DOC }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) {
        msg.textContent = d.error || errHttp(res.status)
        msg.style.color = 'var(--dan)'
        btn.disabled = false
        btn.textContent = 'Guardar'
        return
      }
      DOC = d.membresias
      sucio = false
      pintarTextos(); pintarPlanes(); pintarEstados()
      msg.style.color = ''
      msg.textContent = 'Guardado.'
      btn.textContent = 'Sin cambios'
    } catch {
      msg.textContent = 'No se pudo conectar. Probá de nuevo.'
      msg.style.color = 'var(--dan)'
      btn.disabled = false
      btn.textContent = 'Guardar'
    }
  }

  async function cargar() {
    const caja = cont.querySelector('#mb-cuerpo')
    try {
      const res = await fetch(EP, { credentials: 'include' })
      if (!res.ok) { caja.innerHTML = `<p class="ct-help">${P.esc(errHttp(res.status))}</p>`; caja.hidden = false; return }
      DOC = (await res.json()).membresias
      // Los planes se leen de la lista de precios vigente, que es donde de
      // verdad viven: acá se muestran para poder chequearlos de un vistazo.
      try {
        const pr = await fetch('/api/socios/admin/membresias?planes=1', { credentials: 'include' })
        if (pr.ok) PLANES = (await pr.json()).planes || []
      } catch { PLANES = [] }
      try {
        const er = await fetch(EP + '?estados=1', { credentials: 'include' })
        if (er.ok) ESTADOS = (await er.json()).estados || []
      } catch { ESTADOS = [] }
      caja.hidden = false
      pintarTextos(); pintarPlanes(); pintarEstados()
    } catch {
      caja.innerHTML = '<p class="ct-help">No se pudo cargar. Revisá la conexión.</p>'
      caja.hidden = false
    }
  }

  P.registrar('membresias', {
    init(el) {
      cont = el
      el.innerHTML = `
        <div class="fila mb-link">
          <code class="mb-url">${URL_PUBLICA}</code>
          <button class="btn" id="mb-copiar" type="button">Copiar link</button>
          <a class="btn" href="${URL_PUBLICA}" target="_blank" rel="noopener">Ver</a>
        </div>
        <p class="mb-link-nota">No está enlazada en el sitio: se llega solo con este link, y con sesión de socio activo.</p>

        <div id="mb-cuerpo" hidden>
          <div class="card">
            <div class="mb-fila mb-cab mb-ro">
              <span class="lb">Membresía</span>
              <span class="lb">Gramos</span>
              <input class="input mb-et" id="mb-et1" type="text" maxlength="40" placeholder="Primer importe" aria-label="Rótulo del primer importe" />
              <input class="input mb-et" id="mb-et2" type="text" maxlength="40" placeholder="Segundo importe" aria-label="Rótulo del segundo importe" />
              <span class="lb">MP</span>
            </div>
            <div id="mb-filas"></div>
            <p class="ct-help" style="margin:12px 0 0">Los planes y sus importes salen de la lista de precios vigente, la misma que usan el alta de socios, la cobranza y el panel de Mercado Pago. Acá se editan solo los rótulos con que se muestran en la página.</p>
          </div>

          <div class="card">
            <span class="k">Quién puede adherirse al débito</span>
            <p class="ct-help" style="margin:6px 0 12px">Solo los socios cuyo trámite de REPROCANN esté en alguno de los estados tildados. El resto ve el motivo y el paso que le falta.</p>
            <div id="mb-estados" class="mb-estados"></div>
            <p id="mb-total" class="mb-total"></p>
          </div>

          <details class="card mb-textos">
            <summary>Textos de la página</summary>
            <div class="mb-textos-grid">
              <div><label class="lb" for="mb-eyebrow">Etiqueta de arriba</label>
                <input class="input mb-txt" id="mb-eyebrow" type="text" maxlength="60" /></div>
              <div><label class="lb" for="mb-nota-titulo">Título del bloque del pie</label>
                <input class="input mb-txt" id="mb-nota-titulo" type="text" maxlength="60" /></div>
              <div><label class="lb" for="mb-titulo">Título</label>
                <input class="input mb-txt" id="mb-titulo" type="text" maxlength="80" /></div>
              <div><label class="lb" for="mb-titulo-em">Título, parte en cursiva</label>
                <input class="input mb-txt" id="mb-titulo-em" type="text" maxlength="80" /></div>
              <div class="mb-ancho"><label class="lb" for="mb-lead">Bajada</label>
                <textarea class="input mb-txt" id="mb-lead" rows="3" maxlength="600"></textarea></div>
              <div class="mb-ancho"><label class="lb" for="mb-notas">Aclaraciones del pie <span class="mb-hint">una por renglón</span></label>
                <textarea class="input mb-txt" id="mb-notas" rows="4"></textarea></div>
              <div><label class="lb" for="mb-cta-carta">Botón a la carta</label>
                <input class="input mb-txt" id="mb-cta-carta" type="text" maxlength="60" /></div>
              <div><label class="lb" for="mb-cta-wa">Botón de WhatsApp</label>
                <input class="input mb-txt" id="mb-cta-wa" type="text" maxlength="60" /></div>
            </div>
          </details>

          <div class="fila mb-barra">
            <button class="btn btn-pri" id="mb-guardar" type="button" disabled>Sin cambios</button>
            <span id="mb-msg" class="msg"></span>
          </div>
        </div>`

      el.addEventListener('input', (e) => {
        const t = e.target
        if (t.classList.contains('mb-et') || t.classList.contains('mb-txt')) marcarSucio()
      })

      el.addEventListener('change', (e) => {
        const chk = e.target.closest('.mb-est-chk')
        if (!chk) return
        const set = new Set(DOC.estadosAdhesion || [])
        if (chk.checked) set.add(chk.value); else set.delete(chk.value)
        DOC.estadosAdhesion = [...set]
        chk.closest('.mb-estado').classList.toggle('on', chk.checked)
        pintarTotal()
        marcarSucio()
      })

      el.addEventListener('click', async (e) => {
        const copiar = e.target.closest('#mb-copiar')
        if (copiar) {
          try {
            await navigator.clipboard.writeText(URL_PUBLICA)
            copiar.textContent = 'Copiado'
            setTimeout(() => { copiar.textContent = 'Copiar link' }, 1600)
          } catch { /* sin portapapeles: el link está a la vista igual */ }
          return
        }
        if (e.target.closest('#mb-guardar')) guardar()
      })

      // El documento vive en KV: si se cierra la pestaña con cambios sin
      // guardar, se pierden.
      window.addEventListener('beforeunload', (e) => {
        if (!sucio) return
        e.preventDefault()
        e.returnValue = ''
      })

      cargar()
    },
  })
})()
