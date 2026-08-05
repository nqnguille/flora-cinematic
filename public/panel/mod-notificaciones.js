/* Avisos: qué le llega al socio, por dónde, y cuándo.
   Todo nace apagado. Prender un aviso hace que salga solo de ahí en más, así
   que cada uno tiene su botón de prueba (te lo manda a vos con datos de
   ejemplo) y su tope diario, que es el freno si algo sale mal. */
(() => {
  'use strict'
  const P = window.Panel
  let cont = null
  let EVENTOS = []
  let RESUMEN = []
  let ULTIMOS = []
  let PUSH_ACTIVOS = 0
  let abierto = null   // qué aviso está desplegado

  const FAMILIAS = [
    ['transaccional', 'Del momento', 'Salen cuando pasa algo concreto: una reserva lista, un pago que entra.'],
    ['recordatorio', 'Por tiempo', 'Salen solos cuando se acerca una fecha. Son los que hoy no existen y el socio espera.'],
    ['club', 'Del club', 'Novedades. Son los únicos que se parecen a publicidad, tratalos con cuidado.'],
  ]

  function msg(t, c, ms) {
    const el = cont.querySelector('#nt-msg')
    if (!el) return
    el.className = 'msg ' + (c || '')
    el.textContent = t
    if (t) setTimeout(() => { if (el.textContent === t) { el.textContent = ''; el.className = 'msg' } }, ms || 6000)
  }

  async function cargar() {
    const caja = cont.querySelector('#nt-lista')
    const r = await fetch('/api/panel/notificaciones', { credentials: 'include' }).catch(() => null)
    if (!r || !r.ok) { caja.innerHTML = '<div class="vacio">No se pudo cargar. Probá de nuevo.</div>'; return }
    const d = await r.json()
    EVENTOS = d.eventos || []
    RESUMEN = d.resumen || []
    ULTIMOS = d.ultimos || []
    PUSH_ACTIVOS = d.push_activos || 0
    pintar()
  }

  const contar = (clave, estado) => RESUMEN
    .filter((x) => x.evento === clave && x.estado === estado)
    .reduce((a, x) => a + x.n, 0)

  function fila(ev) {
    const enviados = contar(ev.clave, 'enviado')
    const fallidos = contar(ev.clave, 'fallido')
    const canales = String(ev.canales || '').split(',').filter(Boolean)
    const desplegado = abierto === ev.clave
    return `<div class="nt-item ${ev.activo ? 'nt-on' : ''}">
      <div class="nt-cab" data-abrir="${ev.clave}">
        <label class="sw" onclick="event.stopPropagation()">
          <input type="checkbox" class="nt-activo" data-clave="${ev.clave}" ${ev.activo ? 'checked' : ''} />
          <span></span>
        </label>
        <div style="flex:1;min-width:0">
          <b style="font-size:13px">${P.esc(ev.nombre)}</b>
          ${ev.obligatorio ? '<span class="tag tag-auto" style="margin-left:6px">siempre</span>' : ''}
          <div style="color:var(--muted);font-size:12px;margin-top:2px">${P.esc(ev.descripcion || '')}</div>
        </div>
        <div class="nt-meta">
          ${canales.map((c) => `<span class="tag ${c === 'push' ? 'tag-auto' : 'tag-off'}">${c === 'push' ? 'app' : 'mail'}</span>`).join('')}
          ${ev.dias_antes !== null && ev.dias_antes !== undefined ? `<span class="tag tag-deb">${ev.dias_antes === 0 ? 'el día' : ev.dias_antes + ' días antes'}</span>` : ''}
          ${enviados ? `<span class="tag tag-ok">${enviados} enviados</span>` : ''}
          ${fallidos ? `<span class="tag tag-mal">${fallidos} fallaron</span>` : ''}
        </div>
        <span class="nt-chev">${desplegado ? '▾' : '▸'}</span>
      </div>
      ${desplegado ? `<div class="nt-cuerpo">
        <div class="grid2" style="gap:10px">
          <div class="campo"><label class="lb">Asunto del mail</label>
            <input class="input nt-campo" data-clave="${ev.clave}" data-campo="asunto" value="${P.esc(ev.asunto || '')}" /></div>
          <div class="campo"><label class="lb">Título en la app</label>
            <input class="input nt-campo" data-clave="${ev.clave}" data-campo="push_titulo" value="${P.esc(ev.push_titulo || '')}" /></div>
        </div>
        <div class="campo"><label class="lb">Texto del mail</label>
          <textarea class="input nt-campo" data-clave="${ev.clave}" data-campo="cuerpo" rows="4">${P.esc(ev.cuerpo || '')}</textarea></div>
        <div class="campo"><label class="lb">Texto en la app</label>
          <input class="input nt-campo" data-clave="${ev.clave}" data-campo="push_texto" value="${P.esc(ev.push_texto || '')}" /></div>
        <div class="grid2" style="gap:10px">
          ${ev.dias_antes !== null && ev.dias_antes !== undefined ? `<div class="campo"><label class="lb">Cuántos días antes</label>
            <input class="input nt-campo" data-clave="${ev.clave}" data-campo="dias_antes" type="number" min="0" max="180" value="${ev.dias_antes}" /></div>` : '<div></div>'}
          <div class="campo"><label class="lb">Tope por día</label>
            <input class="input nt-campo" data-clave="${ev.clave}" data-campo="tope_diario" type="number" min="1" max="1000" value="${ev.tope_diario}" />
            <p class="so-help" style="margin:4px 0 0">Si un error hace que quiera salir de más, se frena acá.</p></div>
        </div>
        <p class="so-help" style="margin:8px 0 0">Podés usar <code>{nombre}</code>, y según el aviso <code>{vence}</code>, <code>{paso}</code>, <code>{items}</code>, <code>{monto}</code>.</p>
        <div class="fila" style="margin-top:10px">
          <button class="btn nt-prueba" data-clave="${ev.clave}" type="button">Mandármelo a mí</button>
          <span class="pn-sp"></span>
          <button class="btn btn-pri nt-guardar" data-clave="${ev.clave}" type="button">Guardar</button>
        </div>
      </div>` : ''}
    </div>`
  }

  function pintar() {
    const prendidos = EVENTOS.filter((e) => e.activo).length
    cont.querySelector('#nt-resumen').innerHTML = `
      <b>${prendidos}</b> de ${EVENTOS.length} avisos prendidos
      ${PUSH_ACTIVOS ? ` · <b>${PUSH_ACTIVOS}</b> con la app instalada` : ' · nadie tiene la app instalada todavía'}`

    cont.querySelector('#nt-lista').innerHTML = FAMILIAS.map(([fam, titulo, ayuda]) => {
      const items = EVENTOS.filter((e) => e.familia === fam)
      if (!items.length) return ''
      return `<div class="nt-grupo">
        <div class="k" style="margin-bottom:2px">${titulo}</div>
        <p class="so-help" style="margin:0 0 10px">${ayuda}</p>
        ${items.map(fila).join('')}
      </div>`
    }).join('')

    cont.querySelector('#nt-ultimos').innerHTML = ULTIMOS.length
      ? ULTIMOS.map((u) => `<div class="fila" style="padding:5px 0;border-bottom:1px solid var(--line);font-size:12px">
          <span class="tag ${u.estado === 'enviado' ? 'tag-ok' : u.estado === 'fallido' ? 'tag-mal' : 'tag-off'}">${P.esc(u.estado)}</span>
          <span>${P.esc(u.nombre || '—')}</span>
          <span style="color:var(--muted)">${P.esc(u.evento)} · ${u.canal === 'push' ? 'app' : 'mail'}</span>
          <span class="pn-sp"></span>
          <span style="color:var(--muted)">${P.esc(String(u.enviado || u.creado || '').slice(0, 16).replace('T', ' '))}</span>
          ${u.motivo ? `<span style="color:var(--muted)">· ${P.esc(u.motivo)}</span>` : ''}
        </div>`).join('')
      : '<div class="vacio" style="padding:16px;font-size:12px">Todavía no salió ningún aviso.</div>'
  }

  async function guardar(clave, campos) {
    const r = await fetch('/api/panel/notificaciones', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clave, ...campos }),
    }).catch(() => null)
    if (!r || !r.ok) {
      const d = r ? await r.json().catch(() => ({})) : {}
      msg('✗ ' + (d.error || 'no se pudo guardar'), 'err')
      return false
    }
    return true
  }

  P.registrar('notificaciones', {
    init(el) {
      cont = el
      el.innerHTML = `
        <p class="so-help" style="max-width:74ch;margin:0 0 12px">Lo que le llega al socio y por dónde.
        Cada aviso nace apagado: prendelo cuando el texto te convenza. Antes de prenderlo, mandátelo a vos
        con el botón de prueba y mirá cómo se lee.</p>
        <div class="fila" style="margin-bottom:14px">
          <span id="nt-resumen" style="font-size:13px;color:var(--ink2)"></span>
          <span class="pn-sp"></span>
          <span class="msg" id="nt-msg" aria-live="polite"></span>
        </div>
        <div id="nt-lista"><div class="vacio">⏳ Cargando…</div></div>
        <details style="margin-top:20px"><summary style="cursor:pointer;font-weight:600;font-size:13px">Lo último que salió</summary>
          <div id="nt-ultimos" style="margin-top:10px"></div>
        </details>`

      el.addEventListener('click', async (e) => {
        const cab = e.target.closest('[data-abrir]')
        if (cab && !e.target.closest('.sw')) {
          abierto = abierto === cab.dataset.abrir ? null : cab.dataset.abrir
          pintar()
          return
        }
        const g = e.target.closest('.nt-guardar')
        if (g) {
          const clave = g.dataset.clave
          const campos = {}
          el.querySelectorAll(`.nt-campo[data-clave="${clave}"]`).forEach((i) => { campos[i.dataset.campo] = i.value })
          g.disabled = true
          const ok = await guardar(clave, campos)
          g.disabled = false
          if (ok) { msg('✔ guardado', 'ok'); cargar() }
          return
        }
        const pr = e.target.closest('.nt-prueba')
        if (pr) {
          pr.disabled = true
          const antes = pr.textContent
          pr.textContent = 'Mandando…'
          const r = await fetch('/api/panel/notificaciones', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clave: pr.dataset.clave, prueba: true }),
          }).catch(() => null)
          const d = r ? await r.json().catch(() => ({})) : {}
          pr.disabled = false
          pr.textContent = antes
          msg(r && r.ok ? `✔ te lo mandamos a ${d.a}` : '✗ ' + (d.error || 'no salió'), r && r.ok ? 'ok' : 'err')
          return
        }
      })

      el.addEventListener('change', async (e) => {
        const sw = e.target.closest('.nt-activo')
        if (!sw) return
        const ev = EVENTOS.find((x) => x.clave === sw.dataset.clave)
        const prender = sw.checked
        if (prender && !(await P.confirmar(
          `¿Prender «${ev.nombre}»?\n\nDe acá en más va a salir solo cuando corresponda, sin que nadie lo apruebe.\n\nSi todavía no lo probaste, cancelá y usá primero «Mandármelo a mí».`,
          'Sí, prender'))) { sw.checked = false; return }
        const ok = await guardar(sw.dataset.clave, { activo: prender })
        if (!ok) { sw.checked = !prender; return }
        msg(prender ? `✔ «${ev.nombre}» quedó prendido` : `«${ev.nombre}» quedó apagado`, prender ? 'ok' : '')
        cargar()
      })

      cargar()
    },
  })
})()
