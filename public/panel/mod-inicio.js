/* Módulo Inicio (prefijo in-): el resumen del día al abrir el panel.
   Cada rol ve sus tarjetas; los accesos directos llevan al módulo que toca. */
(() => {
  'use strict'
  const P = window.Panel

  P.registrar('inicio', {
    async init(cont) {
      cont.innerHTML = '<div class="vacio">⏳ Cargando el día…</div>'
      let d
      try {
        const r = await fetch('/api/panel/inicio', { credentials: 'include' })
        if (!r.ok) throw new Error('El servidor respondió ' + r.status)
        d = await r.json()
      } catch (err) {
        cont.innerHTML = `<div class="vacio">${P.esc(err.message)}</div>`
        return
      }
      const hoyLindo = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
      const res = d.mes ? d.mes.ingreso - d.mes.egreso : null

      const tiles = []
      tiles.push(`<div class="card in-tile" data-ir="mostrador">
        <span class="k">Retiros de hoy</span>
        <div class="kpi-v" style="font-size:30px">${d.retirosHoy.n}</div>
        <div class="kpi-d">${d.retirosHoy.gramos} g dispensados</div></div>`)
      if (d.cobrosHoy) tiles.push(`<div class="card in-tile" data-ir="finanzas">
        <span class="k">Cobros de hoy</span>
        <div class="kpi-v" style="font-size:30px;color:var(--grn)">${P.fmt(d.cobrosHoy.total)}</div>
        <div class="kpi-d">${d.cobrosHoy.n} pago${d.cobrosHoy.n === 1 ? '' : 's'} registrados</div></div>`)
      if (d.reservas) tiles.push(`<div class="card in-tile" data-ir="reservas">
        <span class="k">Reservas activas</span>
        <div class="kpi-v" style="font-size:30px">${d.reservas.pendientes + d.reservas.listas}</div>
        <div class="kpi-d">${d.reservas.pendientes} en preparación · ${d.reservas.listas} listas</div></div>`)
      if (d.pendientesAprobacion != null) tiles.push(`<div class="card in-tile" data-ir="finanzas">
        <span class="k">Tu visto bueno</span>
        <div class="kpi-v" style="font-size:30px;color:${d.pendientesAprobacion ? 'var(--amb)' : 'var(--ink)'}">${d.pendientesAprobacion}</div>
        <div class="kpi-d">movimiento${d.pendientesAprobacion === 1 ? '' : 's'} esperando</div></div>`)
      if (res != null) tiles.push(`<div class="card in-tile ${res >= 0 ? '' : ''}" data-ir="finanzas">
        <span class="k">El mes va</span>
        <div class="kpi-v" style="font-size:30px;color:${res >= 0 ? 'var(--grn)' : 'var(--dan)'}">${res >= 0 ? '+' : '−'}${P.fmt(Math.abs(res))}</div>
        <div class="kpi-d">entró ${P.fmt(d.mes.ingreso)} · salió ${P.fmt(d.mes.egreso)}</div></div>`)
      if (d.debitos) tiles.push(`<div class="card in-tile" data-ir="finanzas">
        <span class="k">Débito automático</span>
        <div class="kpi-v" style="font-size:30px;color:var(--grn)">${P.fmt(d.debitos.recaudado_mes)}</div>
        <div class="kpi-d">${d.debitos.al_dia} al día · ${d.debitos.esperando} esperando${d.debitos.terminan_mes ? ` · <b style="color:var(--amb)">${d.debitos.terminan_mes} terminan este mes</b>` : ''}</div></div>`)

      cont.innerHTML = `
        <p style="color:var(--ink2);margin:0 0 14px;text-transform:capitalize">${P.esc(hoyLindo)}</p>
        <div class="in-tiles">${tiles.join('')}</div>
        <div class="grid2" style="margin-top:14px;align-items:start">
          <div class="card"><span class="k">Retiros de hoy</span>
            <div class="mo-hist" style="margin-top:8px">${d.retirosHoy.lista.length
              ? d.retirosHoy.lista.map((r) => `<div><span>${P.esc(r.nombre.split(' ')[0])}</span>
                  <span>${P.esc(r.producto || '—')}</span>
                  <b>${r.gramos ? r.gramos + ' g' : (r.unidades || '') + ' u'}</b></div>`).join('')
              : '<div class="vacio">Todavía nadie retiró hoy.</div>'}</div></div>
          ${d.reservas ? `<div class="card"><span class="k">Reservas por atender</span>
            <div class="mo-hist" style="margin-top:8px">${d.reservas.ultimas.length
              ? d.reservas.ultimas.map((x) => `<div><span></span><span>${P.esc(x.name)} · ${x.items} ítem${x.items === 1 ? '' : 's'}</span>
                  <span class="tag ${x.estado === 'listo' ? 'tag-ok' : 'tag-deb'}">${x.estado === 'listo' ? 'lista' : 'en preparación'}</span></div>`).join('')
              : '<div class="vacio">Sin reservas esperando.</div>'}</div></div>` : ''}
        </div>`
      cont.addEventListener('click', (e) => {
        const t = e.target.closest('.in-tile[data-ir]')
        if (t) P.ir(t.dataset.ir)
      })
    },
  })
})()
