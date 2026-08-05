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

  /* ---------- planes: gramos, importes y el link de Mercado Pago ---------- */
  let SUSCRIPTOS = {}
  let LISTA = null
  let abierto = null

  function pintarPlanes() {
    const caja = cont.querySelector('#mb-filas')
    if (!PLANES.length) {
      caja.innerHTML = '<p class="ct-help" style="margin:8px 0 0">No hay membresías en la lista de precios vigente.</p>'
      return
    }
    const mensuales = PLANES.filter((p) => p.tipo !== 'plan')
    caja.innerHTML = mensuales.map((p) => {
      const n = SUSCRIPTOS[p.item] || 0
      const abre = abierto === p.item
      return `<div class="mb-plan ${abre ? 'on' : ''}">
        <div class="mb-fila mb-ro mb-tap" data-plan="${P.esc(p.item)}">
          <b>${P.esc(p.item)}</b>
          <span>${p.gramos ? p.gramos + ' g/mes' : '—'}</span>
          <span class="mb-num">${p.contado ? pesos(p.contado) : '—'}</span>
          <span class="mb-num">${p.debito ? pesos(p.debito) : '—'}</span>
          <span class="mb-mp">${p.mp_plan_id || p.linkDebito ? '✓ débito' : '<span style="color:var(--dan)">sin link</span>'}</span>
        </div>
        ${abre ? filaEdit(p, false) : ''}
      </div>`
    }).join('')
    pintarPrepagos()
  }

  /* ---------- planes prepagos: se pagan de una y dan saldo a favor ---------- */
  function pintarPrepagos() {
    const caja = cont.querySelector('#mb-prepagos')
    if (!caja) return
    const lista = PLANES.filter((p) => p.tipo === 'plan')
    caja.innerHTML = `${lista.map((p) => {
      const abre = abierto === p.item
      const total = (p.plan_gramos_mes || 0) * (p.plan_meses || 0)
      return `<div class="mb-plan ${abre ? 'on' : ''}">
        <div class="mb-fila mb-pp mb-tap" data-plan="${P.esc(p.item)}">
          <b>${P.esc(p.item)}</b>
          <span>${p.plan_gramos_mes && p.plan_meses
            ? `${p.plan_gramos_mes} g/mes × ${p.plan_meses} meses` : '<span style="color:var(--dan)">falta el reparto</span>'}</span>
          <span class="mb-num">${total ? total + ' g' : (p.gramos ? p.gramos + ' g' : '—')}</span>
          <span class="mb-num">${p.contado ? pesos(p.contado) : '—'}</span>
          <span class="mb-num" style="color:var(--muted)">${p.valor_usd ? 'USD ' + p.valor_usd : '—'}</span>
        </div>
        ${abre ? filaEdit(p, true) : ''}
      </div>`
    }).join('')}
    ${abierto === '__nuevo__' ? `<div class="mb-plan on">${filaEdit({ item: '', tipo: 'plan' }, true, true)}</div>`
      : '<button class="btn" id="mb-nuevo-plan" type="button" style="margin-top:10px">+ Plan prepago</button>'}`
  }

  // El formulario de edición, compartido por los dos tipos.
  function filaEdit(p, esPlan, esNuevo) {
    const n = SUSCRIPTOS[p.item] || 0
    return `<div class="mb-edit">
      ${esNuevo ? `<div class="campo"><label class="lb">Nombre del plan</label>
        <input class="input mb-c" data-c="item" placeholder="PLAN 15x12" value="" />
        <p class="ct-help" style="margin:4px 0 0">Como lo van a ver en la ficha del socio y en la cobranza.</p></div>` : ''}
      ${esPlan ? `<div class="grid2" style="gap:10px">
          <div class="campo"><label class="lb">Gramos por mes</label>
            <input class="input mb-c" data-c="plan_gramos_mes" type="number" min="1" step="1" value="${p.plan_gramos_mes ?? ''}" /></div>
          <div class="campo"><label class="lb">Durante cuántos meses</label>
            <input class="input mb-c" data-c="plan_meses" type="number" min="1" max="60" step="1" value="${p.plan_meses ?? ''}" /></div>
        </div>
        <p class="ct-help" style="margin:0" id="mb-total-calc"></p>
        <div class="grid2" style="gap:10px">
          <div class="campo"><label class="lb">Precio de contado</label>
            <input class="input mb-c" data-c="contado" type="number" min="0" step="10000" value="${p.contado ?? ''}" /></div>
          <div class="campo"><label class="lb">Referencia en dólares</label>
            <input class="input mb-c" data-c="valor_usd" type="number" min="0" step="50" value="${p.valor_usd ?? ''}" />
            <p class="ct-help" style="margin:4px 0 0">Solo de referencia, no se cobra.</p></div>
        </div>`
      : `<div class="grid2" style="gap:10px">
          <div class="campo"><label class="lb">Gramos por mes</label>
            <input class="input mb-c" data-c="gramos" type="number" min="0" step="1" value="${p.gramos ?? ''}" /></div>
          <div class="campo"><label class="lb">Contado o transferencia</label>
            <input class="input mb-c" data-c="contado" type="number" min="0" step="1000" value="${p.contado ?? ''}" /></div>
        </div>
        <div class="campo"><label class="lb">Débito automático</label>
          <input class="input mb-c" data-c="debito" type="number" min="0" step="1000" value="${p.debito ?? ''}" />
          <p class="ct-help" style="margin:4px 0 0">Tiene que coincidir con lo que cobra el plan en Mercado Pago. Al guardar se verifica.</p></div>
        <div class="campo"><label class="lb">Link del plan de Mercado Pago</label>
          <input class="input mb-c" data-c="link" placeholder="https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=…"
            value="${P.esc(p.linkDebito || '')}" />
          <p class="ct-help" style="margin:4px 0 0">Pegá el link del plan que creaste en Mercado Pago. Se comprueba que exista y cuánto cobra.</p></div>`}
      ${n ? `<p class="ct-help" style="margin:8px 0 0;color:var(--amb)">⚠ ${n} socio${n > 1 ? 's' : ''} con este plan activo. Cambiar el importe en Mercado Pago les actualiza la cuota a todos.</p>` : ''}
      <div class="fila" style="margin-top:10px">
        ${esPlan ? '' : '<button class="btn mb-verificar" type="button">Verificar el link</button>'}
        <span class="pn-sp"></span>
        <button class="btn btn-pri mb-guardar-plan" data-tipo="${esPlan ? 'plan' : 'membresia'}" type="button">
          ${esNuevo ? 'Crear el plan' : 'Guardar ' + P.esc(p.item)}</button>
      </div>
      <p class="msg" style="margin:8px 0 0" id="mb-msg-plan"></p>
    </div>`
  }

  async function cargarPlanes() {
    const r = await fetch('/api/panel/planes', { credentials: 'include' }).catch(() => null)
    if (!r || !r.ok) return
    const d = await r.json()
    LISTA = d.lista || null
    SUSCRIPTOS = d.suscripciones || {}
    // se mezcla con lo que ya vino de /membresias?planes=1 para conservar linkDebito
    const porItem = Object.fromEntries((d.planes || []).map((x) => [x.item, x]))
    PLANES = PLANES.map((p) => ({ ...p, ...(porItem[p.item] || {}) }))
    for (const x of d.planes || []) if (!PLANES.some((p) => p.item === x.item)) PLANES.push(x)
    const info = cont.querySelector('#mb-lista-info')
    if (info && LISTA) info.textContent = `Lista vigente desde ${LISTA.vigente_desde}.`
    pintarPlanes()
  }

  function msgPlan(t, c) {
    const el = cont.querySelector('#mb-msg-plan')
    if (!el) return
    el.className = 'msg ' + (c || '')
    el.textContent = t
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
  /* ---------- textos: el editor se dibuja desde las ZONAS ----------
     El orden de las zonas es el orden en que se ven en la página, de arriba
     hacia abajo, y cada una dice dónde está. Así editar un texto no obliga a
     adivinar dónde va a aparecer. El mapa viene del servidor: agregar un texto
     nuevo allá lo hace aparecer acá solo. */
  let ZONAS = []
  let zonaAbierta = 'hero'

  function campoHtml(c) {
    const val = DOC[c.k] ?? ''
    const id = 'mbz-' + c.k
    return `<div class="campo">
      <label class="lb" for="${id}">${P.esc(c.lb)}</label>
      ${c.largo
        ? `<textarea class="input mb-tx" id="${id}" data-k="${P.esc(c.k)}" rows="${val.length > 300 ? 6 : 3}" maxlength="${c.max}">${P.esc(val)}</textarea>`
        : `<input class="input mb-tx" id="${id}" data-k="${P.esc(c.k)}" maxlength="${c.max}" value="${P.esc(val)}" />`}
      ${c.ayuda ? `<p class="ct-help" style="margin:4px 0 0">${P.esc(c.ayuda)}</p>` : ''}
    </div>`
  }

  function listaHtml(z) {
    const items = DOC[z.lista.k] || []
    return `<div class="mb-lista" data-lista="${P.esc(z.lista.k)}">
      ${items.map((it, i) => `<div class="mb-li">
        <span class="mb-li-n">${i + 1}</span>
        <div style="flex:1;min-width:0;display:grid;gap:6px">
          <input class="input mb-li-t" data-lista="${P.esc(z.lista.k)}" data-i="${i}" data-c="t"
            maxlength="90" placeholder="Título" value="${P.esc(it.t || '')}" />
          <input class="input mb-li-d" data-lista="${P.esc(z.lista.k)}" data-i="${i}" data-c="d"
            maxlength="260" placeholder="Descripción" value="${P.esc(it.d || '')}" />
        </div>
        <button class="btn btn-peligro mb-li-x" data-lista="${P.esc(z.lista.k)}" data-i="${i}" type="button" aria-label="Quitar">✕</button>
      </div>`).join('')}
      ${items.length < 6 ? `<button class="btn mb-li-mas" data-lista="${P.esc(z.lista.k)}" type="button">+ Agregar</button>` : ''}
    </div>`
  }

  function pintarTextos() {
    const caja = cont.querySelector('#mb-zonas')
    if (!caja || !ZONAS.length) return
    caja.innerHTML = ZONAS.map((z, i) => {
      const abierta = zonaAbierta === z.id
      return `<div class="mb-zona ${abierta ? 'on' : ''}">
        <button class="mb-zona-cab" data-zona="${P.esc(z.id)}" type="button" aria-expanded="${abierta}">
          <span class="mb-zona-n">${i + 1}</span>
          <span style="flex:1;min-width:0;text-align:left">
            <b>${P.esc(z.nombre)}</b>
            <span class="mb-zona-donde">${P.esc(z.donde)}</span>
          </span>
          <span class="mb-zona-chev">${abierta ? '▾' : '▸'}</span>
        </button>
        ${abierta ? `<div class="mb-zona-cuerpo">
          ${z.campos.map(campoHtml).join('')}
          ${z.lista ? listaHtml(z) : ''}
        </div>` : ''}
      </div>`
    }).join('')
  }

  // Lo que se escribe se guarda en DOC al vuelo: así cambiar de zona no pierde
  // lo tipeado.
  function tomarCampo(el) {
    if (el.classList.contains('mb-tx')) { DOC[el.dataset.k] = el.value; return true }
    if (el.dataset.lista && el.dataset.i !== undefined) {
      const l = DOC[el.dataset.lista] || (DOC[el.dataset.lista] = [])
      const i = Number(el.dataset.i)
      l[i] = l[i] || { t: '', d: '' }
      l[i][el.dataset.c] = el.value
      return true
    }
    return false
  }

  function leerTextos() {
    cont.querySelectorAll('.mb-tx, .mb-li-t, .mb-li-d').forEach(tomarCampo)
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
      const dd = await res.json()
      DOC = dd.membresias
      ZONAS = dd.zonas || []
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
      cargarPlanes()
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
            <div style="margin-top:20px">
              <span class="k">Planes prepagos</span>
              <p class="ct-help" style="margin:6px 0 10px">Se pagan de contado por adelantado y dan un saldo de gramos a favor
              que el socio va retirando. Lo que no retira en un mes queda para el siguiente.</p>
              <div id="mb-prepagos"></div>
            </div>
            <p class="ct-help" style="margin:12px 0 0">Tocá una membresía para editar sus gramos, sus importes y el link de Mercado Pago. <span id="mb-lista-info"></span> Cambiar un importe crea una lista nueva con la fecha de hoy: la cobranza de los meses anteriores sigue calculándose con la lista que regía entonces.</p>
          </div>

          <div class="card">
            <span class="k">Quién puede adherirse al débito</span>
            <p class="ct-help" style="margin:6px 0 12px">Solo los socios cuyo trámite de REPROCANN esté en alguno de los estados tildados. El resto ve el motivo y el paso que le falta.</p>
            <div id="mb-estados" class="mb-estados"></div>
            <p id="mb-total" class="mb-total"></p>
          </div>

          <div class="card">
            <span class="k">Textos de la página</span>
            <p class="ct-help" style="margin:6px 0 14px">En el mismo orden en que se ven, de arriba hacia abajo.
            Cada bloque dice en qué parte de la página está. <a href="${URL_PUBLICA}" target="_blank" rel="noopener">Verla</a></p>
            <div id="mb-zonas"></div>
          </div>

          <div class="fila mb-barra">
            <button class="btn btn-pri" id="mb-guardar" type="button" disabled>Sin cambios</button>
            <span id="mb-msg" class="msg"></span>
          </div>
        </div>`

      el.addEventListener('input', (e) => {
        const t = e.target
        if (tomarCampo(t)) { marcarSucio(); return }
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

      el.addEventListener('input', (e) => {
        if (!e.target.closest('.mb-c')) return
        const g = cont.querySelector('.mb-c[data-c="plan_gramos_mes"]')
        const m = cont.querySelector('.mb-c[data-c="plan_meses"]')
        const out = cont.querySelector('#mb-total-calc')
        if (!g || !m || !out) return
        const t = (Number(g.value) || 0) * (Number(m.value) || 0)
        out.textContent = t ? `Son ${t} gramos en total, que el socio puede retirar cuando quiera dentro de esos meses.` : ''
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
        // --- planes: abrir, verificar el link, guardar ---
        const tap = e.target.closest('.mb-tap')
        if (tap) {
          abierto = abierto === tap.dataset.plan ? null : tap.dataset.plan
          pintarPlanes()
          return
        }
        const ver = e.target.closest('.mb-verificar')
        if (ver) {
          const link = cont.querySelector('.mb-c[data-c="link"]').value.trim()
          if (!link) { msgPlan('Pegá primero el link del plan.', 'err'); return }
          ver.disabled = true
          msgPlan('⏳ preguntándole a Mercado Pago…')
          const r = await fetch('/api/panel/planes', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ verificar: true, link }),
          }).catch(() => null)
          const d = r ? await r.json().catch(() => ({})) : {}
          ver.disabled = false
          if (!r || !r.ok) { msgPlan('✗ ' + (d.error || 'no se pudo verificar'), 'err'); return }
          const imp = d.importe != null ? '$' + Number(d.importe).toLocaleString('es-AR') : 'sin importe'
          msgPlan(`✔ ${d.nombre || 'plan'} · cobra ${imp}${d.adheridos != null ? ` · ${d.adheridos} adheridos` : ''}${d.estado && d.estado !== 'active' ? ` · ${d.estado}` : ''}`, 'ok')
          return
        }
        if (e.target.closest('#mb-nuevo-plan')) { abierto = '__nuevo__'; pintarPrepagos(); return }
        const gp = e.target.closest('.mb-guardar-plan')
        if (gp) {
          const esPlan = gp.dataset.tipo === 'plan'
          const campoItem = cont.querySelector('.mb-c[data-c="item"]')
          const item = campoItem ? campoItem.value.trim().toUpperCase() : abierto
          if (!item) { msgPlan('Ponele un nombre al plan.', 'err'); return }
          const val = (c) => { const el = cont.querySelector(`.mb-c[data-c="${c}"]`); return el ? el.value.trim() : undefined }
          gp.disabled = true
          msgPlan('⏳ guardando…')
          const r = await fetch('/api/panel/planes', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(esPlan
              ? { item, tipo: 'plan', plan_gramos_mes: val('plan_gramos_mes'), plan_meses: val('plan_meses'),
                  contado: val('contado'), valor_usd: val('valor_usd') }
              : { item, gramos: val('gramos'), contado: val('contado'), debito: val('debito'), link: val('link') }),
          }).catch(() => null)
          const d = r ? await r.json().catch(() => ({})) : {}
          gp.disabled = false
          if (!r || !r.ok) { msgPlan('✗ ' + (d.error || 'no se pudo guardar'), 'err'); return }
          msgPlan(d.aviso ? '✔ guardado · ' + d.aviso : '✔ guardado', d.aviso ? 'err' : 'ok')
          if (abierto === '__nuevo__') abierto = item
          const pr = await fetch('/api/socios/admin/membresias?planes=1', { credentials: 'include' }).catch(() => null)
          if (pr && pr.ok) PLANES = (await pr.json()).planes || []
          cargarPlanes()
          return
        }
        // --- textos por zona ---
        const cab = e.target.closest('.mb-zona-cab')
        if (cab) { zonaAbierta = zonaAbierta === cab.dataset.zona ? null : cab.dataset.zona; pintarTextos(); return }
        const mas = e.target.closest('.mb-li-mas')
        if (mas) {
          const k = mas.dataset.lista
          DOC[k] = (DOC[k] || []).concat({ t: '', d: '' })
          marcarSucio(); pintarTextos(); return
        }
        const menos = e.target.closest('.mb-li-x')
        if (menos) {
          const k = menos.dataset.lista
          DOC[k] = (DOC[k] || []).filter((_, i) => i !== Number(menos.dataset.i))
          marcarSucio(); pintarTextos(); return
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
