/* Módulo Catálogo (prefijo ct-): genéticas (Flores) + productos con precio
   (Aceites, Cremas, Extracciones). Porteo del panel viejo (/socios/admin/):
   mismos endpoints, control de versión optimista en genéticas incluido. */
(() => {
  'use strict'
  const P = window.Panel

  const EP_GENETICAS = '/api/socios/admin/geneticas'
  const EP_PRECIOS = '/api/socios/admin/precios'
  const EP_FOTO = '/api/socios/admin/foto'

  let cont = null
  let CATALOG = []
  let CATALOG_VERSION = 0 // control de concurrencia optimista (409 si otro guardó)
  let PRECIOS = { membresias: [], aceites: [], cremas: [], extracciones: [] }
  let PRECIOS_ORIG = {}   // para detectar saltos de precio >50% al guardar
  let genDirty = 0
  let prodDirty = 0
  let sub = 'flores'      // flores | aceites | cremas | extracciones
  let filtroDisp = ''     // '' | 'on' | 'off'
  let q = ''

  const CAT_LABEL = { membresias: 'Membresías · planes de flores', aceites: 'Aceites', cremas: 'Cremas', extracciones: 'Extracciones · cartuchos y baterías' }

  /* ---------- helpers ---------- */
  function errHttp(status) {
    if (status === 401) return 'Tu sesión venció — recargá la página y volvé a entrar.'
    if (status === 403) return 'Tu rol no tiene permiso para ver esto.'
    return 'El servidor respondió ' + status + '. Probá de nuevo en un rato.'
  }
  function slugify(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  }
  function tipoLabel(t) { return t === 'hibrida' ? 'Híbrida' : t === 'cbd' ? 'Full CBD' : String(t || '').charAt(0).toUpperCase() + String(t || '').slice(1) }
  // Datos viejos traían THC/CBD como texto libre ("27% THC", "<1% CBD") — se
  // recupera el número si se puede (se descartan ratios tipo "1:1").
  function numOnly(v) {
    const s = String(v ?? '').trim()
    if (!s || /\d\s*:\s*\d/.test(s)) return ''
    const m = /([\d.]+)/.exec(s)
    return m ? m[1] : ''
  }
  function normalizar(list) {
    (list || []).forEach((g) => { g.thc = numOnly(g.thc); g.cbd = numOnly(g.cbd) })
    ;(list || []).sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }))
  }
  function bancoOptions(actual) {
    const bancos = window.FLORA_BANCOS || {}
    return Object.entries(bancos)
      .map(([slug, b]) => `<option value="${P.esc(slug)}"${slug === actual ? ' selected' : ''}>${P.esc(b.nombre)}</option>`)
      .join('') + `<option value=""${!(actual in bancos) ? ' selected' : ''}>Otro</option>`
  }
  // bancos.js vive en /socios/ (lo usa la carta): se carga dinámico para no
  // tocar el astro del shell.
  function cargarBancos() {
    return new Promise((resolve) => {
      if (window.FLORA_BANCOS) return resolve()
      const s = document.createElement('script')
      s.src = '/socios/bancos.js'
      s.onload = () => resolve()
      s.onerror = () => { window.FLORA_BANCOS = window.FLORA_BANCOS || {}; resolve() }
      document.head.appendChild(s)
    })
  }

  // feedback inline; al apagarse vuelve a mostrar los cambios sin guardar
  let genMsgT = null
  function avisoGen(texto, clase) {
    const el = cont.querySelector('#ct-gen-msg')
    if (!el) return
    clearTimeout(genMsgT)
    el.className = 'msg' + (clase ? ' ' + clase : '')
    el.textContent = texto
    if (texto) genMsgT = setTimeout(pintarDirtyGen, 4000)
  }
  function pintarDirtyGen() {
    const el = cont.querySelector('#ct-gen-msg')
    if (!el) return
    el.className = 'msg'
    el.textContent = genDirty ? `${genDirty} cambio${genDirty === 1 ? '' : 's'} sin guardar` : ''
  }
  let prodMsgT = null
  function avisoProd(texto, clase, ms) {
    const el = cont.querySelector('#ct-prod-msg')
    if (!el) return
    clearTimeout(prodMsgT)
    el.className = 'msg' + (clase ? ' ' + clase : '')
    el.textContent = texto
    if (texto) prodMsgT = setTimeout(pintarDirtyProd, ms || 4000)
  }
  function pintarDirtyProd() {
    const el = cont.querySelector('#ct-prod-msg')
    if (!el) return
    el.className = 'msg'
    el.textContent = prodDirty ? `${prodDirty} cambio${prodDirty === 1 ? '' : 's'} sin guardar` : ''
  }

  /* ---------- Flores (genéticas) ---------- */
  function filaGen(g, idx) {
    const fotoSrc = g.foto || (g.id && !String(g.id).startsWith('nueva-') ? `/socios/geneticas/${g.id}.webp` : '')
    const formatos = g.formatos && g.formatos.length ? g.formatos : ['flor']
    const seg = [['flor', 'Flor'], ['preroll', 'Preroll']].map(([val, lab]) => {
      const on = formatos.includes(val)
      return `<button type="button" class="ct-fbtn${on ? ' on' : ''}" data-fmt="${val}" data-idx="${idx}" aria-pressed="${on}">${lab}</button>`
    }).join('')
    return `<tr data-idx="${idx}">
      <td><button type="button" class="sw${g.activo ? ' on' : ''} ct-sw" data-idx="${idx}" role="switch" aria-checked="${g.activo ? 'true' : 'false'}" aria-label="Disponible en la carta"></button></td>
      <td><input class="input ct-nombre" data-field="nombre" data-idx="${idx}" value="${P.esc(g.nombre)}" placeholder="Nombre" title="${P.esc(g.nombre)}" /></td>
      <td><select class="sel ct-banco" data-field="bancoSlug" data-idx="${idx}">${bancoOptions(g.bancoSlug)}</select></td>
      <td><select class="sel ct-tipo" data-field="tipo" data-idx="${idx}">${['sativa', 'indica', 'hibrida', 'cbd'].map((t) => `<option value="${t}"${g.tipo === t ? ' selected' : ''}>${tipoLabel(t)}</option>`).join('')}</select></td>
      <td><input class="input ct-num" type="number" step="0.1" min="0" data-field="thc" data-idx="${idx}" value="${P.esc(g.thc)}" placeholder="0" /></td>
      <td><input class="input ct-num" type="number" step="0.1" min="0" data-field="cbd" data-idx="${idx}" value="${P.esc(g.cbd)}" placeholder="0" /></td>
      <td><div class="ct-seg">${seg}</div></td>
      <td><div class="ct-foto">
        <span class="ct-thumb">${fotoSrc ? `<img src="${P.esc(fotoSrc)}" alt="" onerror="this.remove()" />` : ''}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" id="ct-foto-${idx}" class="ct-foto-in" data-idx="${idx}" hidden />
        <label for="ct-foto-${idx}" class="btn ct-foto-btn">Foto</label>
        <span class="msg" data-fotostatus="${idx}"></span>
      </div></td>
      <td class="r"><button type="button" class="btn btn-peligro ct-gen-del" data-idx="${idx}">Quitar</button></td>
    </tr>`
  }

  function renderFlores() {
    const el = cont.querySelector('#ct-gen-lista')
    const term = q.toLowerCase()
    const filas = CATALOG.map((g, i) => {
      if (filtroDisp === 'on' && !g.activo) return ''
      if (filtroDisp === 'off' && g.activo) return ''
      if (term && !String(g.nombre || '').toLowerCase().includes(term)) return ''
      return filaGen(g, i)
    }).join('')
    const disp = CATALOG.filter((g) => g.activo).length
    cont.querySelector('#ct-count').textContent = `${P.fmtN(disp)} disponibles · ${P.fmtN(CATALOG.length)} en total`
    el.innerHTML = filas
      ? `<div class="ct-scroll"><table class="tabla"><thead><tr>
          <th>Disp.</th><th>Nombre</th><th>Banco</th><th>Tipo</th><th>THC %</th><th>CBD %</th><th>Formatos</th><th>Foto</th><th class="r"></th>
        </tr></thead><tbody>${filas}</tbody></table></div>`
      : `<div class="vacio">${CATALOG.length ? 'Ninguna genética coincide con el filtro.' : 'Todavía no hay genéticas cargadas.'}</div>`
  }

  // Disponibilidad: autoguarda con PATCH (solo si ya existe en el servidor)
  async function autoSaveActivo(i) {
    const g = CATALOG[i]
    if (!g.id || String(g.id).startsWith('nueva-')) { avisoGen('Tocá Guardar cambios para aplicar la disponibilidad', 'err'); return }
    try {
      const res = await fetch(EP_GENETICAS, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: g.id, activo: g.activo }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.version) CATALOG_VERSION = data.version
      avisoGen(res.ok ? '✔ disponibilidad guardada' : '✗ ' + (data.error || errHttp(res.status)), res.ok ? 'ok' : 'err')
    } catch { avisoGen('✗ error de red', 'err') }
  }

  async function guardarGeneticas() {
    const btn = cont.querySelector('#ct-save')
    avisoGen('⏳ guardando…')
    btn.disabled = true
    CATALOG.forEach((g) => {
      if (!g.id || String(g.id).startsWith('nueva-')) g.id = slugify(g.nombre) || `genetica-${Date.now()}`
      g.banco = ((window.FLORA_BANCOS || {})[g.bancoSlug] || {}).nombre || g.banco || ''
    })
    try {
      const res = await fetch(EP_GENETICAS, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geneticas: CATALOG, version: CATALOG_VERSION }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        genDirty = 0
        CATALOG_VERSION = data.version || CATALOG_VERSION
        avisoGen('✔ guardado', 'ok')
      } else if (res.status === 409 && data.conflict) {
        // Otro admin guardó desde que esta pantalla cargó — no pisamos: se
        // recarga la versión del servidor y se avisa (las ediciones sin
        // guardar de esta pantalla se pierden, mejor que pisar las del otro).
        CATALOG = data.geneticas || CATALOG
        normalizar(CATALOG)
        CATALOG_VERSION = data.version || CATALOG_VERSION
        genDirty = 0
        renderFlores()
        avisoGen('Otro admin guardó primero — se recargó su versión, revisá y volvé a aplicar tus cambios.', 'err')
      } else {
        avisoGen('✗ ' + (data.error || errHttp(res.status)), 'err')
      }
    } catch {
      avisoGen('✗ error de red al guardar', 'err')
    }
    btn.disabled = false
  }

  async function cargarGeneticas() {
    const el = cont.querySelector('#ct-gen-lista')
    el.innerHTML = '<div class="vacio">⏳ Cargando…</div>'
    try {
      const res = await fetch(EP_GENETICAS, { credentials: 'include' })
      if (!res.ok) { el.innerHTML = `<div class="vacio">${P.esc(errHttp(res.status))}</div>`; return }
      const data = await res.json().catch(() => ({}))
      CATALOG = data.geneticas || []
      normalizar(CATALOG)
      CATALOG_VERSION = data.version || 0
      renderFlores()
    } catch {
      el.innerHTML = '<div class="vacio">Error de red al cargar las genéticas — revisá la conexión y probá de nuevo.</div>'
    }
  }

  /* ---------- Aceites / Cremas / Extracciones (precios) ---------- */
  function tarjetaProd(cat, it, idx) {
    return `<div class="ct-prod" data-cat="${P.esc(cat)}" data-pidx="${idx}">
      <div class="ct-prod-foto">
        <span class="ct-thumb ct-thumb-g">${it.foto ? `<img src="${P.esc(it.foto)}" alt="" onerror="this.remove()" />` : ''}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" id="ct-pfoto-${P.esc(cat)}-${idx}" class="ct-prod-fotoin" data-cat="${P.esc(cat)}" data-pidx="${idx}" hidden />
        <label for="ct-pfoto-${P.esc(cat)}-${idx}" class="btn ct-foto-btn">Foto</label>
      </div>
      <div class="ct-prod-main">
        <input class="input" data-pfield="label" data-cat="${P.esc(cat)}" data-pidx="${idx}" value="${P.esc(it.label)}" placeholder="Nombre" />
        <input class="input" data-pfield="detalle" data-cat="${P.esc(cat)}" data-pidx="${idx}" value="${P.esc(it.detalle)}" placeholder="Detalle (ej. THC · 0,5 ml)" />
        <div class="ct-precio">
          <input class="input ct-precio-in" inputmode="numeric" data-pfield="precio" data-cat="${P.esc(cat)}" data-pidx="${idx}" value="${P.esc(it.precio || '')}" placeholder="0" />
          <span class="ct-precio-fmt">${P.fmt(it.precio)}</span>
        </div>
      </div>
      <button type="button" class="btn btn-peligro ct-prod-del" data-cat="${P.esc(cat)}" data-pidx="${idx}" aria-label="Eliminar producto">Quitar</button>
    </div>`
  }

  function renderProds() {
    if (!CAT_LABEL[sub]) return
    const items = PRECIOS[sub] || []
    cont.querySelector('#ct-prod-titulo').textContent = CAT_LABEL[sub]
    cont.querySelector('#ct-prod-count').textContent = `${P.fmtN(items.length)} producto${items.length === 1 ? '' : 's'}`
    cont.querySelector('#ct-prod-lista').innerHTML = items.length
      ? `<div class="ct-prods">${items.map((it, i) => tarjetaProd(sub, it, i)).join('')}</div>`
      : '<div class="vacio">Sin productos en esta categoría todavía.</div>'
    pintarDirtyProd()
  }

  async function cargarPrecios() {
    try {
      const res = await fetch(EP_PRECIOS, { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) { avisoProd('✗ ' + (data.error || errHttp(res.status)), 'err'); return }
      PRECIOS = data.precios || PRECIOS
      PRECIOS_ORIG = {}
      for (const it of Object.values(PRECIOS).flat()) PRECIOS_ORIG[it.id] = it.precio
      if (CAT_LABEL[sub]) renderProds()
    } catch {
      avisoProd('✗ error de red al cargar los precios', 'err')
    }
  }

  async function guardarPrecios() {
    // Precio en $0: casi siempre un campo que quedó vacío por error — se
    // bloquea el guardado señalando el/los productos.
    const sinPrecio = Object.values(PRECIOS).flat().filter((it) => !(it.precio > 0))
    if (sinPrecio.length) {
      avisoProd(`Sin precio: ${sinPrecio.map((it) => it.label || '(sin nombre)').join(', ')} — completá el precio antes de guardar.`, 'err', 8000)
      return
    }
    // Saltos >50%: el error más caro del panel es un cero de más o de menos
    const saltos = Object.values(PRECIOS).flat().filter((it) => {
      const antes = PRECIOS_ORIG[it.id]
      return antes > 0 && it.precio > 0 && Math.abs(it.precio - antes) / antes > 0.5
    })
    if (saltos.length) {
      const detalle = saltos.map((it) => `${it.label}: ${P.fmt(PRECIOS_ORIG[it.id])} → ${P.fmt(it.precio)}`).join(' · ')
      if (!(await P.confirmar(`Cambio grande de precio — ${detalle}. ¿Está bien?`, 'Sí, guardar'))) return
    }
    for (const items of Object.values(PRECIOS)) {
      for (const it of items) if (!it.id || String(it.id).startsWith('nuevo-')) it.id = slugify(it.label) || `producto-${Date.now().toString(36)}`
    }
    avisoProd('⏳ guardando…')
    try {
      const res = await fetch(EP_PRECIOS, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ precios: PRECIOS }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        PRECIOS = data.precios || PRECIOS
        prodDirty = 0
        PRECIOS_ORIG = {}
        for (const it of Object.values(PRECIOS).flat()) PRECIOS_ORIG[it.id] = it.precio
        renderProds()
        avisoProd('✔ productos guardados', 'ok')
      } else {
        avisoProd('✗ ' + (data.error || errHttp(res.status)), 'err')
      }
    } catch {
      avisoProd('✗ error de red al guardar', 'err')
    }
  }

  /* ---------- fotos (genéticas y productos, mismo endpoint) ---------- */
  async function subirFoto(id, file) {
    const fd = new FormData()
    fd.append('id', id)
    fd.append('file', file)
    const res = await fetch(EP_FOTO, { method: 'POST', credentials: 'include', body: fd })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.ok) return { ok: true, url: data.url }
    return { ok: false, error: data.error || errHttp(res.status) }
  }

  /* ---------- eventos ---------- */
  function onInput(e) {
    const t = e.target
    // campos de genética
    const field = t.getAttribute('data-field')
    if (field && t.hasAttribute('data-idx')) {
      const i = Number(t.getAttribute('data-idx'))
      if (!CATALOG[i]) return
      CATALOG[i][field] = t.value
      if (field === 'nombre') t.title = t.value
      genDirty++
      pintarDirtyGen()
      return
    }
    // campos de producto
    const pf = t.getAttribute('data-pfield')
    if (pf) {
      const it = (PRECIOS[t.getAttribute('data-cat')] || [])[Number(t.getAttribute('data-pidx'))]
      if (!it) return
      if (pf === 'precio') {
        const digits = t.value.replace(/[^\d]/g, '')
        if (t.value !== digits) t.value = digits
        it.precio = Number(digits || 0)
        const fmt = t.closest('.ct-precio').querySelector('.ct-precio-fmt')
        if (fmt) fmt.textContent = P.fmt(it.precio)
      } else {
        it[pf] = t.value
      }
      prodDirty++
      pintarDirtyProd()
    }
  }

  async function onClick(e) {
    // toggle disponible (autoguardado)
    const sw = e.target.closest('.ct-sw')
    if (sw) {
      const i = Number(sw.dataset.idx)
      if (!CATALOG[i]) return
      CATALOG[i].activo = !CATALOG[i].activo
      sw.classList.toggle('on', CATALOG[i].activo)
      sw.setAttribute('aria-checked', String(CATALOG[i].activo))
      autoSaveActivo(i)
      if (filtroDisp) renderFlores()
      else {
        const disp = CATALOG.filter((g) => g.activo).length
        cont.querySelector('#ct-count').textContent = `${P.fmtN(disp)} disponibles · ${P.fmtN(CATALOG.length)} en total`
      }
      return
    }
    // formato flor/preroll (segmentado)
    const fbtn = e.target.closest('.ct-fbtn')
    if (fbtn) {
      const i = Number(fbtn.dataset.idx)
      if (!CATALOG[i]) return
      const val = fbtn.dataset.fmt
      let arr = Array.isArray(CATALOG[i].formatos) ? [...CATALOG[i].formatos] : ['flor']
      const on = arr.includes(val)
      arr = on ? arr.filter((v) => v !== val) : [...arr, val]
      CATALOG[i].formatos = arr
      fbtn.classList.toggle('on', !on)
      fbtn.setAttribute('aria-pressed', String(!on))
      genDirty++
      pintarDirtyGen()
      return
    }
    // eliminar genética (de la lista local; aplica al guardar)
    const gdel = e.target.closest('.ct-gen-del')
    if (gdel) {
      const i = Number(gdel.dataset.idx)
      const g = CATALOG[i]
      if (!g) return
      if (!(await P.confirmar(`¿Quitar "${g.nombre || 'esta genética'}" de la carta? Se aplica al tocar Guardar cambios.`, 'Sí, quitar'))) return
      CATALOG.splice(i, 1)
      genDirty++
      renderFlores()
      pintarDirtyGen()
      return
    }
    // agregar genética
    if (e.target.closest('#ct-add')) {
      CATALOG.push({
        id: `nueva-${Date.now()}`, nombre: '', banco: '', bancoSlug: '', tipo: 'hibrida',
        thc: '', cbd: '', sabores: [], efectos: [], formatos: ['flor'], foto: null, activo: false,
      })
      genDirty++
      // sin filtro que la esconda, para que la fila nueva se vea sí o sí
      filtroDisp = ''
      q = ''
      cont.querySelector('#ct-buscar').value = ''
      cont.querySelectorAll('#ct-filtros .chip').forEach((c) => c.classList.toggle('on', c.dataset.disp === ''))
      renderFlores()
      pintarDirtyGen()
      return
    }
    if (e.target.closest('#ct-save')) { guardarGeneticas(); return }
    // filtro de disponibilidad
    const chip = e.target.closest('#ct-filtros .chip')
    if (chip) {
      cont.querySelectorAll('#ct-filtros .chip').forEach((c) => c.classList.toggle('on', c === chip))
      filtroDisp = chip.dataset.disp
      renderFlores()
      return
    }
    // agregar producto
    if (e.target.closest('#ct-prod-add')) {
      // La página pública de estas categorías muestra una lista fija que vive
      // en el código: un producto nuevo acá queda guardado pero no aparece
      // solo en el sitio.
      if (!(await P.confirmar('Un producto nuevo acá queda guardado, pero no va a aparecer solo en la página pública — hace falta que alguien sume la foto y la ficha en el código. Si es para dejar el precio ya cargado, seguí.', 'Sí, agregar'))) return
      PRECIOS[sub] = PRECIOS[sub] || []
      PRECIOS[sub].push({ id: `nuevo-${Date.now().toString(36)}`, label: '', detalle: '', precio: 0 })
      prodDirty++
      renderProds()
      return
    }
    // eliminar producto
    const pdel = e.target.closest('.ct-prod-del')
    if (pdel) {
      const cat = pdel.dataset.cat
      const idx = Number(pdel.dataset.pidx)
      const it = (PRECIOS[cat] || [])[idx]
      if (!it) return
      if (!(await P.confirmar(`¿Eliminar "${it.label || 'este producto'}" de ${CAT_LABEL[cat]}? Deja de verse en la tienda al guardar.`, 'Sí, eliminar'))) return
      PRECIOS[cat].splice(idx, 1)
      prodDirty++
      renderProds()
      return
    }
    if (e.target.closest('#ct-prod-save')) guardarPrecios()
  }

  async function onChange(e) {
    // foto de genética
    const gin = e.target.closest('.ct-foto-in')
    if (gin) {
      const i = Number(gin.dataset.idx)
      const file = gin.files && gin.files[0]
      if (!CATALOG[i] || !file) return
      const status = cont.querySelector(`[data-fotostatus="${i}"]`)
      if (status) { status.className = 'msg'; status.textContent = '⏳ subiendo…' }
      const r = await subirFoto(CATALOG[i].id || slugify(CATALOG[i].nombre) || 'foto', file)
      if (r.ok) { CATALOG[i].foto = r.url; renderFlores() }
      else if (status) { status.className = 'msg err'; status.textContent = '✗ ' + r.error }
      return
    }
    // foto de producto
    const pin = e.target.closest('.ct-prod-fotoin')
    if (pin) {
      const it = (PRECIOS[pin.dataset.cat] || [])[Number(pin.dataset.pidx)]
      const file = pin.files && pin.files[0]
      if (!it || !file) return
      avisoProd('⏳ subiendo foto…')
      const r = await subirFoto(`producto-${it.id || slugify(it.label) || 'item'}`, file)
      if (r.ok) {
        it.foto = r.url
        prodDirty++
        renderProds()
        avisoProd('✔ foto subida', 'ok')
      } else {
        avisoProd('✗ ' + r.error, 'err')
      }
    }
  }

  /* ---------- registro ---------- */
  P.registrar('catalogo', {
    init(el) {
      cont = el
      el.innerHTML = `
        <div class="subs" id="ct-subs">
          <button type="button" class="on" data-sub="flores">Flores</button>
          <button type="button" data-sub="membresias">Membresías</button>
          <button type="button" data-sub="aceites">Aceites</button>
          <button type="button" data-sub="cremas">Cremas</button>
          <button type="button" data-sub="extracciones">Extracciones</button>
        </div>

        <div id="ct-flores">
          <div class="card">
            <div class="fila" style="flex-wrap:wrap">
              <div class="fila" id="ct-filtros">
                <button type="button" class="chip on" data-disp="">Todas</button>
                <button type="button" class="chip" data-disp="on">Disponibles</button>
                <button type="button" class="chip" data-disp="off">No disponibles</button>
              </div>
              <input class="input" id="ct-buscar" type="search" placeholder="Buscar por nombre…" autocomplete="off" style="max-width:230px" />
              <span class="pn-sp"></span>
              <span id="ct-count" class="msg"></span>
            </div>
            <div id="ct-gen-lista" style="margin-top:14px"><div class="vacio">⏳ Cargando…</div></div>
            <div class="fila" style="margin-top:14px">
              <button type="button" class="btn" id="ct-add">+ Agregar genética</button>
              <span class="pn-sp"></span>
              <span id="ct-gen-msg" class="msg"></span>
              <button type="button" class="btn btn-pri" id="ct-save">Guardar cambios</button>
            </div>
          </div>
        </div>

        <div id="ct-productos" hidden>
          <div class="card">
            <div class="fila">
              <span class="k" id="ct-prod-titulo"></span>
              <span id="ct-prod-count" class="msg"></span>
              <span class="pn-sp"></span>
              <button type="button" class="btn" id="ct-prod-add">+ Agregar</button>
            </div>
            <p class="ct-help">Precio y foto de lo que ven los socios en la tienda. Los cambios se aplican al tocar Guardar productos.</p>
            <div id="ct-prod-lista"><div class="vacio">⏳ Cargando…</div></div>
            <div class="fila" style="margin-top:14px">
              <span class="pn-sp"></span>
              <span id="ct-prod-msg" class="msg"></span>
              <button type="button" class="btn btn-pri" id="ct-prod-save">Guardar productos</button>
            </div>
          </div>
        </div>`

      // sub-tabs: Flores muestra el editor de genéticas; el resto comparte
      // el editor simple de precio + foto, una categoría por vez.
      el.querySelector('#ct-subs').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-sub]')
        if (!b) return
        el.querySelectorAll('#ct-subs button').forEach((x) => x.classList.toggle('on', x === b))
        sub = b.dataset.sub
        const esFlores = sub === 'flores'
        el.querySelector('#ct-flores').hidden = !esFlores
        el.querySelector('#ct-productos').hidden = esFlores
        if (!esFlores) renderProds()
      })

      el.querySelector('#ct-buscar').addEventListener('input', (e) => {
        q = e.target.value.trim()
        renderFlores()
      })
      el.addEventListener('input', onInput)
      el.addEventListener('click', onClick)
      el.addEventListener('change', onChange)

      // Cambios sin guardar: avisar antes de cerrar/recargar la pestaña
      window.addEventListener('beforeunload', (e) => {
        if (genDirty || prodDirty) { e.preventDefault(); e.returnValue = '' }
      })

      cargarBancos().then(() => {
        cargarGeneticas()
        cargarPrecios()
      })
    },
  })
})()
