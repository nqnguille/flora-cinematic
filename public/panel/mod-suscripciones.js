/* Módulo Suscripciones (prefijo su-): el ciclo del débito automático.
   El plan de MP corta solo a los 3 cobros (20% off): al 4° mes el socio
   vuelve a contado salvo que renueve. Este módulo trabaja esa adherencia:
   POR RENOVAR primero (la oportunidad), después las activas, las caídas a
   recuperar y las renovadas (el éxito, para ver la tasa). */
(() => {
  'use strict'
  const P = window.Panel

  const EP_CICLO = '/api/panel/mp/ciclo'
  const EP_RENOVACION = '/api/panel/mp/renovacion'
  const EP_NO_INSISTIR = '/api/panel/mp/no-insistir'

  let cont = null
  let D = null // respuesta del GET ciclo

  /* ---------- helpers ---------- */
  function errHttp(status) {
    if (status === 401) return 'Tu sesión venció: recargá la página y volvé a entrar.'
    if (status === 403) return 'Tu rol no tiene permiso para ver esto.'
    return 'El servidor respondió ' + status + '. Probá de nuevo en un rato.'
  }
  let msgT = null
  function aviso(texto, clase, ms) {
    const el = cont.querySelector('#su-msg')
    if (!el) return
    el.className = 'msg' + (clase ? ' ' + clase : '')
    el.textContent = texto
    clearTimeout(msgT)
    if (texto) msgT = setTimeout(() => { el.textContent = ''; el.className = 'msg' }, ms || 6000)
  }
  // wa.me exige el número internacional: 549 + los 10 dígitos argentinos
  function tel549(t) {
    const d = String(t || '').replace(/\D/g, '')
    if (!d) return ''
    if (d.length === 10) return '549' + d
    if (d.startsWith('549')) return d
    if (d.startsWith('54') && d.length === 12) return '549' + d.slice(2)
    return d
  }
  function diasDesde(iso) {
    const t = Date.parse(String(iso || '').slice(0, 10) + 'T00:00:00Z')
    if (isNaN(t)) return null
    return Math.max(0, Math.round((Date.now() - t) / 86400000))
  }
  function diasHasta(iso) {
    const t = Date.parse(String(iso || '').slice(0, 10) + 'T00:00:00Z')
    if (isNaN(t)) return null
    return Math.round((t - Date.now()) / 86400000)
  }
  function haceTxt(iso) {
    const n = diasDesde(iso)
    if (n === null) return ''
    if (n === 0) return 'hoy'
    if (n === 1) return 'hace 1 día'
    return `hace ${n} días`
  }
  function buscarSub(id) {
    for (const grupo of [D.por_renovar, D.activas, D.caidas, D.pausadas]) {
      const hit = (grupo || []).find((x) => Number(x.id) === Number(id))
      if (hit) return hit
    }
    return null
  }

  const ESTADO_TAG = {
    activa: ['Activa', 'tag-ok'], pendiente: ['Pendiente', 'tag-deb'],
    pausada: ['Pausada', 'tag-deb'], cancelada: ['Cancelada', 'tag-off'],
  }
  function tagEstado(e) {
    const [label, cls] = ESTADO_TAG[e] || [e, 'tag-off']
    return `<span class="tag ${cls}">${P.esc(label)}</span>`
  }

  /* ---------- render ---------- */
  function kpisHtml() {
    const t = D.totales || {}
    return `
      <div class="card"><span class="k">Activas</span>
        <div class="kpi-v">${P.fmtN(t.activas)}</div>
        <div class="kpi-d">${P.fmt(t.monto_mensual)} por mes con débito · próximo cobro ${P.fecha(D.proximo_cobro)}</div></div>
      <div class="card"><span class="k">Por renovar</span>
        <div class="kpi-v" style="color:${t.por_renovar ? 'var(--amb)' : 'var(--grn)'}">${P.fmtN(t.por_renovar)}</div>
        <div class="kpi-d">${t.por_renovar ? 'con la 3ª cuota encima o el corte a la vista' : 'nadie está por cortar todavía'}</div></div>
      <div class="card"><span class="k">Caídas (90 días)</span>
        <div class="kpi-v" style="color:${t.caidas_90d ? 'var(--dan)' : 'var(--grn)'}">${P.fmtN(t.caidas_90d)}</div>
        <div class="kpi-d">${t.renovadas_90d ? `${P.fmtN(t.renovadas_90d)} renovaron en el mismo período` : 'sin renovaciones registradas todavía'}</div></div>`
  }

  // Botones de trabajo: WhatsApp / email de renovación + no insistir.
  // Solo con la capacidad que corresponde; el resto ve la tarjeta pelada.
  function accionesHtml(x) {
    const tel = tel549(x.telefono)
    // la cuota social no tiene renovación (no corta): sin botones de envío
    const enviar = P.puede('mp_enviar') && x.tier !== 'CUOTA SOCIAL'
      ? `${tel ? `<button type="button" class="btn btn-pri su-wa" data-id="${x.id}">Mandar por WhatsApp</button>` : ''}
         ${x.email ? `<button type="button" class="btn su-mail" data-id="${x.id}">Mandar por email</button>` : ''}`
      : ''
    const noIns = P.puede('mp_gestionar')
      ? (x.debito_no_insistir
        ? `<button type="button" class="btn su-noins" data-socio="${x.socio_id}" data-valor="0">Volver a ofrecer</button>`
        : `<button type="button" class="btn su-noins" data-socio="${x.socio_id}" data-valor="1" title="No ofrecerle más el débito">No insistir</button>`)
      : ''
    return enviar + noIns
  }

  function marcaEnvio(x) {
    if (!x.renov_enviado) return ''
    const via = x.renov_via === 'email' ? 'por email' : 'por WhatsApp'
    return `<span class="tag tag-auto" title="Ya se le mandó el link de renovación">link mandado ${P.esc(haceTxt(x.renov_enviado))} ${via}</span>`
  }

  function cardRenovar(x) {
    const dias = x.fin ? diasHasta(x.fin) : null
    const termina = x.fin
      ? (dias !== null && dias < 0 ? `terminó el ${P.fecha(x.fin)}` : `termina el ${P.fecha(x.fin)}${dias !== null ? ` (en ${dias} día${dias === 1 ? '' : 's'})` : ''}`)
      : 'termina con la 3ª cuota'
    return `<article class="card su-card ${x.debito_no_insistir ? 'su-off' : ''}">
      <div class="su-main">
        <div class="fila" style="flex-wrap:wrap;gap:6px">
          <strong>${P.esc(x.nombre)}</strong>
          <span class="tag tag-auto">${P.esc(x.tier || '—')}</span>
          ${tagEstado(x.estado)}
          ${x.debito_no_insistir ? '<span class="tag tag-off">pidió que no insistamos</span>' : ''}
        </div>
        <div class="su-datos">
          <span><b>${P.fmt(x.monto)}</b> por mes</span>
          <span>cuota <b>${x.cuota ?? Math.min(3, x.racha_meses || 0)}/3</b></span>
          <span>${P.esc(termina)}</span>
          ${marcaEnvio(x)}
        </div>
      </div>
      <div class="su-acciones">${accionesHtml(x)}</div>
    </article>`
  }

  function cardCaida(x) {
    return `<article class="card su-card ${x.debito_no_insistir ? 'su-off' : ''}">
      <div class="su-main">
        <div class="fila" style="flex-wrap:wrap;gap:6px">
          <strong>${P.esc(x.nombre)}</strong>
          <span class="tag tag-auto">${P.esc(x.tier || '—')}</span>
          <span class="tag ${x.motivo === 'cancelada' ? 'tag-mal' : 'tag-off'}">${x.motivo === 'cancelada' ? 'Canceló' : 'Se venció'}</span>
          ${x.debito_no_insistir ? '<span class="tag tag-off">pidió que no insistamos</span>' : ''}
        </div>
        <div class="su-datos">
          <span>cayó ${P.esc(haceTxt(x.caida))} (${P.fecha(x.caida)})</span>
          <span>pagaba <b>${P.fmt(x.monto)}</b></span>
          ${marcaEnvio(x)}
        </div>
      </div>
      <div class="su-acciones">${accionesHtml(x)}</div>
    </article>`
  }

  function tablaActivas() {
    if (!D.activas.length) return '<div class="vacio">No hay suscripciones activas.</div>'
    return `<div class="su-tabla-wrap"><table class="tabla">
      <thead><tr><th>Socio</th><th>Plan</th><th class="r">Monto</th><th class="r">Cuota</th><th>Próximo cobro</th><th>Termina</th><th>Estado</th></tr></thead>
      <tbody>${D.activas.map((x) => `<tr>
        <td><b>${P.esc(x.nombre)}</b></td>
        <td>${P.esc(x.tier || '—')}</td>
        <td class="r">${P.fmt(x.monto)}</td>
        <td class="r">${x.tier === 'CUOTA SOCIAL' ? 'sin corte' : (x.cuota ?? Math.min(3, x.racha_meses || 0)) + '/3'}</td>
        <td>${x.proximo_cobro ? P.fecha(x.proximo_cobro) : '—'}</td>
        <td>${x.fin ? P.fecha(x.fin) : (x.tier === 'CUOTA SOCIAL' ? 'no corta' : '—')}</td>
        <td>${tagEstado(x.estado)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`
  }

  function listaRenovadas() {
    if (!D.renovadas.length) return '<div class="vacio">Ninguna renovación en los últimos 90 días. Acá se va a ver la tasa cuando empiecen los cortes.</div>'
    return `<div class="su-tabla-wrap"><table class="tabla">
      <thead><tr><th>Socio</th><th>Venía de</th><th>Terminó</th><th>Renovó</th><th>Plan nuevo</th><th class="r">Monto</th><th>Estado</th></tr></thead>
      <tbody>${D.renovadas.map((x) => `<tr>
        <td><b>${P.esc(x.nombre)}</b></td>
        <td>${P.esc(x.anterior_tier || '—')}</td>
        <td>${x.anterior_fin ? P.fecha(x.anterior_fin) : '—'}</td>
        <td>${P.fecha(x.desde)}</td>
        <td>${P.esc(x.tier || '—')}</td>
        <td class="r">${P.fmt(x.monto)}</td>
        <td>${tagEstado(x.estado)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`
  }

  function render() {
    cont.querySelector('#su-kpis').innerHTML = kpisHtml()
    cont.querySelector('#su-renovar').innerHTML = D.por_renovar.length
      ? D.por_renovar.map(cardRenovar).join('')
      : '<div class="vacio">Nadie está en el 4° mes todavía. Cuando una suscripción llegue a la 3ª cuota o le queden menos de 35 días, aparece acá.</div>'
    cont.querySelector('#su-activas').innerHTML = tablaActivas()
    cont.querySelector('#su-caidas').innerHTML = D.caidas.length
      ? D.caidas.map(cardCaida).join('')
      : '<div class="vacio">Ninguna suscripción caída sin renovar en los últimos 90 días.</div>'
    cont.querySelector('#su-renovadas').innerHTML = listaRenovadas()
    const pw = cont.querySelector('#su-pausadas-wrap')
    pw.hidden = !D.pausadas.length
    if (D.pausadas.length) cont.querySelector('#su-pausadas').innerHTML = D.pausadas.map(cardRenovar).join('')
    if (!D.configurado) aviso('Falta el token de Mercado Pago (secret MP_ACCESS_TOKEN): los datos pueden estar viejos.', 'err', 12000)
  }

  async function cargar() {
    try {
      const res = await fetch(EP_CICLO, { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        cont.querySelector('#su-renovar').innerHTML = `<div class="vacio">${P.esc(data.error || errHttp(res.status))}</div>`
        return
      }
      D = data
      render()
    } catch {
      cont.querySelector('#su-renovar').innerHTML = '<div class="vacio">Error de red: revisá la conexión y probá de nuevo.</div>'
    }
  }

  /* ---------- acciones ---------- */
  async function postRenovacion(id, via) {
    const res = await fetch(EP_RENOVACION, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suscripcion_id: Number(id), via }),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok && data.ok, data, status: res.status }
  }

  async function mandarWa(btn) {
    btn.disabled = true
    // la pestaña se abre ANTES del await: si no, el navegador bloquea el popup
    const w = window.open('about:blank', '_blank')
    try {
      const r = await postRenovacion(btn.dataset.id, 'whatsapp')
      if (!r.ok) { if (w) w.close(); aviso('✗ ' + (r.data.error || errHttp(r.status)), 'err'); return }
      const sub = buscarSub(btn.dataset.id)
      const tel = tel549((r.data.telefono || (sub && sub.telefono)))
      const url = `https://wa.me/${tel}?text=${encodeURIComponent(r.data.texto_wa || r.data.link)}`
      if (w) w.location = url; else window.open(url, '_blank')
      aviso('✔ envío registrado, el WhatsApp quedó abierto', 'ok')
      cargar()
    } catch {
      if (w) w.close()
      aviso('Error de red: probá de nuevo.', 'err')
    } finally { btn.disabled = false }
  }

  async function mandarMail(btn) {
    btn.disabled = true
    aviso('⏳ mandando el mail…')
    try {
      const r = await postRenovacion(btn.dataset.id, 'email')
      if (!r.ok) { aviso('✗ ' + (r.data.error || errHttp(r.status)), 'err'); return }
      aviso('✔ mail de renovación enviado', 'ok')
      cargar()
    } catch { aviso('Error de red: probá de nuevo.', 'err') } finally { btn.disabled = false }
  }

  async function noInsistir(btn) {
    const valor = btn.dataset.valor === '1'
    if (valor && !(await P.confirmar('¿Dejar de ofrecerle el débito a este socio? Va a quedar marcado y sin botones de envío hasta que lo revierta alguien.', 'Sí, no insistir'))) return
    btn.disabled = true
    try {
      const res = await fetch(EP_NO_INSISTIR, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socio_id: Number(btn.dataset.socio), valor }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) { aviso('✗ ' + (data.error || errHttp(res.status)), 'err'); return }
      aviso(valor ? '✔ marcado: no se le insiste más' : '✔ vuelve a la lista de ofrecibles', 'ok')
      cargar()
    } catch { aviso('Error de red: probá de nuevo.', 'err') } finally { btn.disabled = false }
  }

  /* ---------- registro ---------- */
  P.registrar('suscripciones', {
    init(el) {
      cont = el
      el.innerHTML = `
        <div class="fila su-toolbar" style="flex-wrap:wrap">
          <button type="button" class="btn" id="su-refresh">Actualizar</button>
          <span class="pn-sp"></span>
          <span id="su-msg" class="msg"></span>
        </div>
        <div class="su-kpis" id="su-kpis"></div>

        <h2 class="su-h">Por renovar</h2>
        <p class="su-sub">El ciclo de 3 cobros con 20% está terminando: conviene ofrecer la renovación antes del corte, así siguen con el descuento sin pasar por contado.</p>
        <div id="su-renovar" class="su-cards"><div class="vacio">⏳ Cargando…</div></div>

        <h2 class="su-h">Activas</h2>
        <div id="su-activas"></div>

        <h2 class="su-h">Caídas (últimos 90 días)</h2>
        <p class="su-sub">Cancelaron o se les venció el ciclo y no volvieron: adherencia a recuperar.</p>
        <div id="su-caidas" class="su-cards"></div>

        <h2 class="su-h">Renovadas (últimos 90 días)</h2>
        <div id="su-renovadas"></div>

        <div id="su-pausadas-wrap" hidden>
          <h2 class="su-h">Pausadas</h2>
          <div id="su-pausadas" class="su-cards"></div>
        </div>`

      el.querySelector('#su-refresh').addEventListener('click', () => cargar())
      el.addEventListener('click', (e) => {
        const wa = e.target.closest('.su-wa')
        if (wa) { mandarWa(wa); return }
        const mail = e.target.closest('.su-mail')
        if (mail) { mandarMail(mail); return }
        const ni = e.target.closest('.su-noins')
        if (ni) { noInsistir(ni) }
      })

      cargar()
    },
  })
})()
