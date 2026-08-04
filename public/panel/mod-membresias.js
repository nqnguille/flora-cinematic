/* Módulo Membresías (prefijo mb-): edita TODO lo que se ve en
   /socios/membresias — los textos de la página y los planes con su importe.
   Un solo documento en KV, un solo lugar donde tocarlo.

   Esa página no está enlazada en ningún lado del sitio: se llega solo con el
   link. Por eso el módulo muestra el link a mano, para copiarlo y mandarlo. */
(() => {
  'use strict'
  const P = window.Panel

  const EP = '/api/socios/admin/membresias'
  const URL_PUBLICA = 'https://floraong.ar/socios/membresias/'
  const MAX_PLANES = 12
  const MAX_NOTAS = 8

  let cont = null
  let DOC = null
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
    if (b) { b.disabled = false; b.textContent = 'Guardar cambios' }
    const m = cont.querySelector('#mb-msg')
    if (m) m.textContent = ''
  }

  /* ---------- planes ---------- */
  function filaPlan(p, i) {
    return `<div class="mb-plan" data-i="${i}">
      <div class="mb-plan-campos">
        <div>
          <label class="lb" for="mb-lab-${i}">Nombre</label>
          <input class="input mb-in" id="mb-lab-${i}" data-campo="label" type="text" maxlength="60" value="${P.esc(p.label || '')}" placeholder="SMALL" />
        </div>
        <div>
          <label class="lb" for="mb-det-${i}">Detalle</label>
          <input class="input mb-in" id="mb-det-${i}" data-campo="detalle" type="text" maxlength="120" value="${P.esc(p.detalle || '')}" placeholder="10 g por mes" />
        </div>
        <div>
          <label class="lb" for="mb-pre-${i}">Aporte mensual</label>
          <input class="input mb-in mb-precio" id="mb-pre-${i}" data-campo="precio" type="number" min="1" step="1" value="${p.precio || ''}" placeholder="0" />
          <span class="mb-precio-fmt">${p.precio ? pesos(p.precio) : ''}</span>
        </div>
      </div>
      <button class="btn mb-borrar" type="button" data-i="${i}" title="Quitar este plan">✕</button>
    </div>`
  }

  function pintarPlanes() {
    const caja = cont.querySelector('#mb-planes')
    caja.innerHTML = DOC.planes.length
      ? DOC.planes.map(filaPlan).join('')
      : '<p class="ct-help" style="margin:0">Todavía no hay planes. Agregá el primero con el botón de abajo.</p>'
    cont.querySelector('#mb-agregar').disabled = DOC.planes.length >= MAX_PLANES
  }

  /* ---------- notas ---------- */
  function filaNota(n, i) {
    return `<div class="mb-nota-fila" data-i="${i}">
      <textarea class="input mb-nota-in" data-i="${i}" rows="2" maxlength="400" placeholder="Una aclaración por línea">${P.esc(n)}</textarea>
      <button class="btn mb-nota-borrar" type="button" data-i="${i}" title="Quitar">✕</button>
    </div>`
  }

  function pintarNotas() {
    const caja = cont.querySelector('#mb-notas')
    caja.innerHTML = DOC.notas.length
      ? DOC.notas.map(filaNota).join('')
      : '<p class="ct-help" style="margin:0">Sin aclaraciones.</p>'
    cont.querySelector('#mb-nota-agregar').disabled = DOC.notas.length >= MAX_NOTAS
  }

  /* ---------- textos ---------- */
  function pintarTextos() {
    const v = (id, val) => { const el = cont.querySelector(id); if (el) el.value = val || '' }
    v('#mb-eyebrow', DOC.eyebrow)
    v('#mb-titulo', DOC.titulo)
    v('#mb-titulo-em', DOC.tituloEm)
    v('#mb-lead', DOC.lead)
    v('#mb-nota-titulo', DOC.notaTitulo)
    v('#mb-cta-carta', DOC.ctaCarta)
    v('#mb-cta-wa', DOC.ctaWhatsapp)
  }

  function leerTextos() {
    const g = (id) => (cont.querySelector(id)?.value ?? '').trim()
    DOC.eyebrow = g('#mb-eyebrow')
    DOC.titulo = g('#mb-titulo')
    DOC.tituloEm = g('#mb-titulo-em')
    DOC.lead = g('#mb-lead')
    DOC.notaTitulo = g('#mb-nota-titulo')
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
        msg.style.color = 'var(--mal, #e0767c)'
        btn.disabled = false
        btn.textContent = 'Guardar cambios'
        return
      }
      DOC = d.membresias
      sucio = false
      pintarTextos(); pintarPlanes(); pintarNotas()
      msg.style.color = ''
      msg.textContent = 'Guardado. Ya se ve en la página.'
      btn.textContent = 'Sin cambios'
    } catch {
      msg.textContent = 'No se pudo conectar. Probá de nuevo.'
      msg.style.color = 'var(--mal, #e0767c)'
      btn.disabled = false
      btn.textContent = 'Guardar cambios'
    }
  }

  async function cargar() {
    const caja = cont.querySelector('#mb-cuerpo')
    try {
      const res = await fetch(EP, { credentials: 'include' })
      if (!res.ok) { caja.innerHTML = `<p class="ct-help">${P.esc(errHttp(res.status))}</p>`; return }
      const d = await res.json()
      DOC = d.membresias
      caja.hidden = false
      pintarTextos(); pintarPlanes(); pintarNotas()
    } catch {
      caja.innerHTML = '<p class="ct-help">No se pudo cargar. Revisá la conexión.</p>'
    }
  }

  P.registrar('membresias', {
    init(el) {
      cont = el
      el.innerHTML = `
        <div class="card" style="margin-bottom:14px">
          <span class="k">La página</span>
          <p style="color:var(--muted);font-size:13px;margin:8px 0 10px">
            No está enlazada en ninguna parte del sitio, ni siquiera para socios: se llega
            solamente con este link. Se abre únicamente con sesión de socio activo.
          </p>
          <div class="fila">
            <code class="mb-url">${URL_PUBLICA}</code>
            <button class="btn" id="mb-copiar" type="button">Copiar link</button>
            <a class="btn" href="${URL_PUBLICA}" target="_blank" rel="noopener">Ver la página</a>
          </div>
        </div>

        <div id="mb-cuerpo" hidden>
          <div class="card" style="margin-bottom:14px">
            <span class="k">Planes</span>
            <p class="ct-help" style="margin:6px 0 12px">El importe es lo que el socio aporta por mes. Un plan sin importe no se guarda.</p>
            <div id="mb-planes"></div>
            <div class="fila" style="margin-top:12px">
              <button class="btn" id="mb-agregar" type="button">+ Agregar plan</button>
            </div>
          </div>

          <div class="grid2" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start">
            <div class="card">
              <span class="k">Encabezado</span>
              <div style="display:grid;gap:10px;margin-top:12px">
                <div><label class="lb" for="mb-eyebrow">Etiqueta de arriba</label>
                  <input class="input mb-txt" id="mb-eyebrow" type="text" maxlength="60" /></div>
                <div><label class="lb" for="mb-titulo">Título</label>
                  <input class="input mb-txt" id="mb-titulo" type="text" maxlength="80" /></div>
                <div><label class="lb" for="mb-titulo-em">Parte del título en cursiva</label>
                  <input class="input mb-txt" id="mb-titulo-em" type="text" maxlength="80" />
                  <p class="ct-help" style="margin:6px 0 0">Se muestra en verde, a continuación del título.</p></div>
                <div><label class="lb" for="mb-lead">Bajada</label>
                  <textarea class="input mb-txt" id="mb-lead" rows="4" maxlength="600"></textarea></div>
              </div>
            </div>

            <div class="card">
              <span class="k">Aclaraciones del pie</span>
              <div style="display:grid;gap:10px;margin-top:12px">
                <div><label class="lb" for="mb-nota-titulo">Título del bloque</label>
                  <input class="input mb-txt" id="mb-nota-titulo" type="text" maxlength="60" /></div>
                <div id="mb-notas" style="display:grid;gap:8px"></div>
                <div class="fila"><button class="btn" id="mb-nota-agregar" type="button">+ Agregar aclaración</button></div>
                <div style="border-top:1px solid var(--linea,rgba(255,255,255,.08));padding-top:10px">
                  <label class="lb" for="mb-cta-carta">Texto del botón a la carta</label>
                  <input class="input mb-txt" id="mb-cta-carta" type="text" maxlength="60" />
                </div>
                <div><label class="lb" for="mb-cta-wa">Texto del botón de WhatsApp</label>
                  <input class="input mb-txt" id="mb-cta-wa" type="text" maxlength="60" /></div>
              </div>
            </div>
          </div>

          <div class="fila mb-barra">
            <button class="btn btn-pri" id="mb-guardar" type="button" disabled>Sin cambios</button>
            <span id="mb-msg" class="msg"></span>
          </div>
        </div>`

      // ── textos ──
      el.addEventListener('input', (e) => {
        const t = e.target
        if (t.classList.contains('mb-txt')) { marcarSucio(); return }
        // ── planes ──
        if (t.classList.contains('mb-in')) {
          const fila = t.closest('.mb-plan')
          const i = Number(fila.dataset.i)
          const campo = t.dataset.campo
          DOC.planes[i][campo] = campo === 'precio' ? Number(t.value) : t.value
          if (campo === 'precio') {
            const fmt = fila.querySelector('.mb-precio-fmt')
            if (fmt) fmt.textContent = t.value ? pesos(t.value) : ''
          }
          marcarSucio()
          return
        }
        // ── notas ──
        if (t.classList.contains('mb-nota-in')) {
          DOC.notas[Number(t.dataset.i)] = t.value
          marcarSucio()
        }
      })

      el.addEventListener('click', async (e) => {
        const copiar = e.target.closest('#mb-copiar')
        if (copiar) {
          try {
            await navigator.clipboard.writeText(URL_PUBLICA)
            copiar.textContent = 'Copiado'
            setTimeout(() => { copiar.textContent = 'Copiar link' }, 1600)
          } catch { /* sin permiso de portapapeles: el link está a la vista igual */ }
          return
        }
        if (e.target.closest('#mb-agregar')) {
          DOC.planes.push({ id: '', label: '', detalle: '', precio: 0 })
          pintarPlanes(); marcarSucio(); return
        }
        const borrar = e.target.closest('.mb-borrar')
        if (borrar) {
          const i = Number(borrar.dataset.i)
          const nom = DOC.planes[i]?.label || 'este plan'
          if (!(await P.confirmar(`¿Quitar ${nom} de la lista?`, 'Sí, quitar'))) return
          DOC.planes.splice(i, 1)
          pintarPlanes(); marcarSucio(); return
        }
        if (e.target.closest('#mb-nota-agregar')) {
          DOC.notas.push('')
          pintarNotas(); marcarSucio(); return
        }
        const bn = e.target.closest('.mb-nota-borrar')
        if (bn) {
          DOC.notas.splice(Number(bn.dataset.i), 1)
          pintarNotas(); marcarSucio(); return
        }
        if (e.target.closest('#mb-guardar')) guardar()
      })

      // Aviso al salir con cambios sin guardar: el documento vive en KV, si se
      // cierra la pestaña no queda nada a medias.
      window.addEventListener('beforeunload', (e) => {
        if (!sucio) return
        e.preventDefault()
        e.returnValue = ''
      })

      cargar()
    },
  })
})()
