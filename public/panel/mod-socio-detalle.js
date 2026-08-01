/* Ficha 360° del socio (drawer lateral). No es un módulo del rail: lo abre
   la lista maestra de Socios con PanelSocioDetalle.abrir(id, onCambio).
   Reúne acá TODAS las acciones sobre una persona que antes vivían repartidas:
   contacto y DNI (ex Fichas), membresía, débito automático (ex botón $ del
   padrón), el trámite REPROCANN completo (ex modalEditar del embudo) y la
   actividad reciente. Las escrituras van a los endpoints que ya existían. */
(() => {
  'use strict'
  const P = window.Panel

  const hace = (iso) => {
    if (!iso) return 'nunca'
    const d = Math.floor((Date.now() - Date.parse(String(iso).replace(' ', 'T') + (String(iso).includes('Z') ? '' : 'Z'))) / 86400000)
    return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`
  }
  const fFecha = (f) => f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}/${String(f).slice(0, 4)}` : '—'
  const tierLindo = (t) => String(t || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())
  const TIERS = ['NINGUNA', 'SMALL', 'MEDIUM', 'LARGE', 'EXTRA LARGE']

  // Los mensajes de WhatsApp por paso del trámite — el empujón es el producto.
  function waDe(s) {
    const nom = (s.nombre || '').split(' ')[0]
    const T = {
      esperando_codigo: `Hola ${nom}! Para arrancar tu REPROCANN necesitamos tu código de vinculación. Lo sacás de tu cuenta en Mi Argentina y lo cargás acá: https://floraong.ar/socios/reprocann/`,
      revisar: `Hola ${nom}! Estamos ordenando los trámites de REPROCANN del club. ¿Nos contás cómo está el tuyo? Si te falta cargarlo, es acá: https://floraong.ar/socios/reprocann/`,
      sin_iniciar: `Hola ${nom}! ¿Arrancamos tu REPROCANN? El primer paso es tu código de vinculación: https://floraong.ar/socios/reprocann/`,
      cargado: `Hola ${nom}! Tu trámite de REPROCANN ya está cargado. Falta un paso tuyo: entrá a reprocann.msal.gob.ar con tu Mi Argentina y aceptá el consentimiento. Con eso seguimos nosotros.`,
      observado: `Hola ${nom}! Tu trámite de REPROCANN tiene una observación. Entrá a reprocann.msal.gob.ar y fijate qué dice, así lo resolvemos.`,
      aprobado: `Hola ${nom}! Tu REPROCANN está aprobado 🌿`,
      vencido: `Hola ${nom}! Tu certificado de REPROCANN venció. Escribinos y arrancamos la renovación.`,
    }
    const txt = T[s.reprocann_estado] || `Hola ${nom}! Te escribo por tu trámite de REPROCANN.`
    return `https://wa.me/${String(s.telefono || '').replace(/\D/g, '')}?text=${encodeURIComponent(txt)}`
  }

  let velo = null
  let caja = null
  let alCambiar = null

  function cerrar() {
    velo?.remove(); caja?.remove()
    velo = caja = null
    document.removeEventListener('keydown', porEscape)
  }
  function porEscape(e) { if (e.key === 'Escape') cerrar() }

  async function abrir(id, onCambio) {
    alCambiar = onCambio || null
    cerrar()
    velo = document.createElement('div'); velo.className = 'pn-drawer-velo'
    caja = document.createElement('aside'); caja.className = 'pn-drawer'
    caja.innerHTML = '<div class="pn-drawer-cuerpo"><div class="vacio">⏳ Abriendo la ficha…</div></div>'
    document.body.append(velo, caja)
    velo.addEventListener('click', cerrar)
    document.addEventListener('keydown', porEscape)
    const r = await fetch(`/api/panel/socio?id=${id}`, { credentials: 'include' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { caja.querySelector('.pn-drawer-cuerpo').innerHTML = `<div class="vacio">${P.esc(d.error || 'Error ' + r.status)}</div>`; return }
    pintar(d)
  }

  function pintar(d) {
    const s = d.socio
    const editar = P.puede('padron_editar')
    const plata = P.puede('finanzas_aprobar')
    const pasos = (window.PanelPasosReprocann || [])
    const paso = pasos.find((p) => p.id === s.reprocann_estado)
    const actualIdx = pasos.findIndex((p) => p.id === s.reprocann_estado)

    const chipDebito = d.debito?.estado === 'activa' ? '<span class="tag tag-ok">débito al día</span>'
      : d.debito?.estado === 'pendiente' ? '<span class="tag tag-deb">débito esperando</span>'
      : d.debito?.estado === 'pausada' ? '<span class="tag tag-mal">débito pausado</span>'
      : s.debito_no_insistir ? '<span class="tag tag-auto">no insistir</span>'
      : d.membresia ? '<span class="tag tag-off">sin débito</span>' : ''
    const chipCarta = d.carta.acceso
      ? (d.carta.lastLogin ? `<span class="tag tag-ok">carta ${hace(d.carta.lastLogin)}</span>` : '<span class="tag tag-off">sin ingresar</span>')
      : '<span class="tag tag-deb">sin acceso a la carta</span>'

    caja.innerHTML = `
      <button class="pn-drawer-x" type="button" aria-label="Cerrar">✕</button>
      <div class="pn-drawer-cab">
        <div class="fila"><span class="av">${P.esc(P.iniciales(s.nombre))}</span>
          <div><div style="font-family:var(--font-display);font-size:19px">${P.esc(s.nombre)}</div>
          <div style="color:var(--muted);font-size:11.5px">${s.numero ? '#' + s.numero + ' · ' : ''}${P.esc(s.email || 'sin email')}</div></div></div>
        <div class="fila" style="margin-top:9px;flex-wrap:wrap;gap:5px">
          ${d.membresia ? `<span class="tag ${d.membresia.modalidad === 'plan' ? 'tag-auto' : 'tag-ok'}">${P.esc(d.membresia.tier)}${d.membresia.modalidad === 'debito' ? ' · débito' : d.membresia.modalidad === 'plan' ? ' · plan' : ''}</span>` : '<span class="tag tag-off">sin membresía</span>'}
          ${chipDebito}
          ${paso ? `<span class="tag ${paso.quien === 'club' ? 'tag-mal' : paso.quien === 'paciente' ? 'tag-deb' : paso.quien === 'medico' ? 'tag-auto' : s.reprocann_estado === 'aprobado' || s.reprocann_estado === 'autocultivo' ? 'tag-ok' : 'tag-off'}" title="${P.esc(paso.ayuda)}">${P.esc(paso.nombre)}</span>` : ''}
          ${chipCarta}
          ${s.estado === 'inactivo' ? '<span class="tag tag-off">inactivo</span>' : ''}
        </div>
      </div>
      <div class="pn-drawer-cuerpo">

        <details open><summary>Contacto</summary>
          <div class="campo"><label class="lb">Email de Google</label>
            <input class="input sd-campo" data-campo="email" value="${P.esc(s.email || '')}" ${editar ? '' : 'disabled'} /></div>
          <div class="grid2" style="gap:10px">
            <div class="campo"><label class="lb">Teléfono</label>
              <input class="input sd-campo" data-campo="telefono" value="${P.esc(s.telefono || '')}" ${editar ? '' : 'disabled'} /></div>
            <div class="campo"><label class="lb">DNI</label>
              <input class="input sd-campo" data-campo="documento" inputmode="numeric" maxlength="10" value="${P.esc(s.documento || '')}" ${editar ? '' : 'disabled'} /></div>
          </div>
          <div class="campo"><label class="lb">Nota</label>
            <input class="input sd-campo" data-campo="nota" value="${P.esc(s.nota || '')}" ${editar ? '' : 'disabled'} /></div>
          ${editar ? '<div class="fila" style="margin-top:10px"><span class="pn-sp"></span><button class="btn" id="sd-guardar-contacto" type="button">Guardar contacto</button></div>' : ''}
          <p class="msg" id="sd-msg-contacto" style="margin:6px 0 0"></p>
        </details>

        <details open><summary>Membresía</summary>
          <div class="fila" style="margin-top:10px;flex-wrap:wrap">
            ${d.membresia && d.membresia.modalidad === 'plan'
              ? `<span class="tag tag-auto">${P.esc(d.membresia.tier)} · plan prepago</span>`
              : editar ? `<select class="sel" id="sd-tier">${TIERS.map((t) =>
                  `<option value="${t}" ${(d.membresia?.tier || 'NINGUNA') === t ? 'selected' : ''}>${t === 'NINGUNA' ? '— sin membresía' : t}</option>`).join('')}</select>`
              : `<b>${P.esc(d.membresia?.tier || '— sin membresía')}</b>`}
            ${d.membresia?.gramos_mes ? `<span style="color:var(--muted);font-size:12px">${d.membresia.gramos_mes} g por mes · desde ${fFecha(d.membresia.desde)}</span>` : ''}
          </div>
          <p class="msg" id="sd-msg-memb" style="margin:6px 0 0"></p>
        </details>

        <details open><summary>Débito automático</summary>
          <div style="margin-top:10px;font-size:13px;color:var(--ink2)">
            ${d.debito?.estado ? `${chipDebito} ${d.debito.monto ? `<b>${P.fmt(d.debito.monto)}</b>/mes` : ''}
              ${d.debito.estado === 'activa' ? ` · cuota ${d.debito.racha_meses % 3 === 0 && d.debito.racha_meses > 0 ? 3 : d.debito.racha_meses % 3}/3` : ''}
              ${d.debito.fin ? ` · termina ${fFecha(d.debito.fin)}` : ''}` : 'Sin suscripción todavía.'}
            ${d.debito?.ultimo_envio ? `<div style="color:var(--muted);font-size:11.5px;margin-top:4px">link ${P.esc(d.debito.ultimo_envio.tier)} mandado ${hace(d.debito.ultimo_envio.enviado)} por ${d.debito.ultimo_envio.via === 'email' ? 'email' : 'WhatsApp'}</div>` : ''}
          </div>
          ${plata ? `<div class="fila" style="margin-top:10px;flex-wrap:wrap">
            <button class="btn btn-pri" id="sd-debito" type="button">$ Mandar link de pago</button>
            <button class="btn" id="sd-no-insistir" type="button">${s.debito_no_insistir ? 'Volver a ofrecer' : 'No insistir'}</button>
          </div>` : ''}
        </details>

        <details ${paso && (paso.quien === 'club' || paso.quien === 'paciente' || paso.quien === 'medico') ? 'open' : ''}><summary>REPROCANN</summary>
          <div class="so-timeline">${pasos.filter((p) => !['revisar', 'rechazado', 'vencido', 'autocultivo'].includes(p.id) || p.id === s.reprocann_estado).map((p, i) =>
            `<div class="so-tl-paso ${p.id === s.reprocann_estado ? 'actual' : (actualIdx >= 0 && i < actualIdx ? 'hecho' : '')}" title="${P.esc(p.ayuda)}">${P.esc(p.nombre)}</div>`).join('')}
          </div>
          ${editar || P.puede('mostrador_operar') ? `
          <div class="grid2" style="gap:10px;margin-top:8px">
            <div class="campo"><label class="lb">Paso</label>
              <select class="sel" id="sd-rc-paso">${pasos.map((p) => `<option value="${p.id}" ${s.reprocann_estado === p.id ? 'selected' : ''}>${P.esc(p.nombre)}</option>`).join('')}</select></div>
            <div class="campo"><label class="lb">Código de vinculación</label>
              <input class="input" id="sd-rc-cod" maxlength="13" value="${P.esc(s.reprocann_codigo || '')}" style="letter-spacing:.06em" /></div>
          </div>
          <div class="grid2" style="gap:10px">
            <div class="campo"><label class="lb">Nº de trámite</label>
              <input class="input" id="sd-rc-tram" type="number" value="${P.esc(s.reprocann_tramite || '')}" /></div>
            <div class="campo"><label class="lb">Vence</label>
              <input class="input" id="sd-rc-vence" type="date" value="${P.esc(String(s.reprocann_vence || '').slice(0, 10))}" /></div>
          </div>
          <div class="campo"><label class="lb">Nota del trámite</label>
            <input class="input" id="sd-rc-nota" value="${P.esc(s.reprocann_nota || '')}" /></div>
          <div class="fila" style="margin-top:10px">
            ${s.telefono ? `<a class="btn" target="_blank" rel="noopener" href="${P.esc(waDe(s))}">WhatsApp del paso</a>` : ''}
            <span class="pn-sp"></span>
            <button class="btn" id="sd-rc-guardar" type="button">Guardar trámite</button></div>
          <p class="msg" id="sd-msg-rc" style="margin:6px 0 0"></p>`
          : (s.telefono ? `<div class="fila" style="margin-top:8px"><a class="btn" target="_blank" rel="noopener" href="${P.esc(waDe(s))}">WhatsApp del paso</a></div>` : '')}
        </details>

        <details><summary>Actividad reciente</summary>
          <div style="margin-top:8px;font-size:12.5px;color:var(--ink2)">
            <b style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Retiros</b>
            ${d.dispensas.length ? d.dispensas.map((x) => `<div class="fila" style="padding:3px 0">
              <span>${fFecha(x.fecha)} · ${P.esc(x.producto || 'flores')}</span><span class="pn-sp"></span>
              <span>${x.gramos ? x.gramos + ' g' : (x.unidades || '') + ' u'}</span></div>`).join('') : '<div style="color:var(--muted)">Sin retiros.</div>'}
            ${d.movimientos ? `<b style="display:block;margin-top:8px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Pagos</b>
            ${d.movimientos.length ? d.movimientos.map((x) => `<div class="fila" style="padding:3px 0">
              <span>${fFecha(x.fecha)} · ${P.esc(x.concepto || x.categoria)}</span><span class="pn-sp"></span>
              <span style="font-weight:600">${P.fmt(x.neto)}</span></div>`).join('') : '<div style="color:var(--muted)">Sin pagos.</div>'}` : ''}
          </div>
        </details>

        ${editar ? `<details><summary>Zona peligrosa</summary>
          <div class="fila" style="margin-top:10px;flex-wrap:wrap">
            <button class="btn" id="sd-estado" type="button">${s.estado === 'activo' ? 'Marcar inactivo' : 'Reactivar socio'}</button>
            ${d.carta.acceso ? '<button class="btn btn-peligro" id="sd-quitar-carta" type="button">Quitar acceso a la carta</button>' : ''}
          </div>
          <p class="msg" id="sd-msg-zona" style="margin:6px 0 0"></p>
        </details>` : ''}
      </div>`

    caja.querySelector('.pn-drawer-x').addEventListener('click', cerrar)

    const msgDe = (sel) => caja.querySelector(sel)
    const aviso = (sel, texto, clase) => { const m = msgDe(sel); m.className = 'msg ' + (clase || ''); m.textContent = texto }

    // contacto → PATCH padron/socio (D1) + eco best-effort al KV (tel/nota)
    caja.querySelector('#sd-guardar-contacto')?.addEventListener('click', async () => {
      const body = { id: s.id }
      caja.querySelectorAll('.sd-campo').forEach((i) => { body[i.dataset.campo] = i.value.trim() })
      aviso('#sd-msg-contacto', '⏳ guardando…')
      const r = await fetch('/api/panel/padron/socio', {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const res = await r.json().catch(() => ({}))
      if (!r.ok) { aviso('#sd-msg-contacto', '✗ ' + (res.error || 'error'), 'err'); return }
      if (s.email) {
        fetch('/api/socios/admin/socios', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: body.email || s.email, telefono: body.telefono, nota: body.nota }),
        }).catch(() => { /* el KV es espejo, nunca bloquea */ })
      }
      aviso('#sd-msg-contacto', '✔ guardado', 'ok')
      alCambiar?.()
    })

    // membresía
    caja.querySelector('#sd-tier')?.addEventListener('change', async (e) => {
      aviso('#sd-msg-memb', '⏳ cambiando membresía…')
      const r = await fetch('/api/panel/padron/membresia', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socio_id: s.id, tier: e.target.value }),
      })
      aviso('#sd-msg-memb', r.ok ? '✔ membresía actualizada' : '✗ no se pudo', r.ok ? 'ok' : 'err')
      if (r.ok) { alCambiar?.(); abrir(s.id, alCambiar) }
    })

    // débito: el mismo modal de link de pago con selector de plan
    caja.querySelector('#sd-debito')?.addEventListener('click', () => modalDebito(s))
    caja.querySelector('#sd-no-insistir')?.addEventListener('click', async (e) => {
      e.target.disabled = true
      await fetch('/api/panel/mp/no-insistir', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socio_id: s.id, valor: s.debito_no_insistir ? 0 : 1 }),
      })
      alCambiar?.(); abrir(s.id, alCambiar)
    })

    // trámite REPROCANN
    caja.querySelector('#sd-rc-guardar')?.addEventListener('click', async () => {
      aviso('#sd-msg-rc', '⏳ guardando…')
      const r = await fetch('/api/panel/reprocann/socio', {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: s.id,
          estado: caja.querySelector('#sd-rc-paso').value,
          codigo: caja.querySelector('#sd-rc-cod').value.trim(),
          tramite: caja.querySelector('#sd-rc-tram').value || null,
          vence: caja.querySelector('#sd-rc-vence').value || null,
          nota: caja.querySelector('#sd-rc-nota').value.trim(),
        }),
      })
      const res = await r.json().catch(() => ({}))
      if (!r.ok) { aviso('#sd-msg-rc', '✗ ' + (res.error || 'error'), 'err'); return }
      aviso('#sd-msg-rc', '✔ guardado', 'ok')
      alCambiar?.(); abrir(s.id, alCambiar)
    })

    // zona peligrosa
    caja.querySelector('#sd-estado')?.addEventListener('click', async () => {
      const nuevo = s.estado === 'activo' ? 'inactivo' : 'activo'
      if (!(await P.confirmar(`¿Marcar a ${s.nombre} como ${nuevo}?`, 'Sí'))) return
      await fetch('/api/panel/padron/socio', {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, estado: nuevo }),
      })
      alCambiar?.(); abrir(s.id, alCambiar)
    })
    caja.querySelector('#sd-quitar-carta')?.addEventListener('click', async () => {
      if (!(await P.confirmar(`¿Quitarle el acceso a la carta a ${s.email}? Deja de poder entrar.`, 'Sí, quitar'))) return
      const r = await fetch('/api/socios/admin/socios', {
        method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: s.email }),
      })
      aviso('#sd-msg-zona', r.ok ? '✔ acceso quitado' : '✗ no se pudo', r.ok ? 'ok' : 'err')
      if (r.ok) { alCambiar?.(); abrir(s.id, alCambiar) }
    })
  }

  // El modal del link de pago (planes precargados de MP, selector de tier).
  // Vivía en el padrón como soDebito — ahora es parte de la ficha.
  async function modalDebito(s) {
    const ov = P.modal(`Link de pago — ${s.nombre}`, '<div class="vacio">⏳ Buscando su membresía…</div>')
    const cuerpo = ov.querySelector('.pn-mod-cuerpo')
    const r = await fetch(`/api/panel/mp/link?socio_id=${s.id}`, { credentials: 'include' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { cuerpo.innerHTML = `<p style="color:var(--dan);margin:0">${P.esc(d.error || 'Error ' + r.status)}</p>`; return }
    if (d.reprocann_ok === false) {
      cuerpo.innerHTML = `<p style="color:var(--ink2);margin:0">El REPROCANN de <b>${P.esc(d.nombre)}</b> está
        <span class="tag tag-deb">${P.esc(d.reprocann_paso || 'sin dato')}</span> — el débito con descuento se ofrece recién
        cuando el trámite está subido (aprobado o en evaluación).</p>
        <div class="pn-mod-acciones"><button class="btn btn-pri" onclick="Panel.cerrarModal()" type="button">Entendido</button></div>`
      return
    }
    if (d.debito_estado === 'activa') {
      cuerpo.innerHTML = `<p style="color:var(--ink2);margin:0"><b>${P.esc(d.nombre)}</b> ya tiene el débito automático
        <span class="tag tag-ok">al día</span>. No hace falta mandarle nada.</p>
        <div class="pn-mod-acciones"><button class="btn btn-pri" onclick="Panel.cerrarModal()" type="button">Perfecto</button></div>`
      return
    }
    if (!d.planes || !d.planes.length) {
      cuerpo.innerHTML = `<p style="color:var(--dan);margin:0">No hay planes de Mercado Pago cargados.</p>
        <div class="pn-mod-acciones"><button class="btn" onclick="Panel.cerrarModal()" type="button">Cerrar</button></div>`
      return
    }
    let elegido = d.planes.find((p) => p.tier === d.tier) || d.planes[0]
    const tel = (d.telefono || s.telefono || '').replace(/\D/g, '')
    cuerpo.innerHTML = `
      <p class="so-help" style="margin:0 0 8px">${d.tier ? `Su membresía actual es <b>${P.esc(d.tier)}</b> — podés mandarle otro plan igual: al pagar, su membresía se actualiza sola.` : `<b>${P.esc(d.nombre)}</b> no tiene membresía asignada — elegí qué plan mandarle; al pagar queda con esa membresía.`}</p>
      <div class="fila" id="sd-mp-tiers" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">
        ${d.planes.map((p) => `<button class="chip sd-mp-tier" data-tier="${P.esc(p.tier)}" type="button">
          <b>${P.esc(p.tier)}</b> · ${p.gramos ? p.gramos + ' g · ' : ''}${P.fmt(p.monto)}</button>`).join('')}
      </div>
      <p style="color:var(--ink2);margin:0 0 10px" id="sd-mp-desc"></p>
      <input class="input" id="sd-mp-link" readonly onclick="this.select()" />
      <div class="pn-mod-acciones">
        <button class="btn" id="sd-mp-copiar" type="button">Copiar</button>
        ${d.socio_id && s.email ? '<button class="btn" id="sd-mp-mail" type="button">Mandar por email</button>' : ''}
        ${tel ? '<a class="btn btn-pri" id="sd-mp-wa" href="#" target="_blank" rel="noopener">Mandar por WhatsApp</a>' : ''}
      </div>
      <p class="msg" id="sd-mp-msg" style="margin:8px 0 0"></p>`
    const msg = cuerpo.querySelector('#sd-mp-msg')
    const pintarPlan = () => {
      cuerpo.querySelectorAll('.sd-mp-tier').forEach((b) => b.classList.toggle('on', b.dataset.tier === elegido.tier))
      cuerpo.querySelector('#sd-mp-desc').innerHTML = `${elegido.contado ? `<span style="color:var(--muted);text-decoration:line-through">${P.fmt(elegido.contado)}</span> → ` : ''}<b>${P.fmt(elegido.monto)} por mes</b> con débito automático — 20% off, 3 cuotas y corta solo.`
      cuerpo.querySelector('#sd-mp-link').value = elegido.link
      const wa = cuerpo.querySelector('#sd-mp-wa')
      const tierL = tierLindo(elegido.tier)
      if (wa) wa.href = `https://wa.me/${tel}?text=${encodeURIComponent(
        `Hola ${String(d.nombre).split(' ')[0]}! Tu plan ${tierL}${elegido.gramos ? ` de ${elegido.gramos} gramos por mes` : ''}${elegido.contado ? ` que vale ${P.fmt(elegido.contado)}` : ''} tiene un 20% de descuento adhiriéndote al débito automático por 3 meses, te queda en ${P.fmt(elegido.monto)}. Se autoriza una vez desde MercadoPago, podés usar el medio de pago que prefieras (crédito/débito/saldo) y podés cancelarlo si te arrepentís. Suscribite acá: ${elegido.link}`)}`
    }
    pintarPlan()
    cuerpo.querySelectorAll('.sd-mp-tier').forEach((b) => b.addEventListener('click', () => {
      elegido = d.planes.find((p) => p.tier === b.dataset.tier)
      pintarPlan()
    }))
    const registrar = (via) => fetch('/api/panel/mp/enviar', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socio_id: d.socio_id, via, tier: elegido.tier }),
    })
    cuerpo.querySelector('#sd-mp-copiar').addEventListener('click', () => {
      navigator.clipboard.writeText(elegido.link)
      registrar('whatsapp')
      msg.className = 'msg ok'; msg.textContent = '✔ link copiado (queda registrado el envío)'
    })
    cuerpo.querySelector('#sd-mp-wa')?.addEventListener('click', () => { registrar('whatsapp') })
    cuerpo.querySelector('#sd-mp-mail')?.addEventListener('click', async (e) => {
      e.target.disabled = true
      msg.className = 'msg'; msg.textContent = '⏳ mandando el mail…'
      const rm = await registrar('email')
      const dm = await rm.json().catch(() => ({}))
      if (rm.ok) { msg.className = 'msg ok'; msg.textContent = '✔ mail enviado' }
      else { msg.className = 'msg err'; msg.textContent = '✗ ' + (dm.error || 'no salió'); e.target.disabled = false }
    })
  }

  window.PanelSocioDetalle = { abrir, cerrar }
})()
