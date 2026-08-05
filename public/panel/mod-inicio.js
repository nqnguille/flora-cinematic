/* Módulo Inicio (prefijo in-): el resumen del día al abrir el panel.
   Cada rol ve sus tarjetas; los accesos directos llevan al módulo que toca. */
(() => {
  'use strict'
  const P = window.Panel
  // Usa el formateador del shell, con respaldo por si este módulo se cargó
  // antes que el shell nuevo (durante un deploy): una fecha fea es mejor que
  // el panel caído.
  const fFecha = (v) => (window.Panel && window.Panel.fecha)
    ? window.Panel.fecha(v)
    : (String(v || '').slice(0, 10).split('-').reverse().join('/') || '—')


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
      // `capitalize` de CSS pone en mayúscula CADA palabra: quedaba
      // «Miércoles, 5 De Agosto». Va solo la primera letra.
      const hoyCrudo = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
      const hoyLindo = hoyCrudo.charAt(0).toUpperCase() + hoyCrudo.slice(1)
      const res = d.mes ? d.mes.ingreso - d.mes.egreso : null

      const tiles = []
      tiles.push(`<div class="card in-tile" data-ir="mostrador">
        <span class="k">Retiros de hoy</span>
        <div class="kpi-v" style="font-size:28px">${d.retirosHoy.n}</div>
        <div class="kpi-d">${d.retirosHoy.gramos} g dispensados</div></div>`)
      if (d.cobrosHoy) tiles.push(`<div class="card in-tile" data-ir="finanzas">
        <span class="k">Cobros de hoy</span>
        <div class="kpi-v" style="font-size:28px;color:var(--grn)">${P.fmt(d.cobrosHoy.total)}</div>
        <div class="kpi-d">${d.cobrosHoy.n} pago${d.cobrosHoy.n === 1 ? '' : 's'} registrados</div></div>`)
      if (d.reservas) tiles.push(`<div class="card in-tile" data-ir="reservas">
        <span class="k">Reservas activas</span>
        <div class="kpi-v" style="font-size:28px">${d.reservas.pendientes + d.reservas.listas}</div>
        <div class="kpi-d">${d.reservas.pendientes} en preparación · ${d.reservas.listas} listas</div></div>`)
      if (d.pendientesAprobacion != null) tiles.push(`<div class="card in-tile" data-ir="finanzas">
        <span class="k">Tu visto bueno</span>
        <div class="kpi-v" style="font-size:28px;color:${d.pendientesAprobacion ? 'var(--amb)' : 'var(--ink)'}">${d.pendientesAprobacion}</div>
        <div class="kpi-d">movimiento${d.pendientesAprobacion === 1 ? '' : 's'} esperando</div></div>`)
      if (res != null) tiles.push(`<div class="card in-tile ${res >= 0 ? '' : ''}" data-ir="finanzas">
        <span class="k">El mes va</span>
        <div class="kpi-v" style="font-size:28px;color:${res >= 0 ? 'var(--grn)' : 'var(--dan)'}">${res >= 0 ? '+' : '−'}${P.fmt(Math.abs(res))}</div>
        <div class="kpi-d">entró ${P.fmt(d.mes.ingreso)} · salió ${P.fmt(d.mes.egreso)}</div></div>`)
      if (d.vencimientos && (d.vencimientos.vencidos || d.vencimientos.en60)) tiles.push(`<div class="card in-tile" data-ir="socios" data-filtro="porVencer">
        <span class="k">REPROCANN por vencer</span>
        <div class="kpi-v" style="font-size:28px;color:${d.vencimientos.vencidos ? 'var(--dan)' : 'var(--amb)'}">${d.vencimientos.vencidos + d.vencimientos.en60}</div>
        <div class="kpi-d">${d.vencimientos.vencidos ? `<b style="color:var(--dan)">${d.vencimientos.vencidos} vencido(s)</b> · ` : ''}${d.vencimientos.en60} vencen en 60 días</div></div>`)
      if (d.debitos) tiles.push(`<div class="card in-tile" data-ir="finanzas">
        <span class="k">Débito automático</span>
        <div class="kpi-v" style="font-size:28px;color:var(--grn)">${P.fmt(d.debitos.recaudado_mes)}</div>
        <div class="kpi-d">${d.debitos.al_dia} al día · ${d.debitos.esperando} esperando${d.debitos.terminan_mes ? ` · <b style="color:var(--amb)">${d.debitos.terminan_mes} terminan este mes</b>` : ''}${d.debitos.sin_identificar ? ` · <b style="color:var(--amb)">${d.debitos.sin_identificar} por identificar</b>` : ''}</div></div>`)

      cont.innerHTML = `
        <p style="color:var(--ink2);margin:0 0 14px">${P.esc(hoyLindo)}</p>
        <div class="in-tiles">${tiles.join('')}</div>
        ${d.vencimientos && d.vencimientos.proximos.length ? `<div class="card" style="margin-top:14px">
          <span class="k">Próximos vencimientos de REPROCANN</span>
          ${d.vencimientos.proximos.map((v) => `<div class="fila" style="padding:6px 0;border-top:1px solid var(--line)">
            <span>${P.esc(v.nombre)}</span><span class="pn-sp"></span>
            <span style="color:${v.dias < 0 ? 'var(--dan)' : v.dias <= 60 ? 'var(--amb)' : 'var(--muted)'};font-size:13px;font-weight:600">
              ${v.dias < 0 ? 'vencido hace ' + Math.abs(v.dias) + ' días' : v.dias === 0 ? 'vence HOY' : 'vence en ' + v.dias + ' días'}
              <i style="color:var(--muted);font-weight:400">· ${fFecha(v.reprocann_vence)}</i></span>
          </div>`).join('')}
        </div>` : ''}
        <div class="grid2" style="margin-top:14px;align-items:start">
          <div class="card"><span class="k">Retiros de hoy</span>
            <div class="mo-hist" style="margin-top:6px">${d.retirosHoy.lista.length
              ? d.retirosHoy.lista.map((r) => `<div><span>${P.esc(r.nombre.split(' ')[0])}</span>
                  <span>${P.esc(r.producto || '—')}</span>
                  <b>${r.gramos ? r.gramos + ' g' : (r.unidades || '') + ' u'}</b></div>`).join('')
              : '<div class="vacio">Todavía nadie retiró hoy.</div>'}</div></div>
          ${d.reservas ? `<div class="card"><span class="k">Reservas por atender</span>
            <div class="mo-hist" style="margin-top:6px">${d.reservas.ultimas.length
              ? d.reservas.ultimas.map((x) => `<div><span></span><span>${P.esc(x.name)} · ${x.items} ítem${x.items === 1 ? '' : 's'}</span>
                  <span class="tag ${x.estado === 'listo' ? 'tag-ok' : 'tag-deb'}">${x.estado === 'listo' ? 'lista' : 'en preparación'}</span></div>`).join('')
              : '<div class="vacio">Sin reservas esperando.</div>'}</div></div>` : ''}
        </div>`
      cont.addEventListener('click', (e) => {
        const t = e.target.closest('.in-tile[data-ir]')
        if (!t) return
        // el tile puede llevar un filtro precargado (ej. REPROCANN por vencer)
        if (t.dataset.filtro) {
          try {
            const nav = JSON.parse(sessionStorage.getItem('so-nav') || '{}')
            nav.filtro = t.dataset.filtro; nav.sub = 'maestra'
            sessionStorage.setItem('so-nav', JSON.stringify(nav))
          } catch { /* nada */ }
        }
        P.ir(t.dataset.ir)
      })
    },
  })
})()
