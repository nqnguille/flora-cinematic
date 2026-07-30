/* Módulo Finanzas (prefijo fz-): Resumen · Cobranza · Movimientos ·
   Gastos fijos · Aportes · Personal. Datos: /api/panel/finanzas/<vista>. */
(() => {
  'use strict'
  const P = window.Panel
  const CAT_ING = { membresia: 'Membresías', producto: 'Productos', extra_gramos: 'Gramos extra', cuota_ong: 'Cuota social', servicio: 'Servicios' }
  const CAT_EGR = { sueldos: 'Sueldos y retiros', alquiler: 'Alquiler', servicios: 'Servicios', insumos: 'Insumos y cultivo', profesionales: 'Profesionales', seguridad: 'Seguridad', otros: 'Otros' }
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

  let cont = null
  let mes = new Date().toISOString().slice(0, 7)
  let tabActual = 'resumen'
  let filtroTipo = ''

  const mesLindo = (m) => MESES[Number(m.slice(5)) - 1] + ' ' + m.slice(0, 4)
  const moverMes = (delta) => {
    const [a, m] = mes.split('-').map(Number)
    const t = a * 12 + m - 1 + delta
    mes = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
  }
  const get = async (vista, extra = '') => {
    const r = await fetch(`/api/panel/finanzas/${vista}?mes=${mes}${extra}`, { credentials: 'include' })
    if (!r.ok) throw new Error(`${vista}: el servidor respondió ${r.status}`)
    return r.json()
  }

  // ---------- armazón ----------
  function armazon() {
    const tabs = [
      ['resumen', 'Resumen'], ['cobranza', 'Cobranza'], ['movimientos', 'Movimientos'],
      ['fijos', 'Gastos fijos'], ['debito', 'Débito automático'],
      P.puede('aportes_ver') && ['aportes', 'Aportes'],
      P.puede('personal_ver') && ['personal', 'Personal'],
    ].filter(Boolean)
    cont.innerHTML = `
      <div class="fila" style="margin-bottom:14px">
        <div class="fz-mes"><button type="button" data-d="-1" aria-label="Mes anterior">‹</button>
          <b id="fz-mes-lbl"></b><button type="button" data-d="1" aria-label="Mes siguiente">›</button></div>
        <span id="fz-pendientes"></span>
        <span class="sp"></span>
        ${P.puede('finanzas_cargar') ? '<button class="btn btn-pri" id="fz-alta" type="button">+ Movimiento</button>' : ''}
      </div>
      <div class="subs" id="fz-tabs">${tabs.map(([v, n]) =>
        `<button type="button" data-tab="${v}" class="${v === tabActual ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div id="fz-cuerpo"><div class="vacio">⏳ Cargando…</div></div>`
    cont.querySelector('.fz-mes').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-d]')
      if (!b) return
      moverMes(Number(b.dataset.d)); pintar()
    })
    cont.querySelector('#fz-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]')
      if (!b) return
      tabActual = b.dataset.tab
      cont.querySelectorAll('#fz-tabs button').forEach((x) => x.classList.toggle('on', x === b))
      pintar()
    })
    const alta = cont.querySelector('#fz-alta')
    if (alta) alta.addEventListener('click', () => modalAlta())
    // delegación única para acciones de las vistas
    cont.addEventListener('click', onClickCuerpo)
  }

  async function pintar() {
    cont.querySelector('#fz-mes-lbl').textContent = mesLindo(mes)
    const cuerpo = cont.querySelector('#fz-cuerpo')
    cuerpo.innerHTML = '<div class="vacio">⏳ Cargando…</div>'
    try {
      if (tabActual === 'resumen') await vResumen(cuerpo)
      else if (tabActual === 'cobranza') await vCobranza(cuerpo)
      else if (tabActual === 'movimientos') await vMovimientos(cuerpo)
      else if (tabActual === 'fijos') await vFijos(cuerpo)
      else if (tabActual === 'debito') await vDebito(cuerpo)
      else if (tabActual === 'aportes') await vAportes(cuerpo)
      else if (tabActual === 'personal') await vPersonal(cuerpo)
    } catch (err) {
      cuerpo.innerHTML = `<div class="vacio">${P.esc(err.message)}</div>`
    }
  }

  // ---------- Resumen ----------
  async function vResumen(cuerpo) {
    const [r, c] = await Promise.all([get('resumen'), get('cobranza')])
    const tot = { ingreso: 0, egreso: 0 }
    const ing = [], egr = []
    for (const f of r.porCategoria) {
      tot[f.tipo] += f.total
      ;(f.tipo === 'ingreso' ? ing : egr).push(f)
    }
    ing.sort((a, b) => b.total - a.total); egr.sort((a, b) => b.total - a.total)
    const res = tot.ingreso - tot.egreso
    const serie = {}
    for (const s of r.serie) {
      serie[s.mes] = serie[s.mes] || { ingreso: 0, egreso: 0 }
      serie[s.mes][s.tipo] = s.total
    }
    const mesesAnio = Object.keys(serie).sort()
    const prev = mesesAnio[mesesAnio.indexOf(mes) - 1]
    const delta = (a, b) => b ? `${a >= b ? '▲' : '▼'} ${Math.abs((a / b - 1) * 100).toFixed(1)}%` : ''
    const dIng = prev ? delta(tot.ingreso, serie[prev].ingreso) : ''
    const dEgr = prev ? delta(tot.egreso, serie[prev].egreso) : ''
    const acum = mesesAnio.filter((m) => m <= mes).reduce((s, m) => s + (serie[m].ingreso - serie[m].egreso), 0)
    const deuda = c.deudores.reduce((s, d) => s + (d.precio || 0), 0)
    const maxRes = Math.max(1, ...mesesAnio.map((m) => Math.abs(serie[m].ingreso - serie[m].egreso)))

    const barras = (filas, cats, color) => {
      const max = Math.max(1, ...filas.map((f) => f.total))
      return filas.map((f) => `<div class="fz-rub">
        <span class="fz-rub-n">${P.esc(cats[f.categoria] || f.categoria)}</span>
        <span class="bar"><i style="width:${(f.total / max * 100).toFixed(1)}%;background:${color}"></i></span>
        <span class="fz-rub-v">${P.fmt(f.total)}</span></div>`).join('')
    }

    cuerpo.innerHTML = `
      <div class="grid3">
        <div class="card"><span class="k">Entró</span><div class="kpi-v">${P.fmt(tot.ingreso)}</div>
          <div class="kpi-d"><span class="${prev && tot.ingreso >= serie[prev].ingreso ? 'up' : 'dn'}">${dIng}</span> contra ${prev ? mesLindo(prev) : '—'}</div></div>
        <div class="card"><span class="k">Salió</span><div class="kpi-v">${P.fmt(tot.egreso)}</div>
          <div class="kpi-d"><span class="${prev && tot.egreso <= serie[prev].egreso ? 'up' : 'dn'}">${dEgr}</span> contra ${prev ? mesLindo(prev) : '—'}</div></div>
        <div class="card fz-res"><span class="k">Resultado del mes</span>
          <div class="kpi-v" style="color:${res >= 0 ? 'var(--grn)' : 'var(--dan)'}">${res >= 0 ? '+' : '−'}${P.fmt(Math.abs(res))}</div>
          <div class="kpi-d">margen ${tot.ingreso ? (res / tot.ingreso * 100).toFixed(1) : 0}% · acumulado ${mes.slice(0, 4)} <b>${acum >= 0 ? '+' : '−'}${P.fmt(Math.abs(acum))}</b></div></div>
      </div>
      ${c.deudores.length ? `<div class="card fz-cobrar" style="margin-top:12px">
        <div><span class="k">Por cobrar</span>
          <div class="fz-cobrar-v">${P.fmt(deuda)}</div>
          <div class="kpi-d">${c.deudores.length} socio${c.deudores.length > 1 ? 's' : ''} con retiros sin cubrir · planes prepagos y compras del mes ya descontados</div></div>
        <button class="btn btn-pri" id="fz-ver-cobranza" type="button">Ver quiénes →</button>
      </div>` : `<div class="card" style="margin-top:12px;border-left:3px solid var(--grn)"><span class="k">Por cobrar</span>
        <div class="kpi-d" style="margin-top:8px">Nadie retiró sin cubrir este mes.</div></div>`}
      <div class="grid2" style="margin-top:12px">
        <div class="card"><span class="k">Entró por</span><div class="fz-rubs">${barras(ing, CAT_ING, 'var(--grn)')}</div>
          <div class="fz-tot"><span>${r.sociosPagaronMp} socios pagaron por Mercado Pago</span><span>${P.fmt(tot.ingreso)}</span></div></div>
        <div class="card"><span class="k">Salió en</span><div class="fz-rubs">${barras(egr, CAT_EGR, 'var(--vio)')}</div>
          <div class="fz-tot"><span></span><span>${P.fmt(tot.egreso)}</span></div></div>
      </div>
      <div class="card" style="margin-top:12px"><span class="k">Resultado mes a mes · ${mes.slice(0, 4)}</span>
        <div class="fz-anio">${mesesAnio.map((m) => {
          const v = serie[m].ingreso - serie[m].egreso
          const h = Math.max(3, Math.abs(v) / maxRes * 64)
          return `<div class="fz-ybar ${m === mes ? 'on' : ''}" title="${mesLindo(m)}: ${P.fmt(v)}">
            <div class="fz-pos">${v >= 0 ? `<i style="height:${h.toFixed(0)}px"></i>` : ''}</div>
            <div class="fz-cero"></div>
            <div class="fz-neg">${v < 0 ? `<i style="height:${Math.min(h, 40).toFixed(0)}px"></i>` : ''}</div>
            <span>${MESES[Number(m.slice(5)) - 1]}</span>
            <small>${v >= 0 ? '+' : '−'}${(Math.abs(v) / 1e6).toFixed(1)} M</small></div>`
        }).join('')}</div></div>`
    pintarPendientes(r.pendientesAprobacion)
  }

  function pintarPendientes(n) {
    const el = cont.querySelector('#fz-pendientes')
    if (!el) return
    el.innerHTML = n && P.puede('finanzas_aprobar')
      ? `<span class="tag tag-deb">${n} pendiente${n > 1 ? 's' : ''} de tu visto bueno</span>` : ''
  }

  // ---------- Cobranza ----------
  async function vCobranza(cuerpo) {
    const c = await get('cobranza')
    if (!c.deudores.length) {
      cuerpo.innerHTML = `<div class="card"><div class="vacio">Nadie retiró sin cubrir en ${mesLindo(mes)}.
        ${c.cubiertosPorPlan ? `<br>${c.cubiertosPorPlan} socio(s) retiraron con plan prepago vigente.` : ''}</div></div>`
      return
    }
    const total = c.deudores.reduce((s, d) => s + (d.precio || 0), 0)
    const haceCuanto = (f) => {
      if (!f) return '<span class="tag tag-mal">sin pagos registrados</span>'
      const n = Math.max(0, (Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5))) - (Number(f.slice(0, 4)) * 12 + Number(f.slice(5, 7))))
      return n <= 1 ? 'hace 1 mes' : `hace ${n} meses`
    }
    cuerpo.innerHTML = `
      <div class="card" style="padding-bottom:6px"><table class="tabla"><thead><tr>
        <th>Socio</th><th>Membresía</th><th>Último pago</th><th class="r">Retiró</th><th class="r">Cuota</th><th class="r"></th>
      </tr></thead><tbody>${c.deudores.map((d) => `<tr>
        <td><div class="fila"><span class="av">${P.esc(P.iniciales(d.nombre))}</span>${P.esc(d.nombre)}</div></td>
        <td>${d.tier ? `${P.esc(d.tier)} · ${d.gramos_mes || '—'} g` : '<span class="tag tag-off">sin membresía</span>'}</td>
        <td style="color:var(--ink2)">${haceCuanto(d.ultimo_pago)}</td>
        <td class="r">${d.gramos} g en ${d.visitas} visita${d.visitas > 1 ? 's' : ''}</td>
        <td class="r"><b>${d.precio ? P.fmt(d.precio) : '—'}</b></td>
        <td class="r">${P.puede('finanzas_cargar') ? `<button class="btn fz-cobrar-btn" data-socio="${d.id}" data-nombre="${P.esc(d.nombre)}" data-precio="${d.precio || ''}" data-tier="${P.esc(d.tier || '')}" type="button">Cobrar</button>
          <button class="btn fz-debito-btn" data-socio="${d.id}" data-nombre="${P.esc(d.nombre)}" type="button">Débito −20%</button>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>
      <div class="card fz-cobrar" style="margin-top:12px">
        <div><span class="k">Total por cobrar</span><div class="fz-cobrar-v">${P.fmt(total)}</div>
        <div class="kpi-d">${c.cubiertosPorPlan ? `${c.cubiertosPorPlan} socio(s) con plan prepago quedaron afuera solos.` : ''}</div></div>
      </div>`
  }

  // ---------- Movimientos ----------
  async function vMovimientos(cuerpo) {
    const m = await get('movimientos', filtroTipo ? `&tipo=${filtroTipo}` : '')
    const chips = [['', 'Todo'], ['ingreso', 'Ingresos'], ['egreso', 'Egresos']]
    const esPresi = P.puede('finanzas_aprobar')
    cuerpo.innerHTML = `
      <div class="fila" style="margin-bottom:10px">${chips.map(([v, n]) =>
        `<button class="chip ${filtroTipo === v ? 'on' : ''}" data-f="${v}" type="button">${n}</button>`).join('')}
        <span class="sp"></span>
        <a class="btn" href="/api/panel/finanzas/export?mes=${mes}" download>CSV del mes</a>
        <a class="btn" href="/api/panel/finanzas/export?anio=${mes.slice(0, 4)}" download>CSV del año</a></div>
      <div class="card" style="padding-bottom:6px">${m.movimientos.length ? `<table class="tabla"><thead><tr>
        <th>Fecha</th><th>Quién</th><th>Concepto</th><th>Medio</th><th class="r">Importe</th><th class="r"></th>
      </tr></thead><tbody>${m.movimientos.map((x) => `<tr>
        <td style="color:var(--muted)">${x.fecha.slice(8)}/${x.fecha.slice(5, 7)}</td>
        <td>${P.esc(x.socio_nombre || x.persona || '—')}</td>
        <td>${P.esc(x.concepto)}${x.estado === 'pendiente_aprobacion' ? ' <span class="tag tag-deb">pendiente</span>' : ''}</td>
        <td style="color:var(--muted)">${P.esc(x.medio || '—')}</td>
        <td class="r" style="color:${x.tipo === 'ingreso' ? 'var(--grn)' : 'var(--ink)'};font-weight:600">${x.tipo === 'ingreso' ? '+' : '−'}${P.fmt(x.neto)}</td>
        <td class="r">${esPresi && x.estado === 'pendiente_aprobacion' ? `
          <button class="btn fz-aprobar" data-id="${x.id}" type="button">Aprobar</button>
          <button class="btn btn-peligro fz-anular" data-id="${x.id}" type="button" aria-label="Anular">×</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>` : '<div class="vacio">Sin movimientos este mes.</div>'}</div>
      <div class="fz-tot" style="padding:10px 6px 0"><span>${m.movimientos.length} movimientos</span>
        <span>entró ${P.fmt(m.movimientos.filter((x) => x.tipo === 'ingreso' && x.estado === 'confirmado').reduce((s, x) => s + x.neto, 0))}
        · salió ${P.fmt(m.movimientos.filter((x) => x.tipo === 'egreso' && x.estado === 'confirmado').reduce((s, x) => s + x.neto, 0))}</span></div>`
  }

  // ---------- Gastos fijos ----------
  async function vFijos(cuerpo) {
    const f = await get('fijos')
    const porRef = {}
    for (const g of f.generados) porRef[g.ref] = g
    const esPresi = P.puede('finanzas_aprobar')
    cuerpo.innerHTML = `
      <div class="fila" style="margin-bottom:10px">
        ${esPresi ? `<button class="btn btn-pri" id="fz-generar" type="button">Armar los fijos de ${mesLindo(mes)}</button>` : ''}
        <span class="msg" id="fz-fijos-msg"></span></div>
      <div class="card" style="padding-bottom:6px"><table class="tabla"><thead><tr>
        <th>Gasto</th><th>Quién</th><th>Vence</th><th class="r">Estimado</th><th>Estado</th><th class="r"></th>
      </tr></thead><tbody>${f.fijos.map((g) => {
        const mov = porRef[`fijo:${g.id}:${mes}`]
        const estado = !mov ? '<span class="tag tag-off">sin generar</span>'
          : mov.estado === 'confirmado' ? `<span class="tag tag-ok">pagado ${P.fmt(mov.neto)}</span>`
          : '<span class="tag tag-deb">pendiente</span>'
        return `<tr>
          <td>${P.esc(g.nombre)}${g.solo_dueno ? ' <span class="tag tag-auto">solo vos</span>' : ''}</td>
          <td style="color:var(--ink2)">${P.esc(g.persona || '—')}</td>
          <td style="color:var(--muted)">día ${g.dia_vencimiento || '—'}</td>
          <td class="r">${P.fmt(g.monto_estimado || 0)}</td>
          <td>${estado}</td>
          <td class="r">${esPresi && mov && mov.estado === 'pendiente_aprobacion'
            ? `<button class="btn fz-pagar" data-id="${mov.id}" data-monto="${g.monto_estimado || 0}" data-nombre="${P.esc(g.nombre)}" type="button">Marcar pagado</button>` : ''}</td>
        </tr>`
      }).join('')}</tbody></table></div>`
    const gen = cuerpo.querySelector('#fz-generar')
    if (gen) gen.addEventListener('click', async () => {
      const msg = cuerpo.querySelector('#fz-fijos-msg')
      msg.className = 'msg'; msg.textContent = '⏳ generando…'
      const r = await fetch('/api/panel/finanzas/fijos', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'generar', mes }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) {
        msg.className = 'msg ok'
        msg.textContent = d.creados ? `✔ ${d.creados} gastos armados como pendientes` : 'Ya estaban generados'
        setTimeout(pintar, 900)
      } else {
        msg.className = 'msg err'; msg.textContent = '✗ ' + (d.error || 'error')
      }
    })
  }

  // ---------- Débito automático (suscripciones MP) ----------
  async function vDebito(cuerpo) {
    const r = await fetch('/api/panel/mp/suscripciones', { credentials: 'include' })
    if (!r.ok) { cuerpo.innerHTML = `<div class="vacio">El servidor respondió ${r.status}.</div>`; return }
    const d = await r.json()
    const EST = { activa: 'tag-ok', pendiente: 'tag-deb', pausada: 'tag-deb', cancelada: 'tag-off' }
    cuerpo.innerHTML = `
      ${!d.configurado ? `<div class="card" style="border-left:3px solid var(--amb);margin-bottom:12px">
        <span class="k">Falta el token de Mercado Pago</span>
        <div class="kpi-d" style="margin-top:6px">Cuando esté cargado el secret MP_ACCESS_TOKEN, desde acá se crean
        las suscripciones del 20%. Los botones ya están listos.</div></div>` : ''}
      <p style="color:var(--ink2);margin:0 0 14px;max-width:72ch">El débito corre solo todos los meses al precio
      con 20% (renovable cada 3 débitos seguidos — si corta, lo pierde). Cada acreditación entra sola al libro
      y habilita los gramos del mes. El alta se hace desde Cobranza, con el botón «Débito −20%» de cada socio.</p>
      <div class="card" style="padding-bottom:6px">${d.suscripciones.length ? `<table class="tabla"><thead><tr>
        <th>Socio</th><th>Estado</th><th class="r">Monto</th><th class="r">Racha</th><th>Termina</th><th></th><th class="r"></th>
      </tr></thead><tbody>${d.suscripciones.map((s) => `<tr>
        <td><div class="fila"><span class="av">${P.esc(P.iniciales(s.nombre))}</span>${P.esc(s.nombre)}</div></td>
        <td><span class="tag ${EST[s.estado] || 'tag-off'}">${P.esc(s.estado)}</span></td>
        <td class="r" style="font-weight:600">${P.fmt(s.monto)}</td>
        <td class="r">${s.racha_meses} mes${s.racha_meses === 1 ? '' : 'es'}</td>
        <td style="color:var(--ink2)">${s.fin ? `${s.fin.slice(8)}/${s.fin.slice(5, 7)}/${s.fin.slice(0, 4)}` : '—'}</td>
        <td style="color:var(--muted);font-size:11.5px">${s.racha_meses > 0 ? `el 20% se renueva en ${3 - (s.racha_meses % 3)} débito(s)` : '3 cuotas y termina'}</td>
        <td class="r"><button class="btn fz-sync" data-id="${s.id}" type="button">Sincronizar</button></td>
      </tr>`).join('')}</tbody></table>` : '<div class="vacio">Todavía no hay suscripciones. Arrancá desde Cobranza con el botón «Débito −20%».</div>'}</div>`
  }

  async function crearSuscripcion(socioId, nombre) {
    const ov = P.modal(`Débito automático — ${nombre}`, '<div class="vacio">⏳ Creando la suscripción en Mercado Pago…</div>')
    const r = await fetch('/api/panel/mp/suscripcion', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socio_id: Number(socioId) }),
    })
    const d = await r.json().catch(() => ({}))
    const cuerpo = ov.querySelector('.pn-mod-cuerpo')
    if (!r.ok) {
      cuerpo.innerHTML = `<p style="color:var(--dan);margin:0">${P.esc(d.error || 'Error ' + r.status)}</p>
        <div class="pn-mod-acciones"><button class="btn" onclick="Panel.cerrarModal()" type="button">Cerrar</button></div>`
      return
    }
    const wa = `https://wa.me/?text=${encodeURIComponent(`Hola! Te paso el link para activar el débito automático de tu membresía ${d.tier} de Flora con el 20% de descuento: 3 cuotas de ${P.fmt(d.monto)} por mes. Lo autorizás una sola vez y corre solo — si mantenés el débito, el descuento se te renueva otros 3 meses automáticamente: ${d.link}`)}`
    cuerpo.innerHTML = `
      <p style="color:var(--ink2);margin:0 0 12px">Listo: <b>3 cuotas mensuales de ${P.fmt(d.monto)}</b>
      (${P.esc(d.tier)} con el 20%). Si ${P.esc(nombre)} mantiene la racha, el sistema le renueva el descuento
      otros 3 meses solo; si corta, la suscripción termina ahí. Le falta autorizarla una vez desde este link:</p>
      <input class="input" value="${P.esc(d.link)}" readonly onclick="this.select()" />
      <div class="pn-mod-acciones">
        <a class="btn" href="${P.esc(d.link)}" target="_blank" rel="noopener">Abrir link</a>
        <a class="btn btn-pri" href="${wa}" target="_blank" rel="noopener">Mandar por WhatsApp</a>
      </div>`
  }

  // ---------- Aportes ----------
  async function vAportes(cuerpo) {
    const a = await get('aportes')
    const porPersona = {}
    for (const p of a.porPersona) {
      porPersona[p.aportante] = porPersona[p.aportante] || { aportes: 0, cuotas: 0, pendientes: 0 }
      if (p.tipo === 'aporte') porPersona[p.aportante].aportes += p.usd
      if (p.tipo === 'cuota_compra') { porPersona[p.aportante].cuotas += p.usd; porPersona[p.aportante].pendientes += p.pendientes }
    }
    const personas = Object.entries(porPersona).filter(([, v]) => v.aportes || v.cuotas)
      .sort((x, y) => (y[1].aportes + y[1].cuotas) - (x[1].aportes + x[1].cuotas))
    cuerpo.innerHTML = `
      <p style="color:var(--ink2);margin:0 0 14px;max-width:70ch">El capital de la asociación, en dólares:
      los aportes fundacionales y las cuotas de la compra. Separado de la operación mensual.</p>
      <div class="fz-personas">${personas.map(([nom, v]) => `<div class="card">
        <div class="fila"><span class="av">${P.esc(P.iniciales(nom))}</span><b>${P.esc(nom)}</b></div>
        <div class="kpi-v" style="font-size:26px;margin-top:10px">USD ${P.fmtN(Math.round(v.aportes + v.cuotas))}</div>
        <div class="kpi-d">${v.cuotas ? `cuotas de la compra USD ${P.fmtN(Math.round(v.cuotas))}` : 'aportes fundacionales'}
        ${v.pendientes ? ` · <span style="color:var(--amb);font-weight:600">${v.pendientes} cuota(s) pendiente(s)</span>` : ''}</div>
      </div>`).join('')}</div>
      <div class="card" style="margin-top:12px;padding-bottom:6px"><span class="k">Últimos movimientos de capital</span>
      <table class="tabla" style="margin-top:8px"><thead><tr>
        <th>Fecha</th><th>Quién</th><th>Concepto</th><th>Estado</th><th class="r">USD</th>
      </tr></thead><tbody>${a.aportes.slice(0, 40).map((x) => `<tr>
        <td style="color:var(--muted)">${P.esc(x.fecha)}</td><td>${P.esc(x.aportante)}</td>
        <td>${P.esc(x.concepto)}</td>
        <td>${x.estado === 'pendiente' ? '<span class="tag tag-deb">pendiente</span>' : '<span class="tag tag-ok">recibido</span>'}</td>
        <td class="r" style="font-weight:600;color:${x.tipo === 'gasto' ? 'var(--ink)' : 'var(--grn)'}">${x.tipo === 'gasto' ? '−' : '+'}${P.fmtN(Math.round(x.monto_usd))}</td>
      </tr>`).join('')}</tbody></table></div>`
  }

  // ---------- Personal (solo presidente) ----------
  async function vPersonal(cuerpo) {
    const p = await get('personal', `&anio=${mes.slice(0, 4)}`)
    const pagosPorMes = {}
    for (const x of p.pagos) {
      pagosPorMes[x.mes] = pagosPorMes[x.mes] || []
      pagosPorMes[x.mes].push(x)
    }
    cuerpo.innerHTML = `
      <div class="grid3">${p.personal.map((f) => `<div class="card">
        <div class="fila"><span class="av">${P.esc(P.iniciales(f.nombre))}</span>
        <div><b>${P.esc(f.nombre)}</b><div style="color:var(--muted);font-size:11.5px">${P.esc(f.rol || '')}</div></div></div>
        <div class="kpi-v" style="font-size:24px;margin-top:10px">${P.fmt(f.monto_mensual || 0)}</div>
        <div class="kpi-d">${f.frecuencia === 'semanal' ? 'por semana' : 'por mes'}</div>
      </div>`).join('')}</div>
      <div class="card" style="margin-top:12px;padding-bottom:6px"><span class="k">Pagos de sueldos · ${mes.slice(0, 4)}</span>
      <table class="tabla" style="margin-top:8px"><thead><tr>
        <th>Mes</th><th>Concepto</th><th class="r">Importe</th>
      </tr></thead><tbody>${Object.keys(pagosPorMes).sort().reverse().map((m) =>
        pagosPorMes[m].map((x, i) => `<tr>
          <td style="color:var(--muted)">${i === 0 ? mesLindo(m) : ''}</td>
          <td>${P.esc(x.concepto)}</td>
          <td class="r" style="font-weight:600">${P.fmt(x.neto)}</td>
        </tr>`).join('')).join('')}</tbody></table></div>`
  }

  // ---------- acciones delegadas ----------
  async function onClickCuerpo(e) {
    const verCob = e.target.closest('#fz-ver-cobranza')
    if (verCob) { cont.querySelector('#fz-tabs button[data-tab="cobranza"]').click(); return }
    const chip = e.target.closest('.chip[data-f]')
    if (chip) { filtroTipo = chip.dataset.f; pintar(); return }
    const cobrar = e.target.closest('.fz-cobrar-btn')
    if (cobrar) {
      modalAlta({ socio_id: cobrar.dataset.socio, concepto: cobrar.dataset.tier, neto: cobrar.dataset.precio, nombre: cobrar.dataset.nombre, categoria: 'membresia' })
      return
    }
    const deb = e.target.closest('.fz-debito-btn')
    if (deb) { crearSuscripcion(deb.dataset.socio, deb.dataset.nombre); return }
    const sync = e.target.closest('.fz-sync')
    if (sync) {
      await fetch('/api/panel/mp/sincronizar', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: Number(sync.dataset.id) }),
      })
      pintar()
      return
    }
    const ap = e.target.closest('.fz-aprobar'), an = e.target.closest('.fz-anular')
    if (ap || an) {
      if (an && !(await P.confirmar('¿Anular este movimiento? Sale de todos los totales.', 'Sí, anular'))) return
      await fetch('/api/panel/finanzas/movimientos', {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: Number((ap || an).dataset.id), accion: ap ? 'aprobar' : 'anular' }),
      })
      pintar()
      return
    }
    const pagar = e.target.closest('.fz-pagar')
    if (pagar) {
      const ov = P.modal(`Pagar ${pagar.dataset.nombre}`, `
        <label class="lb" for="fz-pago-monto">Importe real pagado</label>
        <input class="input" id="fz-pago-monto" type="number" value="${P.esc(pagar.dataset.monto)}" min="1" />
        <div class="pn-mod-acciones"><button class="btn" data-r="no" type="button">Cancelar</button>
        <button class="btn btn-pri" data-r="si" type="button">Confirmar pago</button></div>`)
      ov.addEventListener('click', async (ev) => {
        const x = ev.target.closest('button[data-r]')
        if (!x) return
        if (x.dataset.r === 'si') {
          const neto = Number(ov.querySelector('#fz-pago-monto').value)
          await fetch('/api/panel/finanzas/fijos', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accion: 'pagar', id: Number(pagar.dataset.id), neto }),
          })
        }
        P.cerrarModal(); pintar()
      })
    }
  }

  // ---------- alta manual ----------
  function modalAlta(pre = {}) {
    const ov = P.modal(pre.nombre ? `Cobrar a ${pre.nombre}` : 'Nuevo movimiento', `
      <div style="display:grid;gap:10px">
        <div class="grid2">
          <div><label class="lb" for="fz-a-tipo">Tipo</label><select class="sel" id="fz-a-tipo">
            <option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select></div>
          <div><label class="lb" for="fz-a-fecha">Fecha</label><input class="input" id="fz-a-fecha" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
        </div>
        <div><label class="lb" for="fz-a-concepto">Concepto</label><input class="input" id="fz-a-concepto" value="${P.esc(pre.concepto || '')}" placeholder="Medium julio · Alquiler · 1 gotero Q3…" /></div>
        <div class="grid2">
          <div><label class="lb" for="fz-a-neto">Importe</label><input class="input" id="fz-a-neto" type="number" min="1" value="${P.esc(pre.neto || '')}" /></div>
          <div><label class="lb" for="fz-a-medio">Medio</label><select class="sel" id="fz-a-medio">
            <option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option>
            <option value="mp">Mercado Pago</option><option value="canje">Canje</option></select></div>
        </div>
        <div><label class="lb" for="fz-a-cat">Categoría</label><select class="sel" id="fz-a-cat">
          ${Object.entries(CAT_ING).map(([v, n]) => `<option value="${v}" ${pre.categoria === v ? 'selected' : ''}>${n}</option>`).join('')}
          ${Object.entries(CAT_EGR).map(([v, n]) => `<option value="${v}">${n} (egreso)</option>`).join('')}
        </select></div>
        <div class="fila"><button class="btn btn-pri" id="fz-a-ok" type="button">Guardar</button><span class="msg" id="fz-a-msg"></span></div>
      </div>`)
    ov.querySelector('#fz-a-ok').addEventListener('click', async () => {
      const msg = ov.querySelector('#fz-a-msg')
      msg.className = 'msg'; msg.textContent = '⏳ guardando…'
      const r = await fetch('/api/panel/finanzas/movimientos', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: ov.querySelector('#fz-a-tipo').value,
          fecha: ov.querySelector('#fz-a-fecha').value,
          concepto: ov.querySelector('#fz-a-concepto').value,
          neto: Number(ov.querySelector('#fz-a-neto').value),
          medio: ov.querySelector('#fz-a-medio').value,
          categoria: ov.querySelector('#fz-a-cat').value,
          socio_id: pre.socio_id ? Number(pre.socio_id) : null,
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) {
        msg.className = 'msg ok'
        msg.textContent = d.estado === 'pendiente_aprobacion' ? '✔ guardado — espera el visto bueno del presidente' : '✔ guardado'
        setTimeout(() => { P.cerrarModal(); pintar() }, 800)
      } else {
        msg.className = 'msg err'; msg.textContent = '✗ ' + (d.error || 'error')
      }
    })
  }

  P.registrar('finanzas', {
    init(el) { cont = el; armazon(); pintar() },
  })
})()
