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
  const fFecha = (f) => (window.Panel && window.Panel.fecha) ? window.Panel.fecha(f)
    : (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}/${String(f).slice(0, 4)}` : '—')
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

  // El mensaje con el que le mandamos la declaración para firmar. El archivo
  // se adjunta a mano: wa.me solo lleva texto.
  function waDdjj(s) {
    const nom = (s.nombre || '').split(' ')[0]
    const txt = `Hola ${nom}! Te paso la declaración jurada para que puedas pasarte a Flora. `
      + `Es el papel que pide el registro cuando alguien deja el autocultivo y se vincula a una asociación: `
      + `no se pueden tener las dos modalidades a la vez.\n\n`
      + `Lo que tenés que hacer es imprimirla, firmarla y mandarnos una foto. Con eso seguimos nosotros el trámite.\n\n`
      + `Cualquier duda antes de firmar, escribime.`
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
    const mp = P.puede('mp_enviar')
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
          <div style="color:var(--muted);font-size:12px">${s.numero ? '#' + s.numero + ' · ' : ''}${P.esc(s.email || 'sin email')}</div></div></div>
        <div class="fila" style="margin-top:6px;flex-wrap:wrap;gap:4px">
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
          <div class="campo"><label class="lb">Domicilio</label>
            <input class="input sd-campo" data-campo="domicilio" placeholder="Calle y número" value="${P.esc(s.domicilio || '')}" ${editar ? '' : 'disabled'} /></div>
          <div class="grid2" style="gap:10px">
            <div class="campo"><label class="lb">Localidad</label>
              <input class="input sd-campo" data-campo="localidad" value="${P.esc(s.localidad || '')}" ${editar ? '' : 'disabled'} /></div>
            <div class="campo"><label class="lb">Provincia</label>
              <input class="input sd-campo" data-campo="provincia" value="${P.esc(s.provincia || '')}" ${editar ? '' : 'disabled'} /></div>
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
          ${d.saldo && d.membresia ? (() => {
            const sal = d.saldo
            if (sal.tipo === 'plan') {
              const pct = sal.total ? Math.max(0, Math.min(100, (sal.retirado / sal.total) * 100)) : 0
              return `<div style="margin-top:10px;font-size:13px;color:var(--ink2)">
                Plan prepago: retiró <b>${sal.retirado} g</b> de ${sal.total} — le quedan <b>${sal.saldo} g</b> hasta ${fFecha(sal.hasta)}
                <div style="height:6px;border-radius:4px;background:var(--line);margin-top:4px"><div style="height:6px;border-radius:4px;background:var(--vio);width:${pct.toFixed(0)}%"></div></div></div>`
            }
            if (sal.tipo === 'debito') {
              const guardado = sal.acumulado > sal.saldo ? ` · tiene <b>${sal.acumulado} g</b> acumulados` : ''
              return `<div style="margin-top:10px;font-size:13px;color:var(--ink2)">
                Débito automático: puede retirar hoy <b style="color:var(--grn)">${sal.saldo} g</b> (tope ${sal.tope} g por visita)${guardado}
                <br />Este mes retiró <b>${sal.retiradoMes} g</b>.</div>`
            }
            const deuda = !sal.pagoEsteMes
            return `<div style="margin-top:10px;font-size:13px;color:var(--ink2)">
              Este mes: retiró <b>${sal.retiradoMes} g</b>${sal.habilitado ? ` de ${sal.habilitado} habilitados — saldo <b style="color:${sal.saldo < 0 ? 'var(--dan)' : 'var(--grn)'}">${sal.saldo} g</b>` : ''}
              ${deuda ? ' <span class="tag tag-deb">sin pago este mes</span>' : ''}</div>`
          })() : ''}
          ${editar ? `<div class="fila" style="margin-top:10px">
            ${d.membresia && d.membresia.modalidad === 'plan'
              ? '<button class="btn btn-peligro" id="sd-plan-cancelar" type="button">Cancelar el plan prepago</button>'
              : '<button class="btn" id="sd-plan-vender" type="button">Venderle un plan prepago</button>'}
          </div>` : ''}
          <p class="msg" id="sd-msg-memb" style="margin:6px 0 0"></p>
        </details>

        <details open><summary>Débito automático</summary>
          <div style="margin-top:10px;font-size:13px;color:var(--ink2)">
            ${d.debito?.estado ? `${chipDebito} ${d.debito.monto ? `<b>${P.fmt(d.debito.monto)}</b>/mes` : ''}
              ${d.debito.estado === 'activa' ? ` · cuota ${d.debito.racha_meses % 3 === 0 && d.debito.racha_meses > 0 ? 3 : d.debito.racha_meses % 3}/3` : ''}
              ${d.debito.fin ? ` · termina ${fFecha(d.debito.fin)}` : ''}` : 'Sin suscripción todavía.'}
            ${d.debito?.ultimo_envio ? `<div style="color:var(--muted);font-size:12px;margin-top:4px">link ${P.esc(d.debito.ultimo_envio.tier)} mandado ${hace(d.debito.ultimo_envio.enviado)} por ${d.debito.ultimo_envio.via === 'email' ? 'email' : 'WhatsApp'}</div>` : ''}
          </div>
          ${mp ? `<div class="fila" style="margin-top:10px;flex-wrap:wrap">
            <button class="btn btn-pri" id="sd-debito" type="button">$ Mandar link de pago</button>
            <button class="btn" id="sd-no-insistir" type="button">${s.debito_no_insistir ? 'Volver a ofrecer' : 'No insistir'}</button>
          </div>` : ''}
        </details>

        <details ${paso && (paso.quien === 'club' || paso.quien === 'paciente' || paso.quien === 'medico') ? 'open' : ''}><summary>REPROCANN</summary>
          <div class="so-timeline">${pasos.filter((p) => !['revisar', 'rechazado', 'vencido', 'autocultivo', 'ddjj_pendiente', 'ddjj_firmada'].includes(p.id) || p.id === s.reprocann_estado).map((p, i) =>
            `<div class="so-tl-paso ${p.id === s.reprocann_estado ? 'actual' : (actualIdx >= 0 && i < actualIdx ? 'hecho' : '')}" title="${P.esc(p.ayuda)}">${P.esc(p.nombre)}</div>`).join('')}
          </div>
          ${P.puede('reprocann_editar') ? `
          <div class="grid2" style="gap:10px;margin-top:6px">
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
          : (s.telefono ? `<div class="fila" style="margin-top:6px"><a class="btn" target="_blank" rel="noopener" href="${P.esc(waDe(s))}">WhatsApp del paso</a></div>` : '')}
          ${s.email ? `<div class="fila" id="sd-adj-fila" style="margin-top:10px;flex-wrap:wrap" hidden>
            <span style="font-size:12px;color:var(--muted)">Lo que subió al inscribirse:</span>
            <a class="btn" href="/api/socios/admin/solicitud-adjunto?email=${encodeURIComponent(s.email)}" target="_blank" rel="noopener">Ver adjunto</a>
          </div>` : ''}
          <div class="fila" id="sd-cert-fila" style="margin-top:10px;flex-wrap:wrap">
            <span style="font-size:12px;color:var(--muted)">Certificado PDF:</span>
            <span id="sd-cert-estado" style="font-size:12px;color:var(--muted)">…</span>
            <span class="pn-sp"></span>
            <a class="btn" id="sd-cert-ver" target="_blank" rel="noopener" hidden>Ver</a>
            ${P.puede('reprocann_editar') ? `
              <button class="btn" id="sd-cert-subir" type="button">Subir</button>
              <button class="btn btn-peligro" id="sd-cert-borrar" type="button" hidden>Quitar</button>
              <input type="file" id="sd-cert-file" accept="application/pdf" hidden />` : ''}
          </div>
        </details>

        ${P.puede('reprocann_editar') ? `
        <details ${['autocultivo', 'ddjj_pendiente', 'ddjj_firmada'].includes(s.reprocann_estado) ? 'open' : ''}><summary>Declaración jurada</summary>
          <p class="so-help" style="margin:8px 0 0">Para vincularse a Flora tiene que renunciar al autocultivo: las modalidades
            son excluyentes. Esto genera el papel con sus datos ya puestos, listo para imprimir y firmar.</p>
          <div id="sd-ddjj" style="margin-top:10px"><div style="color:var(--muted);font-size:12px">⏳ buscando…</div></div>
        </details>` : ''}

        <details><summary>Actividad reciente</summary>
          <div style="margin-top:6px;font-size:13px;color:var(--ink2)">
            <b style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Retiros</b>
            ${d.dispensas.length ? d.dispensas.map((x) => `<div class="fila" style="padding:3px 0">
              <span>${fFecha(x.fecha)} · ${P.esc(x.producto || 'flores')}</span><span class="pn-sp"></span>
              <span>${x.gramos ? x.gramos + ' g' : (x.unidades || '') + ' u'}</span></div>`).join('') : '<div style="color:var(--muted)">Sin retiros.</div>'}
            ${d.movimientos ? `<b style="display:block;margin-top:6px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Pagos</b>
            ${d.movimientos.length ? d.movimientos.map((x) => `<div class="fila" style="padding:3px 0">
              <span>${fFecha(x.fecha)} · ${P.esc(x.concepto || x.categoria)}</span><span class="pn-sp"></span>
              <span style="font-weight:600">${P.fmt(x.neto)}</span></div>`).join('') : '<div style="color:var(--muted)">Sin pagos.</div>'}` : ''}
          </div>
        </details>

        ${editar ? `<details><summary>Zona peligrosa</summary>
          <div class="fila" style="margin-top:10px;flex-wrap:wrap">
            <button class="btn" id="sd-estado" type="button">${s.estado === 'activo' ? 'Marcar inactivo' : 'Reactivar socio'}</button>
            ${P.puede('papelera_gestionar') ? `<button class="btn ${s.papelera ? '' : 'btn-peligro'}" id="sd-papelera" type="button">${s.papelera ? 'Restaurar de la papelera' : '🗑 Mandar a la papelera'}</button>` : ''}
            ${d.carta.acceso && P.puede('carta_gestionar') ? '<button class="btn btn-peligro" id="sd-quitar-carta" type="button">Quitar acceso a la carta</button>' : ''}
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
    // certificado REPROCANN: estado + subir/ver/quitar (KV CERTIFICADOS)
    ;(async () => {
      const est = caja.querySelector('#sd-cert-estado')
      if (!est) return
      try {
        const r = await fetch(`/api/panel/certificado?socio_id=${s.id}`, { credentials: 'include' })
        const d = r.ok ? await r.json() : { existe: false }
        est.textContent = d.existe ? `cargado ${fFecha(d.meta?.subido)}` : 'sin cargar'
        const ver = caja.querySelector('#sd-cert-ver')
        if (ver) { ver.hidden = !d.existe; ver.href = `/api/panel/certificado?socio_id=${s.id}&descargar=1` }
        const borrar = caja.querySelector('#sd-cert-borrar')
        if (borrar) borrar.hidden = !d.existe
      } catch { est.textContent = '—' }
    })()
    // el adjunto de la inscripción: solo se muestra si de verdad hay archivo
    ;(async () => {
      const fila = caja.querySelector('#sd-adj-fila')
      if (!fila || !s.email) return
      try {
        const r = await fetch(`/api/socios/admin/solicitud-adjunto?email=${encodeURIComponent(s.email)}`, {
          method: 'HEAD', credentials: 'include',
        })
        fila.hidden = !r.ok
      } catch { fila.hidden = true }
    })()

    caja.querySelector('#sd-cert-subir')?.addEventListener('click', () => caja.querySelector('#sd-cert-file').click())
    caja.querySelector('#sd-cert-file')?.addEventListener('change', async (e) => {
      const f = e.target.files[0]
      if (!f) return
      const est = caja.querySelector('#sd-cert-estado')
      est.textContent = 'subiendo…'
      const b64 = await new Promise((res, rej) => {
        const fr = new FileReader()
        fr.onload = () => res(String(fr.result).split(',')[1])
        fr.onerror = rej
        fr.readAsDataURL(f)
      })
      const r = await fetch('/api/panel/certificado', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socio_id: s.id, pdf_base64: b64 }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) { abrir(s.id, alCambiar) } else { est.textContent = '✗ ' + (d.error || 'error ' + r.status) }
    })
    caja.querySelector('#sd-cert-borrar')?.addEventListener('click', async () => {
      if (!(await P.confirmar('¿Quitar el certificado PDF de este socio?', 'Sí, quitar'))) return
      await fetch('/api/panel/certificado', {
        method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socio_id: s.id }),
      })
      abrir(s.id, alCambiar)
    })

    // declaración jurada de vinculación (autocultivo → paciente de Flora)
    pintarDdjj(s)

    caja.querySelector('#sd-plan-vender')?.addEventListener('click', () => modalPlan(s))
    caja.querySelector('#sd-plan-cancelar')?.addEventListener('click', async () => {
      if (!(await P.confirmar(
        `¿Cancelar el plan prepago de ${s.nombre}?\n\nSe corta hoy. Los retiros que ya hizo quedan como están.`,
        'Sí, cancelar'))) return
      const r = await fetch('/api/panel/plan-socio', {
        method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membresia_id: d.membresia?.id }),
      })
      if (!r.ok) { aviso('#sd-msg-memb', '✗ no se pudo cancelar', 'err'); return }
      alCambiar?.(); abrir(s.id, alCambiar)
    })
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
    caja.querySelector('#sd-papelera')?.addEventListener('click', async () => {
      const mandar = !s.papelera
      if (mandar && !(await P.confirmar(`¿Mandar a ${s.nombre} a la papelera? Desaparece de todas las vistas del panel, pero se puede restaurar cuando quieras.`, 'Sí, a la papelera'))) return
      await fetch('/api/panel/padron/papelera', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [s.id], accion: mandar ? 'mandar' : 'restaurar' }),
      })
      alCambiar?.()
      if (mandar) cerrar()
      else abrir(s.id, alCambiar)
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

  // Declaración jurada: el papel con el que un autocultivador se pasa a Flora.
  // Dos momentos, uno abajo del otro: generar el documento (se abre en una
  // pestaña para imprimir) y después subir el que volvió firmado.
  async function pintarDdjj(s) {
    const zona = caja.querySelector('#sd-ddjj')
    if (!zona) return
    let d
    try {
      const r = await fetch(`/api/panel/declaracion?socio_id=${s.id}`, { credentials: 'include' })
      d = await r.json()
      if (!r.ok) throw new Error(d.error || 'error ' + r.status)
    } catch (e) {
      zona.innerHTML = `<div class="msg err">✗ ${P.esc(e.message)}</div>`
      return
    }
    const dec = d.declaracion && d.declaracion.estado !== 'anulada' ? d.declaracion : null
    const faltaDni = !d.socio.documento
    const dom = [d.socio.domicilio, d.socio.localidad, d.socio.provincia].filter(Boolean).join(', ')

    zona.innerHTML = `
      ${dec ? `<div class="fila" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">
        <span class="tag ${dec.estado === 'firmada' ? 'tag-ok' : 'tag-deb'}">${dec.estado === 'firmada' ? 'firmada' : 'esperando la firma'}</span>
        <span style="font-size:12px;color:var(--muted)">generada ${fFecha(dec.generada)}${dec.generada_por ? ' por ' + P.esc(dec.generada_por) : ''}${dec.firmada ? ' · firmada ' + fFecha(dec.firmada) : ''}</span>
      </div>` : ''}

      ${faltaDni ? '<div class="msg err" style="margin-bottom:6px">Cargale el DNI en Contacto: sin eso la declaración no sirve.</div>' : ''}
      ${!dom ? '<div class="msg" style="margin-bottom:6px;color:var(--ink2)">Completá el domicilio acá abajo o en Contacto.</div>' : ''}

      <div class="campo"><label class="lb">Domicilio para la declaración</label>
        <input class="input" id="sd-dj-dom" placeholder="Calle y número" value="${P.esc(d.socio.domicilio || '')}" /></div>
      <div class="grid2" style="gap:10px">
        <div class="campo"><label class="lb">Localidad</label>
          <input class="input" id="sd-dj-loc" value="${P.esc(d.socio.localidad || '')}" /></div>
        <div class="campo"><label class="lb">Provincia</label>
          <input class="input" id="sd-dj-prov" value="${P.esc(d.socio.provincia || '')}" /></div>
      </div>
      <div class="campo"><label class="lb">Diagnóstico que funda la prescripción</label>
        <input class="input" id="sd-dj-diag" maxlength="300" placeholder="Tal cual va en el texto: «…acredita la existencia de ___»" value="${P.esc(dec?.nota || '')}" /></div>
      <p class="so-help" style="margin:2px 0 0">Lo escribe ${P.esc(d.plantilla.medico)} (${P.esc(d.plantilla.matricula)}), que es quien firma la prescripción. No queda guardado como dato clínico del padrón.</p>

      <div class="fila" style="margin-top:10px;flex-wrap:wrap">
        ${dec && s.telefono ? `<a class="btn" href="${P.esc(waDdjj(s))}" target="_blank" rel="noopener" title="Abre el chat con el mensaje escrito. El PDF lo adjuntás vos.">WhatsApp para mandarla</a>` : ''}
        ${dec ? '<a class="btn" id="sd-dj-ver" href="/api/panel/declaracion?socio_id=' + s.id + '&ver=1" target="_blank" rel="noopener">Ver / imprimir</a>' : ''}
        ${dec && dec.estado === 'firmada' ? '<a class="btn" href="/api/panel/declaracion?declaracion_id=' + dec.id + '&firmada=1" target="_blank" rel="noopener">Ver la firmada</a>' : ''}
        <span class="pn-sp"></span>
        ${dec && dec.estado !== 'firmada' ? '<button class="btn btn-peligro" id="sd-dj-anular" type="button">Anular</button>' : ''}
        ${dec ? '<button class="btn" id="sd-dj-adjuntar" type="button">Adjuntar firmada</button>' : ''}
        <button class="btn btn-pri" id="sd-dj-generar" type="button" ${faltaDni ? 'disabled' : ''}>${dec ? 'Generar de nuevo' : 'Generar declaración'}</button>
        <input type="file" id="sd-dj-file" accept="application/pdf,image/jpeg,image/png" hidden />
      </div>
      <p class="msg" id="sd-msg-dj" style="margin:6px 0 0"></p>`

    const msg = zona.querySelector('#sd-msg-dj')
    const decir = (t, c) => { msg.className = 'msg ' + (c || ''); msg.textContent = t }

    zona.querySelector('#sd-dj-generar')?.addEventListener('click', async (e) => {
      const diag = zona.querySelector('#sd-dj-diag').value.trim()
      if (!diag) { decir('Falta el diagnóstico.', 'err'); return }
      e.target.disabled = true
      decir('⏳ armando el documento…')
      const r = await fetch('/api/panel/declaracion', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          socio_id: s.id, diagnostico: diag,
          domicilio: zona.querySelector('#sd-dj-dom').value.trim(),
          localidad: zona.querySelector('#sd-dj-loc').value.trim(),
          provincia: zona.querySelector('#sd-dj-prov').value.trim(),
        }),
      })
      const res = await r.json().catch(() => ({}))
      e.target.disabled = false
      if (!r.ok) { decir('✗ ' + (res.error || 'no se pudo'), 'err'); return }
      // se abre en una pestaña con el botón de imprimir arriba
      const w = window.open('', '_blank')
      if (w) { w.document.write(res.html); w.document.close() }
      decir('✔ generada' + (w ? ' — se abrió para imprimir' : ' — abrila con «Ver / imprimir»'), 'ok')
      alCambiar?.(); abrir(s.id, alCambiar)
    })

    zona.querySelector('#sd-dj-adjuntar')?.addEventListener('click', () => zona.querySelector('#sd-dj-file').click())
    zona.querySelector('#sd-dj-file')?.addEventListener('change', async (ev) => {
      const f = ev.target.files[0]
      if (!f || !dec) return
      decir('⏳ subiendo…')
      const b64 = await new Promise((res, rej) => {
        const fr = new FileReader()
        fr.onload = () => res(String(fr.result).split(',')[1])
        fr.onerror = rej
        fr.readAsDataURL(f)
      })
      const r = await fetch('/api/panel/declaracion', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ declaracion_id: dec.id, archivo_base64: b64, archivo_tipo: f.type }),
      })
      const res = await r.json().catch(() => ({}))
      if (!r.ok) { decir('✗ ' + (res.error || 'no se pudo'), 'err'); return }
      alCambiar?.(); abrir(s.id, alCambiar)
    })

    zona.querySelector('#sd-dj-anular')?.addEventListener('click', async () => {
      if (!(await P.confirmar('¿Anular esta declaración? Queda el registro de que existió, pero deja de valer.', 'Sí, anular'))) return
      await fetch('/api/panel/declaracion', {
        method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ declaracion_id: dec.id }),
      })
      alCambiar?.(); abrir(s.id, alCambiar)
    })
  }

  /* Venderle un plan prepago: paga todo junto y le queda un saldo de gramos a
     favor para retirar durante N meses. Lo que no retira, se acumula. */
  async function modalPlan(s) {
    const ov = P.modal(`Plan prepago — ${s.nombre}`, '<div class="vacio">⏳ Buscando los planes…</div>')
    const cuerpo = ov.querySelector('.pn-mod-cuerpo')
    const r = await fetch(`/api/panel/plan-socio?socio_id=${s.id}`, { credentials: 'include' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { cuerpo.innerHTML = `<p style="color:var(--dan);margin:0">${P.esc(d.error || 'Error ' + r.status)}</p>`; return }
    if (!d.planes.length) {
      cuerpo.innerHTML = `<p style="margin:0">No hay planes prepagos cargados. Creá uno en <b>Membresías</b>.</p>
        <div class="pn-mod-acciones"><button class="btn btn-pri" onclick="Panel.cerrarModal()" type="button">Entendido</button></div>`
      return
    }
    const hoy = new Date().toISOString().slice(0, 10)
    cuerpo.innerHTML = `
      <div class="campo"><label class="lb">Qué plan compró</label>
        <select class="sel" id="pl-item">${d.planes.map((p) => {
          const total = (p.plan_gramos_mes || 0) * (p.plan_meses || 0)
          return `<option value="${P.esc(p.item)}" data-contado="${p.contado || 0}">${P.esc(p.item)} · ${p.plan_gramos_mes} g/mes × ${p.plan_meses} meses = ${total} g · ${P.fmt(p.contado || 0)}</option>`
        }).join('')}</select></div>
      <div class="grid2" style="gap:10px">
        <div class="campo"><label class="lb">Desde</label>
          <input class="input" id="pl-desde" type="date" value="${hoy}" /></div>
        <div class="campo"><label class="lb">Cuánto cobraste</label>
          <input class="input" id="pl-monto" type="number" min="0" step="10000" /></div>
      </div>
      <div class="campo"><label class="lb">Cómo pagó</label>
        <select class="sel" id="pl-cobro">
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="mp">Mercado Pago</option>
          <option value="ninguno">Ya lo había pagado antes (no registrar el ingreso)</option>
        </select></div>
      ${d.mensual ? `<p class="so-help" style="margin:8px 0 0">Tiene la membresía <b>${P.esc(d.mensual.tier)}</b> vigente: se cierra al arrancar el plan, porque el prepago la reemplaza.</p>` : ''}
      <p class="so-help" style="margin:6px 0 0" id="pl-resumen"></p>
      <div class="pn-mod-acciones">
        <button class="btn btn-pri" id="pl-guardar" type="button">Asignar el plan</button>
      </div>
      <p class="msg" id="pl-msg" style="margin:8px 0 0"></p>`

    const sel = cuerpo.querySelector('#pl-item')
    const monto = cuerpo.querySelector('#pl-monto')
    const resumen = cuerpo.querySelector('#pl-resumen')
    const pintar = () => {
      const p = d.planes.find((x) => x.item === sel.value)
      if (!p) return
      monto.value = p.contado || ''
      const total = (p.plan_gramos_mes || 0) * (p.plan_meses || 0)
      resumen.textContent = `Le quedan ${total} gramos para retirar cuando quiera durante ${p.plan_meses} meses. Lo que no retira en un mes, se acumula.`
    }
    sel.addEventListener('change', pintar)
    pintar()

    cuerpo.querySelector('#pl-guardar').addEventListener('click', async (e) => {
      const msg = cuerpo.querySelector('#pl-msg')
      e.target.disabled = true
      msg.className = 'msg'; msg.textContent = '⏳ asignando…'
      const rr = await fetch('/api/panel/plan-socio', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          socio_id: s.id, item: sel.value, desde: cuerpo.querySelector('#pl-desde').value,
          cobro: cuerpo.querySelector('#pl-cobro').value, monto: monto.value,
        }),
      })
      const dd = await rr.json().catch(() => ({}))
      e.target.disabled = false
      if (!rr.ok) { msg.className = 'msg err'; msg.textContent = '✗ ' + (dd.error || 'no se pudo'); return }
      P.cerrarModal()
      alCambiar?.(); abrir(s.id, alCambiar)
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
        ${d.socio_id ? '<button class="btn" id="sd-mp-mail" type="button">Mandar por email</button>' : ''}
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

  window.PanelSocioDetalle = { abrir, cerrar, modalDebito }
})()
