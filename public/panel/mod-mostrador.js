/* Módulo Mostrador (prefijo mo-): el retiro se carga en el momento.
   Buscar socio → ficha con saldo de gramos → armar retiro → confirmar.
   Sub-tab Stock: kardex por ítem + entradas (cosecha/compra/ajuste/merma). */
(() => {
  'use strict'
  const P = window.Panel

  let cont = null
  let tab = 'atender'
  let socioActual = null       // {socio, saldo, ultimos}
  let catalogo = []            // genéticas activas con stock
  let carrito = []             // [{item, nombre, gramos|unidades, clase}]

  const get = async (vista, extra = '') => {
    const r = await fetch(`/api/panel/mostrador/${vista}${extra}`, { credentials: 'include' })
    if (!r.ok) throw new Error(`${vista}: el servidor respondió ${r.status}`)
    return r.json()
  }

  function armazon() {
    const conStock = P.puede('catalogo_editar') || P.puede('mostrador_operar')
    cont.innerHTML = `
      <div class="subs" id="mo-tabs">
        <button type="button" data-tab="atender" class="on">Atender</button>
        ${conStock ? '<button type="button" data-tab="stock">Stock</button>' : ''}
      </div>
      <div id="mo-cuerpo"></div>`
    cont.querySelector('#mo-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]')
      if (!b) return
      tab = b.dataset.tab
      cont.querySelectorAll('#mo-tabs button').forEach((x) => x.classList.toggle('on', x === b))
      pintar()
    })
    cont.addEventListener('click', onClick)
    pintar()
  }

  async function pintar() {
    const cuerpo = cont.querySelector('#mo-cuerpo')
    if (tab === 'stock') return vStock(cuerpo)
    vAtender(cuerpo)
  }

  // ---------- Atender ----------
  function vAtender(cuerpo) {
    if (!socioActual) {
      cuerpo.innerHTML = `
        <div class="card" style="max-width:560px;margin:0 auto;text-align:center;padding:34px 28px">
          <span class="k">¿A quién atendés?</span>
          <input class="input" id="mo-q" placeholder="Nombre o email del paciente…" autocomplete="off"
                 style="margin-top:14px;font-size:15px;padding:12px 14px" />
          <div id="mo-resultados" style="margin-top:10px;text-align:left"></div>
        </div>`
      const q = cuerpo.querySelector('#mo-q')
      q.focus()
      let t = null
      q.addEventListener('input', () => {
        clearTimeout(t)
        t = setTimeout(async () => {
          const res = cuerpo.querySelector('#mo-resultados')
          if (q.value.trim().length < 2) { res.innerHTML = ''; return }
          const d = await get('buscar', `?q=${encodeURIComponent(q.value.trim())}`)
          res.innerHTML = d.socios.length ? d.socios.map((s) => `
            <button class="mo-hit" data-id="${s.id}" type="button">
              <span class="av">${P.esc(P.iniciales(s.nombre))}</span>
              <span><b>${P.esc(s.nombre)}</b>
                <small>${s.numero ? '#' + s.numero + ' · ' : ''}${P.esc(s.tier || 'sin membresía')}${s.estado !== 'activo' ? ' · inactivo' : ''}</small></span>
            </button>`).join('') : '<div class="vacio">No aparece en el padrón.</div>'
        }, 250)
      })
      return
    }
    const { socio, saldo, ultimos } = socioActual
    const esPlan = saldo.tipo === 'plan'
    // Débito: `saldo` ya viene topeado en 40 g (lo que la credencial ampara
    // transportar), y `acumulado` es todo lo que tiene guardado. Hay que
    // mostrar los dos o el mostrador cree que perdió gramos.
    const esDebito = saldo.tipo === 'debito'
    const saldoColor = saldo.saldo > 0 ? 'var(--grn)' : 'var(--amb)'
    cuerpo.innerHTML = `
      <div class="fila" style="margin-bottom:10px">
        <button class="btn" id="mo-volver" type="button">‹ Otro paciente</button>
        <div class="fila"><span class="av">${P.esc(P.iniciales(socio.nombre))}</span>
          <b style="font-size:15px">${P.esc(socio.nombre)}</b>
          ${socio.numero ? `<span class="tag tag-off">#${socio.numero}</span>` : ''}
          </div>
      </div>
      <div class="grid2" style="grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);align-items:start">
        <div style="display:grid;gap:10px">
          ${avisoReprocann(socio)}
          <div class="card">
            <span class="k">${esPlan ? `Saldo del plan (${P.esc(saldo.tier)})` : esDebito ? `Puede retirar hoy (${P.esc(saldo.tier)} · débito)` : 'Le queda este mes'}</span>
            <div class="fila" style="align-items:baseline;gap:10px;margin:10px 0 4px">
              <b style="font-family:var(--font-display);font-size:42px;line-height:1;color:${saldoColor}">${Math.max(0, saldo.saldo)} g</b>
              <span style="color:var(--muted)">${esPlan
                ? `de ${saldo.total} g hasta ${P.esc((saldo.hasta || '').slice(0, 7))}`
                : saldo.habilitado > 0 ? `de ${saldo.habilitado} g pagados este mes` : 'sin cuota paga este mes'}</span>
            </div>
            ${(esPlan ? saldo.total : saldo.habilitado) > 0 ? `<div class="bar" style="margin:8px 0 6px"><i style="width:${Math.min(100, ((esPlan ? saldo.retirado : saldo.retiradoMes) / (esPlan ? saldo.total : saldo.habilitado)) * 100).toFixed(1)}%"></i></div>` : ''}
            <div class="kpi-d">Retiró ${saldo.retiradoMes} g en ${saldo.visitasMes} visita${saldo.visitasMes === 1 ? '' : 's'} este mes.</div>
            ${!esPlan && !saldo.pagoEsteMes ? `
              <div style="margin-top:10px;padding:10px 12px;background:var(--amb-soft);border-radius:8px;font-size:13px;color:var(--amb);font-weight:600">
                Debe la cuota${saldo.tier ? ` — ${P.esc(saldo.tier)}` : ''}. Cobrala antes de entregar.</div>
              <div style="margin-top:10px"><button class="btn btn-pri" id="mo-cobrar" type="button">Cobrar cuota</button></div>` : ''}
          </div>
          <div class="card">
            <span class="k">Últimos retiros</span>
            <div class="mo-hist">${(ultimos || []).length ? ultimos.map((u) => `
              <div><span>${P.esc(u.fecha.slice(8))}/${P.esc(u.fecha.slice(5, 7))}</span>
              <span>${P.esc(u.producto || '—')}</span>
              <b>${u.gramos ? u.gramos + ' g' : (u.unidades || '') + ' u'}</b></div>`).join('') : '<div class="vacio">Sin retiros registrados.</div>'}</div>
          </div>
        </div>
        <div class="card">
          <span class="k">Armar retiro</span>
          <div class="grid2" style="grid-template-columns:minmax(0,1.6fr) 90px auto;align-items:end;margin-top:10px;gap:6px">
            <div><label class="lb" for="mo-gen">Genética</label>
              <select class="sel" id="mo-gen">${catalogo.map((g) =>
                `<option value="${P.esc(g.id)}" data-nombre="${P.esc(g.nombre)}">${P.esc(g.nombre)}${g.stock != null ? ` — ${g.stock} g` : ''}</option>`).join('')}</select></div>
            <div><label class="lb" for="mo-g">Gramos</label><input class="input" id="mo-g" type="number" min="1" max="200" step="0.5" value="5" /></div>
            <button class="btn" id="mo-agregar" type="button">Agregar</button>
          </div>
          <div id="mo-carrito" style="margin-top:14px"></div>
          <div class="fila" style="margin-top:14px">
            <button class="btn btn-pri" id="mo-confirmar" type="button" disabled>Registrar retiro</button>
            <span class="msg" id="mo-msg"></span>
          </div>
        </div>
      </div>`
    pintarCarrito()
  }


  // El REPROCANN es lo que habilita legalmente a retirar. Si no está vigente,
  // el mostrador lo dice ANTES de entregar — no después.
  function avisoReprocann(socio) {
    const e = socio.reprocann_estado || 'sin_iniciar'
    if (e === 'aprobado') {
      const v = socio.reprocann_vence
      const dias = v ? Math.floor((Date.parse(v) - Date.now()) / 86400000) : null
      if (dias !== null && dias < 0) return tarjeta('vencido', `El REPROCANN venció el ${v}. No debería retirar hasta renovarlo.`, 'dan')
      if (dias !== null && dias < 45) return tarjeta('por vencer', `El REPROCANN vence en ${dias} días (${v}). Conviene arrancar la renovación.`, 'amb')
      return ''
    }
    if (e === 'autocultivo') return ''
    const TXT = {
      sin_iniciar: 'No arrancó su REPROCANN todavía.',
      revisar: 'No sabemos en qué anda su REPROCANN — hay que confirmarlo.',
      esperando_codigo: 'Le falta cargar su código de vinculación.',
      codigo_listo: 'Ya dio su código; Ezequiel todavía no cargó el trámite.',
      cargado: 'Falta que acepte el consentimiento en su cuenta de REPROCANN.',
      observado: 'Su trámite tiene una observación sin resolver.',
      a_vincular: 'Ya firmó: nos toca vincularlo como cultivadora.',
      en_evaluacion: 'Su trámite está en evaluación del Ministerio.',
      revision_medica: 'El Ministerio devolvió su trámite al médico.',
      rechazado: 'Su trámite fue RECHAZADO.',
      vencido: 'Su certificado está vencido.',
    }
    const grave = ['rechazado', 'vencido'].includes(e)
    return tarjeta('en trámite', TXT[e] || 'Su REPROCANN no está vigente.', grave ? 'dan' : 'amb')
  }
  function tarjeta(titulo, texto, color) {
    return `<div class="card" style="border-left:3px solid var(--${color})">
      <span class="k" style="color:var(--${color})">REPROCANN ${P.esc(titulo)}</span>
      <div class="kpi-d" style="margin-top:6px;color:var(--ink2)">${P.esc(texto)}</div></div>`
  }

  function pintarCarrito() {
    const box = cont.querySelector('#mo-carrito')
    const btn = cont.querySelector('#mo-confirmar')
    if (!box) return
    if (!carrito.length) {
      box.innerHTML = '<div class="vacio" style="padding:16px">Todavía no agregaste nada.</div>'
      if (btn) btn.disabled = true
      return
    }
    const total = carrito.reduce((s, i) => s + (i.gramos || 0), 0)
    const saldo = socioActual ? socioActual.saldo.saldo : 0
    box.innerHTML = `
      ${carrito.map((i, ix) => `<div class="mo-item">
        <span>${P.esc(i.nombre)}</span><b>${i.gramos} g</b>
        <button class="btn btn-peligro mo-quitar" data-ix="${ix}" type="button" aria-label="Quitar">×</button></div>`).join('')}
      <div class="fz-tot"><span>Total del retiro</span><span>${total} g</span></div>
      ${total > Math.max(0, saldo) ? `<div style="margin-top:6px;padding:9px 12px;background:var(--amb-soft);border-radius:8px;font-size:12px;color:var(--amb);font-weight:600">
        Se pasa ${(total - Math.max(0, saldo))} g del saldo — registralo igual solo si ya lo cobraste aparte.</div>` : ''}`
    if (btn) btn.disabled = false
  }

  // ---------- Stock ----------
  async function vStock(cuerpo) {
    cuerpo.innerHTML = '<div class="vacio">⏳ Cargando…</div>'
    const d = await get('stock')
    const flor = d.items.filter((i) => i.clase === 'flor')
    const resto = d.items.filter((i) => i.clase !== 'flor')
    const totalFlor = flor.reduce((s, i) => s + (i.saldo || 0), 0)
    const puedeEntrar = P.puede('catalogo_editar')
    const filaTabla = (i) => `<tr class="${i.saldo <= 0 ? 'mo-agotado' : ''}">
      <td>${P.esc(i.nombre)}${!i.enCatalogo && i.clase === 'flor' ? ' <span class="tag tag-off">fuera de carta</span>' : ''}</td>
      <td style="color:var(--muted)">${P.esc(i.clase)}</td>
      <td style="color:var(--muted)">${P.esc(i.ultima_entrada || '—')}</td>
      <td class="r" style="font-weight:600;color:${i.saldo <= 0 ? 'var(--dan)' : i.clase === 'flor' && i.saldo < 100 ? 'var(--amb)' : 'var(--ink)'}">${i.saldo}${i.clase === 'flor' ? ' g' : ' u'}</td>
    </tr>`
    cuerpo.innerHTML = `
      <div class="fila" style="margin-bottom:10px">
        <div class="card" style="padding:10px 16px"><span class="k">Flor total</span> <b style="font-size:15px;margin-left:8px">${Math.round(totalFlor).toLocaleString('es-AR')} g</b></div>
        <span class="sp"></span>
        ${puedeEntrar ? '<button class="btn btn-pri" id="mo-entrada" type="button">+ Entrada de stock</button>' : ''}
      </div>
      <div class="grid2" style="align-items:start">
        <div class="card" style="padding-bottom:6px"><span class="k">Flores</span>
          <table class="tabla" style="margin-top:6px"><thead><tr><th>Genética</th><th>Clase</th><th>Últ. entrada</th><th class="r">Saldo</th></tr></thead>
          <tbody>${flor.map(filaTabla).join('')}</tbody></table></div>
        <div class="card" style="padding-bottom:6px"><span class="k">Aceites, cartuchos y cremas</span>
          <table class="tabla" style="margin-top:6px"><thead><tr><th>Ítem</th><th>Clase</th><th>Últ. entrada</th><th class="r">Saldo</th></tr></thead>
          <tbody>${resto.map(filaTabla).join('')}</tbody></table></div>
      </div>`
  }

  // ---------- acciones ----------
  async function onClick(e) {
    const hit = e.target.closest('.mo-hit')
    if (hit) {
      const d = await get('socio', `?id=${hit.dataset.id}`)
      if (!catalogo.length) catalogo = (await get('catalogo')).geneticas
      socioActual = d; carrito = []
      pintar(); return
    }
    if (e.target.closest('#mo-volver')) { socioActual = null; carrito = []; pintar(); return }
    if (e.target.closest('#mo-agregar')) {
      const sel = cont.querySelector('#mo-gen')
      const g = Number(cont.querySelector('#mo-g').value)
      if (!Number.isFinite(g) || g <= 0) return
      carrito.push({ item: sel.value, nombre: sel.selectedOptions[0].dataset.nombre, gramos: g, clase: 'flor' })
      pintarCarrito(); return
    }
    const quitar = e.target.closest('.mo-quitar')
    if (quitar) { carrito.splice(Number(quitar.dataset.ix), 1); pintarCarrito(); return }
    if (e.target.closest('#mo-confirmar')) {
      const msg = cont.querySelector('#mo-msg')
      msg.className = 'msg'; msg.textContent = '⏳ registrando…'
      const r = await fetch('/api/panel/mostrador/retiro', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socio_id: socioActual.socio.id, items: carrito }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) {
        socioActual.saldo = d.saldo
        const dd = await get('socio', `?id=${socioActual.socio.id}`)
        socioActual = dd; carrito = []
        pintar()
        const m2 = cont.querySelector('#mo-msg')
        if (m2) { m2.className = 'msg ok'; m2.textContent = '✔ retiro registrado — stock y saldo descontados' }
      } else {
        msg.className = 'msg err'; msg.textContent = '✗ ' + (d.error || 'error')
      }
      return
    }
    if (e.target.closest('#mo-cobrar')) {
      const s = socioActual
      const precioTexto = s.saldo.tier ? `la cuota ${s.saldo.tier}` : 'la cuota'
      const ov = P.modal(`Cobrar a ${s.socio.nombre}`, `
        <div style="display:grid;gap:10px">
          <div class="grid2">
            <div><label class="lb" for="mo-c-monto">Importe</label><input class="input" id="mo-c-monto" type="number" min="1" /></div>
            <div><label class="lb" for="mo-c-medio">Medio</label><select class="sel" id="mo-c-medio">
              <option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option>
              <option value="mp">Mercado Pago</option></select></div>
          </div>
          <div><label class="lb" for="mo-c-conc">Concepto</label>
            <input class="input" id="mo-c-conc" value="${P.esc(s.saldo.tier || 'Cuota')} ${new Date().toLocaleDateString('es-AR', { month: 'long' })}" /></div>
          <div><label class="lb" for="mo-c-gramos">Gramos que habilita</label>
            <input class="input" id="mo-c-gramos" type="number" value="${s.saldo.gramosMes || ''}" /></div>
          <div class="fila"><button class="btn btn-pri" id="mo-c-ok" type="button">Registrar cobro de ${P.esc(precioTexto)}</button>
          <span class="msg" id="mo-c-msg"></span></div>
        </div>`)
      ov.querySelector('#mo-c-ok').addEventListener('click', async () => {
        const msg = ov.querySelector('#mo-c-msg')
        msg.className = 'msg'; msg.textContent = '⏳…'
        const r = await fetch('/api/panel/mostrador/cobro', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            socio_id: s.socio.id,
            neto: Number(ov.querySelector('#mo-c-monto').value),
            medio: ov.querySelector('#mo-c-medio').value,
            concepto: ov.querySelector('#mo-c-conc').value,
            gramos: Number(ov.querySelector('#mo-c-gramos').value) || null,
            categoria: 'membresia',
          }),
        })
        const d = await r.json().catch(() => ({}))
        if (r.ok) {
          P.cerrarModal()
          const dd = await get('socio', `?id=${s.socio.id}`)
          socioActual = dd
          pintar()
        } else {
          msg.className = 'msg err'; msg.textContent = '✗ ' + (d.error || 'error')
        }
      })
      return
    }
    if (e.target.closest('#mo-entrada')) {
      if (!catalogo.length) catalogo = (await get('catalogo')).geneticas
      const ov = P.modal('Entrada de stock', `
        <div style="display:grid;gap:10px">
          <div><label class="lb" for="mo-e-item">Ítem</label>
            <select class="sel" id="mo-e-item">
              <optgroup label="Flores">${catalogo.map((g) => `<option value="${P.esc(g.id)}" data-clase="flor">${P.esc(g.nombre)}</option>`).join('')}</optgroup>
              <optgroup label="Productos">
                ${['gotero-q1', 'gotero-q2', 'gotero-q3'].map((i) => `<option value="${i}" data-clase="aceite">${i}</option>`).join('')}
                ${['cartucho-cbd-05', 'cartucho-thc-05', 'cartucho-thc-1ml'].map((i) => `<option value="${i}" data-clase="cartucho">${i}</option>`).join('')}
                <option value="bateria-510" data-clase="bateria">bateria-510</option>
                <option value="crema-30ml" data-clase="crema">crema-30ml</option>
              </optgroup>
            </select></div>
          <div class="grid2">
            <div><label class="lb" for="mo-e-cant">Cantidad (g o u)</label><input class="input" id="mo-e-cant" type="number" step="0.5" /></div>
            <div><label class="lb" for="mo-e-motivo">Motivo</label><select class="sel" id="mo-e-motivo">
              <option value="cosecha">Cosecha</option><option value="compra">Compra</option>
              <option value="ajuste">Ajuste de recuento</option><option value="merma">Merma (resta)</option></select></div>
          </div>
          <div><label class="lb" for="mo-e-ubic">Ubicación (opcional)</label><input class="input" id="mo-e-ubic" placeholder="Box 1…5, exterior, interior" /></div>
          <div class="fila"><button class="btn btn-pri" id="mo-e-ok" type="button">Registrar entrada</button><span class="msg" id="mo-e-msg"></span></div>
        </div>`)
      ov.querySelector('#mo-e-ok').addEventListener('click', async () => {
        const sel = ov.querySelector('#mo-e-item')
        const msg = ov.querySelector('#mo-e-msg')
        msg.className = 'msg'; msg.textContent = '⏳…'
        const r = await fetch('/api/panel/mostrador/stock', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item: sel.value,
            clase: sel.selectedOptions[0].dataset.clase,
            cantidad: Number(ov.querySelector('#mo-e-cant').value),
            motivo: ov.querySelector('#mo-e-motivo').value,
            ubicacion: ov.querySelector('#mo-e-ubic').value || null,
          }),
        })
        if (r.ok) { P.cerrarModal(); pintar() }
        else {
          const d = await r.json().catch(() => ({}))
          msg.className = 'msg err'; msg.textContent = '✗ ' + (d.error || 'error')
        }
      })
    }
  }

  P.registrar('mostrador', {
    init(el) { cont = el; armazon() },
  })
})()
