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
    const txt = `Hola ${nom}! Ya está lista tu declaración jurada para pasarte a Flora. `
      + `Es el paso que pide el registro cuando alguien deja el autocultivo y se vincula a una asociación: `
      + `no se pueden tener las dos modalidades a la vez.\n\n`
      + `La podés firmar directo desde tu cuenta, sin imprimir nada:\n`
      + `1. Entrá a https://floraong.ar/socios/ con tu Google\n`
      + `2. En "Mi cuenta" vas a ver la tarjeta DECLARACIÓN JURADA\n`
      + `3. Leela y firmala con tu nombre y tu DNI\n\n`
      + `Con eso seguimos nosotros el trámite. Cualquier duda antes de firmar, escribime.`
    // wa.me quiere el número internacional: a los celulares argentinos de 10
    // cifras se les antepone 549
    let tel = String(s.telefono || '').replace(/\D/g, '')
    if (tel.length === 10) tel = '549' + tel
    return `https://wa.me/${tel}?text=${encodeURIComponent(txt)}`
  }

  let velo = null
  let caja = null
  let alCambiar = null
  let tabActiva = 'resumen'
  let ultimoId = null
  let fichaMax = false

  function cerrar() {
    velo?.remove(); caja?.remove()
    velo = caja = null
    document.removeEventListener('keydown', porEscape)
  }
  function porEscape(e) { if (e.key === 'Escape') cerrar() }

  async function abrir(id, onCambio, tab) {
    alCambiar = onCambio || null
    if (ultimoId !== id) { tabActiva = 'resumen'; ultimoId = id }
    if (tab) tabActiva = tab // solapa sugerida por quien abre (ej. kanban de Inicio)
    cerrar()
    velo = document.createElement('div'); velo.className = 'pn-drawer-velo'
    caja = document.createElement('aside'); caja.className = 'pn-drawer' + (fichaMax ? ' max' : '')
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
    // ── semáforo de cumplimiento Res. 1780/2025 (por paciente) ──
    const cumFila = (est, texto, det) => `<div class="sd-cum is-${est}"><span class="sd-cum-ico">${est === 'ok' ? '✓' : est === 'warn' ? '△' : est === 'mal' ? '✗' : '·'}</span><span>${texto}</span>${det ? `<span class="sd-cum-det">${det}</span>` : ''}</div>`
    const cumplimiento = (() => {
      const filas = []
      const faltan = [!s.documento && 'DNI', !s.domicilio && 'domicilio', !s.email && 'email'].filter(Boolean)
      filas.push(faltan.length
        ? cumFila('mal', 'Identidad para la nómina (art. 4° ter)', 'falta ' + faltan.join(', '))
        : cumFila('ok', 'Identidad completa para la nómina (art. 4° ter)'))
      const vence = String(s.reprocann_vence || '').slice(0, 10)
      const hoy = new Date().toISOString().slice(0, 10)
      const en45 = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10)
      filas.push(!vence ? cumFila('warn', 'Vigencia del REPROCANN', 'sin fecha de vencimiento cargada')
        : vence < hoy ? cumFila('mal', 'REPROCANN vencido', 'venció ' + fFecha(vence))
        : vence <= en45 ? cumFila('warn', 'REPROCANN por vencer', 'vence ' + fFecha(vence))
        : cumFila('ok', 'REPROCANN vigente', 'vence ' + fFecha(vence)))
      const rc = s.reprocann_estado
      filas.push(rc === 'aprobado' ? cumFila('ok', 'Vinculado a Flora como cultivadora')
        : rc === 'autocultivo' ? cumFila('warn', 'Figura como autocultivo', 'no vinculado a Flora')
        : rc === 'conversion' ? cumFila('ok', 'Vinculado a Flora por declaración jurada', 'renuncia firmada y verificada')
        : rc === 'en_evaluacion' ? cumFila('warn', 'Vinculación en evaluación del Ministerio')
        : cumFila('pend', 'Vinculación con Flora', 'trámite en curso'))
      filas.push(`<div class="sd-cum" id="sd-cum-ddjj">${['autocultivo', 'ddjj_pendiente', 'ddjj_firmada', 'conversion'].includes(rc) ? '<span class="sd-cum-ico">·</span><span>Renuncia al autocultivo (art. 4° ter inc. c)</span><span class="sd-cum-det">⏳</span>' : '<span class="sd-cum-ico">·</span><span>Renuncia al autocultivo</span><span class="sd-cum-det">no aplica: vinculación directa</span>'}</div>`)
      filas.push('<div class="sd-cum" id="sd-cum-cert"><span class="sd-cum-ico">·</span><span>Certificado REPROCANN archivado</span><span class="sd-cum-det">⏳</span></div>')
      if (s.reprocann_plantas) {
        filas.push(s.reprocann_plantas <= 9
          ? cumFila('ok', 'Plantas florecidas autorizadas', s.reprocann_plantas + ' de 9 (Anexo IV)')
          : cumFila('mal', 'Plantas autorizadas EXCEDEN el tope', s.reprocann_plantas + ' de 9 (Anexo IV)'))
      }
      if (d.saldo && typeof d.saldo.retiradoMes === 'number') {
        filas.push(d.saldo.retiradoMes <= 40
          ? cumFila('ok', 'Dispensa del mes dentro del tope', d.saldo.retiradoMes + ' g de 40 g (Anexo IV)')
          : cumFila('mal', 'Dispensa del mes EXCEDE el tope', d.saldo.retiradoMes + ' g de 40 g (Anexo IV)'))
      }
      return filas.join('')
    })()
    const chipCarta = d.carta.acceso
      ? (d.carta.lastLogin ? `<span class="tag tag-ok">carta ${hace(d.carta.lastLogin)}</span>` : '<span class="tag tag-off">sin ingresar</span>')
      : '<span class="tag tag-deb">sin acceso a la carta</span>'

    caja.innerHTML = `
      <button class="pn-drawer-x" type="button" aria-label="Cerrar">✕</button>
      <button class="pn-ficha-max" id="sd-max" type="button" title="Expandir / achicar">⛶</button>
      <div class="pn-drawer-cab">
        <div class="fila"><span class="av">${P.esc(P.iniciales(s.nombre))}</span>
          <div><div style="font-family:var(--font-display);font-size:19px">${P.esc(s.nombre)}</div>
          <div style="color:var(--muted);font-size:12px">${s.numero ? '#' + s.numero + ' · ' : ''}${P.esc(s.email || 'sin email')}${s.documento ? ' · DNI ' + P.esc(s.documento) : ''}${s.telefono ? ' · <a href="' + P.esc(waDe(s)) + '" target="_blank" rel="noopener" style="color:var(--grn,#2c9a6f);text-decoration:none">' + P.esc(s.telefono) + '</a>' : ''}</div></div></div>
        <div class="fila" style="margin-top:6px;flex-wrap:wrap;gap:4px">
          ${d.membresia ? `<span class="tag ${d.membresia.modalidad === 'plan' ? 'tag-auto' : 'tag-ok'}">${P.esc(d.membresia.tier)}${d.membresia.modalidad === 'debito' ? ' · débito' : d.membresia.modalidad === 'plan' ? ' · plan' : ''}</span>` : '<span class="tag tag-off">sin membresía</span>'}
          ${chipDebito}
          ${paso ? `<span class="tag ${paso.quien === 'club' ? 'tag-mal' : paso.quien === 'paciente' ? 'tag-deb' : paso.quien === 'medico' ? 'tag-auto' : s.reprocann_estado === 'aprobado' || s.reprocann_estado === 'autocultivo' ? 'tag-ok' : 'tag-off'}" title="${P.esc(paso.ayuda)}">${P.esc(paso.nombre)}</span>` : ''}
          ${chipCarta}
          ${s.estado === 'inactivo' ? '<span class="tag tag-off">inactivo</span>' : ''}
          ${s.med_en_tratamiento ? `<span class="tag tag-ok" title="Señal del consultorio del Dr. Kalb (sin datos clínicos)${s.med_proxima_consulta ? ' · próxima consulta ' + new Date(s.med_proxima_consulta).toLocaleDateString('es-AR') : ''}">En tratamiento${s.med_proxima_consulta ? ' · próx. ' + new Date(s.med_proxima_consulta).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : ''}</span>` : ''}
        </div>
      </div>
      <div class="pn-drawer-cuerpo">
        <div class="sd-tabs" role="tablist">
          ${[['resumen', 'Resumen'], ['legajo', '🩺 Legajo'], ['tramite', 'Trámite'], ['legal', 'Legal'], ['eco', 'Económico'], ['retiros', 'Retiros'], ['datos', 'Datos']]
            .filter(([id]) => (id !== 'legal' || P.puede('reprocann_editar')) && (id !== 'legajo' || P.puede('padron_ver')))
            .map(([id, tx]) => `<button type="button" class="sd-tabbtn ${tabActiva === id ? 'on' : ''}" data-tab="${id}">${tx}</button>`).join('')}
        </div>

        <div class="sd-tab ${tabActiva === 'resumen' ? 'on' : ''}" data-tab="resumen">
          <div class="sd-cols">
          <section class="sd-bl"><h3 class="sd-bl-t">Cumplimiento Res. 1780/2025</h3>
            <div class="sd-cum-lista">${cumplimiento}</div>
          </section>
          <div>
          <section class="sd-bl"><h3 class="sd-bl-t">Cuenta y accesos</h3>
            <div style="margin-top:8px;font-size:13px;color:var(--ink2);display:grid;gap:4px">
              <div>${chipCarta}${typeof d.carta.logins === 'number' ? ` · ${d.carta.logins} ingreso${d.carta.logins === 1 ? '' : 's'}` : ''}</div>
              ${d.carta.temporal ? `<div>Acceso de prueba${d.carta.tempExpiraEn ? ` hasta ${fFecha(d.carta.tempExpiraEn)}` : ''}</div>` : ''}
              <div style="color:var(--muted);font-size:12px">${d.carta.tosAceptado ? `Términos aceptados ${fFecha(d.carta.tosAceptado)}${d.carta.tosVersion ? ' · versión ' + P.esc(d.carta.tosVersion) : ''}` : 'Términos: sin registro de aceptación'}</div>
              ${s.adhesion_habilitada ? `<div style="color:var(--grn,#2c9a6f);font-size:12px">✓ Adhesión al débito habilitada ${hace(s.adhesion_habilitada)}${s.adhesion_habilitada_por ? ' por ' + P.esc(s.adhesion_habilitada_por) : ''}</div>` : ''}
            </div>
          </section>
          <section class="sd-bl"><h3 class="sd-bl-t">Consultorio</h3>
            <div style="margin-top:8px;font-size:13px;color:var(--ink2)">
              ${s.med_en_tratamiento
                ? `✓ En tratamiento con el Dr. Kalb${s.med_proxima_consulta ? ` · próxima consulta ${new Date(s.med_proxima_consulta).toLocaleDateString('es-AR')}` : ''}`
                : 'Sin señal del consultorio para este DNI.'}
              <div style="color:var(--muted);font-size:12px;margin-top:4px">Turnos, asistencias e historia clínica se leen en vivo del consultorio: la clínica solo la ve el rol médico.</div>
              <div class="fila" style="margin-top:8px"><button class="btn" id="sd-r-legajo" type="button">🩺 Ver legajo</button></div>
            </div>
          </section>
          </div>
          </div>
          <div class="fila" style="margin-top:14px;flex-wrap:wrap">
            ${mp ? '<button class="btn btn-pri" id="sd-r-debito" type="button">$ Mandar link de pago</button>' : ''}
            ${s.telefono ? `<a class="btn" target="_blank" rel="noopener" href="${P.esc(waDe(s))}">WhatsApp del paso</a>` : ''}
          </div>
        </div>

        <div class="sd-tab ${tabActiva === 'legajo' ? 'on' : ''}" data-tab="legajo">
          <div id="sd-legajo"><div style="margin-top:8px;color:var(--muted);font-size:13px">⏳ pidiendo el legajo al consultorio…</div></div>
        </div>

        <div class="sd-tab ${tabActiva === 'tramite' ? 'on' : ''}" data-tab="tramite">
          <section class="sd-bl"><h3 class="sd-bl-t">REPROCANN</h3>
          <div class="so-timeline">${pasos.filter((p) => !['revisar', 'rechazado', 'vencido', 'autocultivo', 'ddjj_pendiente', 'ddjj_firmada', 'conversion'].includes(p.id) || p.id === s.reprocann_estado).map((p, i) =>
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
              <button class="btn" id="sd-cert-releer" type="button" hidden title="Vuelve a leer el PDF guardado y completa los campos vacíos de la ficha">Releer datos</button>
              <button class="btn" id="sd-cert-subir" type="button">Subir</button>
              <button class="btn btn-peligro" id="sd-cert-borrar" type="button" hidden>Quitar</button>
              <input type="file" id="sd-cert-file" accept="application/pdf" hidden />` : ''}
          </div>
        </section>
        </div>

        ${P.puede('reprocann_editar') ? `<div class="sd-tab ${tabActiva === 'legal' ? 'on' : ''}" data-tab="legal">` : '<div hidden>'}
          ${P.puede('reprocann_editar') ? `
        <section class="sd-bl"><h3 class="sd-bl-t">Declaración jurada</h3>
          ${['autocultivo', 'ddjj_pendiente', 'ddjj_firmada', 'conversion'].includes(s.reprocann_estado)
            ? `<p class="so-help" style="margin:8px 0 0">Viene del autocultivo: para vincularse a Flora tiene que renunciar,
              porque las modalidades son excluyentes. Esto arma el papel con sus datos ya puestos; lo firma en su cuenta
              y el débito se habilita cuando lo verificás.</p>`
            : `<p class="so-help" style="margin:8px 0 0">Entra por el camino del trámite nuevo, así que la firma que le toca
              es el <b>consentimiento</b> en Mi Argentina, no esta declaración. Se genera igual si alguna vez figuró como
              autocultivador y hay que documentar la renuncia.</p>`}
          <div id="sd-ddjj" style="margin-top:10px"><div style="color:var(--muted);font-size:12px">⏳ buscando…</div></div>
          ${typeof d.declaraciones_total === 'number' && d.declaraciones_total > 1 ? `<p style="margin:8px 0 0;font-size:12px;color:var(--muted)">Historial: ${d.declaraciones_total} declaraciones registradas (incluye anuladas).</p>` : ''}
        </section>` : ''}
        </div>

        <div class="sd-tab ${tabActiva === 'eco' ? 'on' : ''}" data-tab="eco">
          <div class="sd-cols">
          <section class="sd-bl"><h3 class="sd-bl-t">Membresía</h3>
          <div class="fila" style="margin-top:10px;flex-wrap:wrap">
            ${d.membresia && d.membresia.modalidad === 'plan'
              ? `<span class="tag tag-auto">${P.esc(d.membresia.tier)} · plan prepago</span>`
              : editar ? `<select class="sel" id="sd-tier">${TIERS.map((t) =>
                  `<option value="${t}" ${(d.membresia?.tier || 'NINGUNA') === t ? 'selected' : ''}>${t === 'NINGUNA' ? '— sin membresía' : t}</option>`).join('')}</select>`
              : `<b>${P.esc(d.membresia?.tier || '— sin membresía')}</b>`}
            ${d.membresia?.gramos_mes ? `<span style="color:var(--muted);font-size:12px">${d.membresia.gramos_mes} g por mes · desde ${fFecha(d.membresia.desde)}</span>` : ''}
          </div>
          
          ${editar ? `<div class="fila" style="margin-top:10px">
            ${d.membresia && d.membresia.modalidad === 'plan'
              ? '<button class="btn btn-peligro" id="sd-plan-cancelar" type="button">Cancelar el plan prepago</button>'
              : '<button class="btn" id="sd-plan-vender" type="button">Venderle un plan prepago</button>'}
          </div>` : ''}
          <p class="msg" id="sd-msg-memb" style="margin:6px 0 0"></p>
        </section>
          <section class="sd-bl"><h3 class="sd-bl-t">Débito automático</h3>
          <div style="margin-top:10px;font-size:13px;color:var(--ink2)">
            ${d.debito?.estado ? `${chipDebito} ${d.debito.monto ? `<b>${P.fmt(d.debito.monto)}</b>/mes` : ''}
              ${d.debito.estado === 'activa' ? ` · cuota ${d.debito.racha_meses % 3 === 0 && d.debito.racha_meses > 0 ? 3 : d.debito.racha_meses % 3}/3` : ''}
              ${d.debito.fin ? ` · termina ${fFecha(d.debito.fin)}` : ''}` : 'Sin suscripción todavía.'}
            ${d.debito?.ultimo_envio ? `<div style="color:var(--muted);font-size:12px;margin-top:4px">link ${P.esc(d.debito.ultimo_envio.tier)} mandado ${hace(d.debito.ultimo_envio.enviado)} por ${d.debito.ultimo_envio.via === 'email' ? 'email' : 'WhatsApp'}</div>` : ''}
          </div>
          ${s.adhesion_habilitada ? `<div style="font-size:12px;color:var(--grn,#4c9);margin-top:6px">✓ Puede adherirse desde su cuenta (habilitado ${hace(s.adhesion_habilitada)}${s.adhesion_habilitada_por ? ' por ' + P.esc(s.adhesion_habilitada_por) : ''})</div>` : ''}
          ${mp ? `<div class="fila" style="margin-top:10px;flex-wrap:wrap">
            <button class="btn btn-pri" id="sd-debito" type="button">$ Mandar link de pago</button>
            <button class="btn" id="sd-adhesion" type="button">${s.adhesion_habilitada ? 'Quitarle la habilitación' : 'Dejar que se adhiera desde su cuenta'}</button>
            ${s.adhesion_habilitada && s.telefono ? `<a class="btn" target="_blank" rel="noopener" href="https://wa.me/${(() => { let t = String(s.telefono).replace(/\D/g, ''); return t.length === 10 ? '549' + t : t })()}?text=${encodeURIComponent(`Hola ${String(s.nombre || '').split(' ')[0]}! Ya podés adherirte al débito automático con el 20% de descuento directo desde tu cuenta de Flora: entrá a https://floraong.ar/socios/membresias/ con tu Google, elegí tu membresía y listo. Cualquier duda escribime.`)}">Avisarle por WhatsApp</a>` : ''}
            <button class="btn" id="sd-no-insistir" type="button">${s.debito_no_insistir ? 'Volver a ofrecer' : 'No insistir'}</button>
          </div>` : ''}
        </section>
          </div>
          ${(d.suscripciones || []).length ? `<section class="sd-bl"><h3 class="sd-bl-t">Suscripciones (historial completo)</h3>
            <div style="margin-top:6px">${d.suscripciones.map((su) => `<div class="sd-fila-h">
              <b>${P.esc(su.tier || '—')}</b>
              <span class="tag ${su.estado === 'activa' ? 'tag-ok' : su.estado === 'cancelada' ? 'tag-off' : 'tag-deb'}">${P.esc(su.estado)}</span>
              <span>${P.fmt(su.monto)}/mes</span>
              <span style="color:var(--muted)">cuotas acreditadas: ${su.racha_meses ?? 0}</span>
              ${su.fin ? `<span style="color:var(--muted)">hasta ${fFecha(su.fin)}</span>` : ''}
              <span class="pn-sp"></span>
              <span style="color:var(--muted);font-size:11px">${P.esc(su.origen || '')}${su.mp_ref ? ' · …' + P.esc(su.mp_ref) : ''} · ${fFecha(su.creado)}</span>
            </div>`).join('')}</div>
          </section>` : ''}
          <section class="sd-bl"><h3 class="sd-bl-t">Pagos recientes</h3>
            <div style="margin-top:6px;font-size:13px;color:var(--ink2)">${d.movimientos ? `<b style="display:block;margin-top:6px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Pagos</b>
            ${d.movimientos.length ? d.movimientos.map((x) => `<div class="fila" style="padding:3px 0">
              <span>${fFecha(x.fecha)} · ${P.esc(x.concepto || x.categoria)}</span><span class="pn-sp"></span>
              <span style="font-weight:600">${P.fmt(x.neto)}</span></div>`).join('') : '<div style="color:var(--muted)">Sin pagos.</div>'}` : ''}</div>
          </section>
        </div>

        <div class="sd-tab ${tabActiva === 'retiros' ? 'on' : ''}" data-tab="retiros">
          <div class="sd-cols">
          <section class="sd-bl"><h3 class="sd-bl-t">Saldo</h3>
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
            ${!d.saldo || !d.membresia ? '<div style="margin-top:8px;color:var(--muted);font-size:13px">Sin membresía activa: no hay saldo que mostrar.</div>' : ''}
          </section>
          <section class="sd-bl"><h3 class="sd-bl-t">Retiros recientes</h3>
          <div style="margin-top:6px;font-size:13px;color:var(--ink2)"><b style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Retiros</b>
            ${d.dispensas.length ? d.dispensas.map((x) => `<div class="fila" style="padding:3px 0">
              <span>${fFecha(x.fecha)} · ${P.esc(x.producto || 'flores')}</span><span class="pn-sp"></span>
              <span>${x.gramos ? x.gramos + ' g' : (x.unidades || '') + ' u'}</span></div>`).join('') : '<div style="color:var(--muted)">Sin retiros.</div>'}</div>
        </section>
        </div>
        </div>

        <div class="sd-tab ${tabActiva === 'datos' ? 'on' : ''}" data-tab="datos">
          <section class="sd-bl"><h3 class="sd-bl-t">Contacto</h3>
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
        </section>
          ${editar ? `<section class="sd-bl sd-bl--peligro"><h3 class="sd-bl-t">Zona peligrosa</h3>
          <p class="so-help" style="margin:2px 0 0">Acciones que cambian el acceso del paciente. Se pueden revertir, pero se notan.</p>
          <div class="fila" style="margin-top:10px;flex-wrap:wrap">
            <button class="btn" id="sd-estado" type="button">${s.estado === 'activo' ? 'Marcar inactivo' : 'Reactivar socio'}</button>
            ${P.puede('papelera_gestionar') ? `<button class="btn ${s.papelera ? '' : 'btn-peligro'}" id="sd-papelera" type="button">${s.papelera ? 'Restaurar de la papelera' : '🗑 Mandar a la papelera'}</button>` : ''}
            ${d.carta.acceso && P.puede('carta_gestionar') ? '<button class="btn btn-peligro" id="sd-quitar-carta" type="button">Quitar acceso a la carta</button>' : ''}
          </div>
          <p class="msg" id="sd-msg-zona" style="margin:6px 0 0"></p>
        </section>` : ''}
        </div>
      </div>`

    caja.querySelector('.pn-drawer-x').addEventListener('click', cerrar)

    // El legajo del consultorio se pide UNA vez por pintada, y recién al
    // entrar a la solapa: es un viaje a otro sistema, no viaja con la ficha.
    let legajoPedido = false
    const cargarLegajo = () => {
      if (legajoPedido) return
      legajoPedido = true
      pintarLegajo(s)
    }

    caja.querySelectorAll('.sd-tabbtn').forEach((b) => b.addEventListener('click', () => {
      tabActiva = b.dataset.tab
      caja.querySelectorAll('.sd-tabbtn').forEach((x) => x.classList.toggle('on', x === b))
      caja.querySelectorAll('.sd-tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tabActiva))
      if (tabActiva === 'legajo') cargarLegajo()
    }))
    if (tabActiva === 'legajo') cargarLegajo()
    caja.querySelector('#sd-r-debito')?.addEventListener('click', () => modalDebito(s))
    caja.querySelector('#sd-r-legajo')?.addEventListener('click', () =>
      caja.querySelector('.sd-tabbtn[data-tab="legajo"]')?.click())
    caja.querySelector('#sd-max')?.addEventListener('click', () => {
      fichaMax = !fichaMax
      caja.classList.toggle('max', fichaMax)
    })

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
        const cum = caja.querySelector('#sd-cum-cert')
        if (cum) {
          cum.className = 'sd-cum ' + (d.existe ? 'is-ok' : 'is-warn')
          cum.innerHTML = d.existe
            ? '<span class="sd-cum-ico">✓</span><span>Certificado REPROCANN archivado</span><span class="sd-cum-det">subido ' + fFecha(d.meta?.subido) + '</span>'
            : '<span class="sd-cum-ico">△</span><span>Certificado REPROCANN sin archivar</span><span class="sd-cum-det">subilo en Trámite</span>'
        }
        const ver = caja.querySelector('#sd-cert-ver')
        if (ver) { ver.hidden = !d.existe; ver.href = `/api/panel/certificado?socio_id=${s.id}&descargar=1` }
        const borrar = caja.querySelector('#sd-cert-borrar')
        if (borrar) borrar.hidden = !d.existe
        const releer = caja.querySelector('#sd-cert-releer')
        if (releer) releer.hidden = !d.existe
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
    caja.querySelector('#sd-cert-releer')?.addEventListener('click', async (e) => {
      e.target.disabled = true
      const est = caja.querySelector('#sd-cert-estado')
      est.textContent = 'releyendo…'
      const r = await fetch('/api/panel/certificado', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socio_id: s.id, releer: true }),
      })
      const d2 = await r.json().catch(() => ({}))
      e.target.disabled = false
      if (!r.ok) { est.textContent = '✗ ' + (d2.error || 'no se pudo'); return }
      const n = Object.keys(d2.leido || {}).length
      if (n) { abrir(s.id, alCambiar) } else { est.textContent = 'no encontró datos nuevos (¿cupo de visión agotado? probá más tarde)' }
    })
    caja.querySelector('#sd-cert-borrar')?.addEventListener('click', async () => {
      if (!(await P.confirmar('¿Quitar el certificado PDF de este paciente?', 'Sí, quitar'))) return
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
    caja.querySelector('#sd-adhesion')?.addEventListener('click', async (e) => {
      const dar = !s.adhesion_habilitada
      const vedado = ['autocultivo', 'ddjj_pendiente', 'ddjj_firmada'].includes(s.reprocann_estado)
      if (dar && vedado) {
        const ok = await P.confirmar('Tiene pendiente la declaración jurada de renuncia al autocultivo: aunque lo habilites, el portal no le va a dejar adherirse hasta que su declaración esté verificada. ¿Habilitarlo igual (queda listo para cuando firme)?')
        if (!ok) return
      }
      e.target.disabled = true
      const r = await fetch('/api/panel/padron/socio', {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, adhesion_habilitada: dar }),
      })
      e.target.disabled = false
      if (!r.ok) return
      alCambiar?.(); abrir(s.id, alCambiar)
    })
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

  // Legajo del paciente en el consultorio (drezequielkalb.com): visor EN VIVO,
  // acá no se guarda nada. Lo administrativo lo ve cualquiera con padron_ver;
  // la sección clínica solo llega si el CONSULTORIO reconoce al usuario del
  // panel como médico (su lista MEDICOS decide, no el club).
  async function pintarLegajo(s) {
    const zona = caja.querySelector('#sd-legajo')
    if (!zona) return
    let d
    try {
      const r = await fetch(`/api/panel/legajo?socio_id=${s.id}`, { credentials: 'include' })
      d = await r.json()
      if (!r.ok) throw new Error(d.error || 'error ' + r.status)
    } catch (e) {
      zona.innerHTML = `<div class="msg err" style="margin-top:8px">✗ ${P.esc(e.message || 'El consultorio no contestó: probá de nuevo')}</div>`
      return
    }
    const base = d.consultorio_base || 'https://drezequielkalb.com'
    const btnAbrir = (pid) => pid
      ? `<a class="btn" target="_blank" rel="noopener" href="${P.esc(`${base}/paciente?id=${pid}`)}">Abrir en el consultorio</a>`
      : '<span class="btn" aria-disabled="true" style="opacity:.45;pointer-events:none">Abrir en el consultorio</span>'

    if (!d.existe) {
      zona.innerHTML = `
        <div style="margin-top:8px;font-size:13px;color:var(--muted)">Sin legajo en el consultorio para este DNI.</div>
        <div class="fila" style="margin-top:10px">${btnAbrir(null)}</div>`
      return
    }

    const p = d.paciente || {}
    const res = d.resumen || {}
    const fHora = (iso) => (iso && String(iso).length >= 16 ? ' · ' + String(iso).slice(11, 16) : '')

    const TAG_TURNO = { atendido: 'tag-ok', agendado: 'tag-auto', pendiente_pago: 'tag-deb', cancelado: 'tag-off' }
    const PAGO = { aprobado: 'pagado', pendiente: 'pago pendiente', manual: 'pago manual', vencido: 'pago vencido' }
    const filaTurno = (t) => {
      const est = t.atendido || t.estado === 'atendido' ? 'atendido' : (t.estado || '—')
      return `<div class="fila" style="padding:3px 0;gap:6px;flex-wrap:wrap">
        <span>${fFecha(t.inicio)}${fHora(t.inicio)}</span>
        <span style="color:var(--muted)">${P.esc(t.modalidad || '—')}</span>
        <span class="tag ${TAG_TURNO[est] || 'tag-off'}">${P.esc(est)}</span>
        <span class="pn-sp"></span>
        <span style="color:var(--muted);font-size:12px">${P.esc(PAGO[t.pago_estado] || '')}</span>
      </div>`
    }

    // el REPROCANN según el consultorio, solo si difiere de la ficha del club
    const rc = d.reprocann || {}
    const norm = (v) => String(v ?? '').trim()
    const rcDifiere = [
      [s.reprocann_codigo, rc.codigo],
      [s.reprocann_tramite, rc.tramite],
      [s.reprocann_estado, rc.estado],
      [norm(s.reprocann_vence).slice(0, 10), norm(rc.vence).slice(0, 10)],
    ].some(([mio, suyo]) => (norm(mio) || norm(suyo)) && norm(mio) !== norm(suyo))

    const cli = d.clinica
    const bloqueTitulo = (tx) => `<b style="display:block;margin-top:10px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">${tx}</b>`
    const clinicaHtml = cli ? `
      <section class="sd-bl"><h3 class="sd-bl-t">Historia clínica</h3>
        <div style="margin-top:4px;font-size:11px;color:var(--muted)">Visible solo para el rol médico · vive en el consultorio, acá no queda guardada.</div>
        ${(cli.notas || []).length ? `${bloqueTitulo('Notas de evolución (últimas ' + cli.notas.length + ')')}
          ${cli.notas.map((n) => `<div style="padding:6px 0;border-bottom:1px solid var(--line);font-size:13px;color:var(--ink2)">
            <div class="fila" style="gap:6px;flex-wrap:wrap"><b>${fFecha(n.fecha)}</b><span>${P.esc(n.motivo || 'sin motivo')}</span>${n.estado && n.estado !== 'firmada' ? '<span class="tag tag-deb">borrador</span>' : ''}</div>
            ${n.evaluacion ? `<div style="margin-top:2px">${P.esc(n.evaluacion)}</div>` : ''}
            ${n.plan ? `<div style="margin-top:2px;color:var(--muted)">Plan: ${P.esc(n.plan)}</div>` : ''}
          </div>`).join('')}` : '<div style="margin-top:8px;color:var(--muted);font-size:13px">Sin notas de evolución.</div>'}
        ${(cli.diagnosticos || []).length ? `${bloqueTitulo('Diagnósticos activos')}
          ${cli.diagnosticos.map((x) => `<div class="fila" style="padding:3px 0;gap:6px;font-size:13px;color:var(--ink2)">
            <span>${x.principal ? '★ ' : ''}${P.esc(x.texto)}</span>
            ${x.cie10 ? `<span style="color:var(--muted);font-size:12px">${P.esc(x.cie10)}</span>` : ''}
          </div>`).join('')}` : ''}
        ${(cli.medicacion || []).length ? `${bloqueTitulo('Medicación activa')}
          ${cli.medicacion.map((m) => `<div class="fila" style="padding:3px 0;gap:6px;font-size:13px;color:var(--ink2);flex-wrap:wrap">
            <span><b>${P.esc(m.nombre)}</b>${m.quimiotipo ? ' · ' + P.esc(m.quimiotipo) : ''}${m.ratio ? ' (' + P.esc(m.ratio) + ')' : ''}</span>
            <span style="color:var(--muted);font-size:12px">${P.esc([m.dosis, m.via, m.frecuencia].filter(Boolean).join(' · '))}</span>
          </div>`).join('')}` : ''}
        ${(cli.alergias || []).length ? `${bloqueTitulo('Alergias')}
          ${cli.alergias.map((a) => `<div class="fila" style="padding:3px 0;gap:6px;font-size:13px;color:var(--ink2)">
            <span>${P.esc(a.sustancia)}</span>
            <span style="color:var(--muted);font-size:12px">${P.esc([a.reaccion, a.gravedad].filter(Boolean).join(' · '))}</span>
          </div>`).join('')}` : ''}
      </section>`
      : '<div style="margin-top:10px;font-size:12px;color:var(--muted)">La historia clínica es visible solo para el médico.</div>'

    zona.innerHTML = `
      <section class="sd-bl"><h3 class="sd-bl-t">Consultorio del Dr. Kalb</h3>
        <div style="margin-top:8px;font-size:13px;color:var(--ink2);display:grid;gap:4px">
          <div class="fila" style="gap:6px;flex-wrap:wrap"><b>${P.esc(p.nombre || s.nombre)}</b>
            ${p.obra_social ? `<span class="tag tag-off">${P.esc(p.obra_social)}</span>` : '<span style="color:var(--muted);font-size:12px">sin obra social cargada</span>'}</div>
          <div>Última atención: <b>${res.ultima_atencion ? fFecha(res.ultima_atencion) : 'nunca'}</b> · ${res.consultas_totales || 0} consulta${res.consultas_totales === 1 ? '' : 's'}</div>
          <div>Próximo turno: <b>${res.proximo_turno ? fFecha(res.proximo_turno) + fHora(res.proximo_turno) : 'sin turno agendado'}</b></div>
        </div>
      </section>
      <section class="sd-bl"><h3 class="sd-bl-t">Turnos</h3>
        <div style="margin-top:6px;font-size:13px;color:var(--ink2)">
          ${(d.turnos || []).length ? d.turnos.map(filaTurno).join('') : '<div style="color:var(--muted)">Sin turnos registrados.</div>'}
        </div>
      </section>
      ${rcDifiere ? `<section class="sd-bl"><h3 class="sd-bl-t">REPROCANN según el consultorio</h3>
        <div style="margin-top:6px;font-size:13px;color:var(--ink2);display:grid;gap:3px">
          <div>Estado: <b>${P.esc(rc.estado || 'sin dato')}</b>${rc.vence ? ` · vence ${fFecha(rc.vence)}` : ''}</div>
          ${rc.codigo ? `<div>Código: <b style="letter-spacing:.06em">${P.esc(rc.codigo)}</b></div>` : ''}
          ${rc.tramite ? `<div>Trámite Nº ${P.esc(rc.tramite)}</div>` : ''}
          <div style="color:var(--muted);font-size:12px">Difiere de la ficha del club (solapa Trámite): revisá cuál está al día.</div>
        </div>
      </section>` : ''}
      ${clinicaHtml}
      <div class="fila" style="margin-top:12px">${btnAbrir(p.id)}</div>`
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
    const cumDj = caja.querySelector('#sd-cum-ddjj')
    if (cumDj && ['autocultivo', 'ddjj_pendiente', 'ddjj_firmada', 'conversion'].includes(s.reprocann_estado)) {
      const verif = dec && dec.estado === 'verificada'
      const firm = dec && dec.estado === 'firmada'
      cumDj.className = 'sd-cum ' + (verif ? 'is-ok' : firm ? 'is-warn' : 'is-mal')
      cumDj.innerHTML = `<span class="sd-cum-ico">${verif ? '✓' : firm ? '△' : '✗'}</span><span>Renuncia al autocultivo (art. 4° ter inc. c)</span><span class="sd-cum-det">${verif ? 'firmada y verificada' : firm ? 'firmada · falta verificar' : dec ? 'generada · falta la firma' : 'sin generar'}</span>`
    }
    const faltaDni = !d.socio.documento
    const dom = [d.socio.domicilio, d.socio.localidad, d.socio.provincia].filter(Boolean).join(', ')

    // El chip cuenta en qué momento del proceso está: la firma del socio
    // primero, la verificación del club después. Recién verificada habilita.
    const CHIP = {
      generada: ['tag-deb', 'esperando la firma'],
      firmada: ['tag-auto', 'firmada · falta verificar'],
      verificada: ['tag-ok', 'verificada ✓'],
    }
    const chip = dec ? (CHIP[dec.estado] || CHIP.generada) : null
    const verificada = dec && dec.estado === 'verificada'

    zona.innerHTML = `
      ${dec ? `<div style="margin-bottom:10px">
        <div class="fila" style="flex-wrap:wrap;gap:6px">
          <span class="tag ${chip[0]}">${chip[1]}</span>
          <span style="font-size:12px;color:var(--muted)">generada ${fFecha(dec.generada)}${dec.generada_por ? ' por ' + P.esc(dec.generada_por) : ''}${dec.firmada ? ' · firmada ' + fFecha(dec.firmada) : ''}${verificada && dec.verificada ? ' · verificada ' + fFecha(dec.verificada) + (dec.verificada_por ? ' por ' + P.esc(dec.verificada_por) : '') : ''}</span>
        </div>
        ${dec.firma_texto ? `<div style="font-size:12px;color:var(--muted);margin-top:4px">firmada en el portal como «${P.esc(dec.firma_texto)}»</div>` : ''}
      </div>` : ''}

      ${faltaDni ? '<div class="msg err" style="margin-bottom:6px">Cargale el DNI en Contacto: sin eso la declaración no sirve.</div>' : ''}
      ${!dom ? '<div class="msg" style="margin-bottom:6px;color:var(--ink2)">Completá el domicilio acá abajo o en Contacto.</div>' : ''}

      <div class="campo"><label class="lb">Domicilio para la declaración</label>
        <input class="input" id="sd-dj-dom" placeholder="Calle y número" value="${P.esc(d.socio.domicilio || d.sugerido?.domicilio || '')}" /></div>
      <div class="grid2" style="gap:10px">
        <div class="campo"><label class="lb">Localidad</label>
          <input class="input" id="sd-dj-loc" value="${P.esc(d.socio.localidad || d.sugerido?.localidad || '')}" /></div>
        <div class="campo"><label class="lb">Provincia</label>
          <input class="input" id="sd-dj-prov" value="${P.esc(d.socio.provincia || d.sugerido?.provincia || '')}" /></div>
      </div>
      <div class="campo"><label class="lb">Diagnóstico que funda la prescripción</label>
        <input class="input" id="sd-dj-diag" maxlength="300" placeholder="Tal cual va en el texto: «…acredita la existencia de ___»" value="${P.esc(dec?.nota || d.sugerido?.diagnostico || '')}" /></div>
      ${d.sugerido?.diagnostico && !dec?.nota ? '<p class="so-help" style="margin:2px 0 0;color:var(--ok,#7c6)">Leído del PDF del REPROCANN subido: revisalo antes de generar.</p>' : ''}
      <p class="so-help" style="margin:2px 0 0">Lo escribe ${P.esc(d.plantilla.medico)} (${P.esc(d.plantilla.matricula)}), que es quien firma la prescripción. No queda guardado como dato clínico del padrón.</p>

      <div class="fila" style="margin-top:10px;flex-wrap:wrap">
        ${dec && !verificada && s.telefono ? `<a class="btn" href="${P.esc(waDdjj(s))}" target="_blank" rel="noopener" title="Abre el chat con el mensaje escrito: lo invita a firmar desde su cuenta.">WhatsApp para avisarle</a>` : ''}
        ${dec ? '<a class="btn" id="sd-dj-ver" href="/api/panel/declaracion?socio_id=' + s.id + '&ver=1" target="_blank" rel="noopener">Ver / imprimir</a>' : ''}
        ${dec && ['firmada', 'verificada'].includes(dec.estado) ? '<a class="btn" href="/api/panel/declaracion?declaracion_id=' + dec.id + '&firmada=1" target="_blank" rel="noopener">Ver la firmada</a>' : ''}
        <span class="pn-sp"></span>
        ${dec && dec.estado === 'generada' ? '<button class="btn btn-peligro" id="sd-dj-anular" type="button">Anular</button>' : ''}
        ${dec && !verificada ? '<button class="btn" id="sd-dj-adjuntar" type="button">Adjuntar firmada</button>' : ''}
        ${!dec || !verificada ? `<button class="btn btn-pri" id="sd-dj-generar" type="button" ${faltaDni ? 'disabled' : ''}>${dec ? 'Generar de nuevo' : 'Generar declaración'}</button>` : ''}
        ${dec && dec.estado === 'firmada' && P.puede('reprocann_editar') ? '<button class="btn btn-pri" id="sd-dj-verificar" type="button">Verificar y habilitar</button>' : ''}
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

    // Verificar: el club revisa la firmada y la da por buena. El backend pasa
    // al socio a esperando_codigo (sale del embudo de autocultivo) y recién
    // ahí se le puede habilitar el débito.
    zona.querySelector('#sd-dj-verificar')?.addEventListener('click', async (e) => {
      if (!(await P.confirmar('Vas a dar por buena la DDJJ firmada: el socio deja el autocultivo y sigue el trámite normal. ¿Confirmás?', 'Sí, verificar'))) return
      e.target.disabled = true
      decir('⏳ verificando…')
      const r = await fetch('/api/panel/declaracion', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ declaracion_id: dec.id, verificar: true }),
      })
      const res = await r.json().catch(() => ({}))
      if (!r.ok) { e.target.disabled = false; decir('✗ ' + (res.error || 'no se pudo'), 'err'); return }
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
    let mandarIgual = false
    if (d.reprocann_ok === false) {
      const vedado = ['autocultivo', 'ddjj_pendiente', 'ddjj_firmada'].includes(d.reprocann_estado)
      cuerpo.innerHTML = `<p style="color:var(--ink2);margin:0">El REPROCANN de <b>${P.esc(d.nombre)}</b> está
        <span class="tag tag-deb">${P.esc(d.reprocann_paso || 'sin dato')}</span>. El débito con descuento se ofrece
        normalmente con el trámite subido (aprobado o en evaluación), pero la decisión es tuya.</p>
        ${vedado ? `<p style="color:var(--dan);margin:8px 0 0"><b>Ojo:</b> tiene pendiente la declaración jurada de renuncia
        al autocultivo. Aunque pague, la membresía NO se activa hasta que su declaración esté verificada: la suscripción
        va a quedar esperando en la cola.</p>` : ''}
        <div class="pn-mod-acciones">
          <button class="btn" onclick="Panel.cerrarModal()" type="button">Mejor no</button>
          <button class="btn btn-pri" id="sd-mp-igual" type="button">Mandar igual</button>
        </div>`
      await new Promise((seguir) => cuerpo.querySelector('#sd-mp-igual').addEventListener('click', seguir, { once: true }))
      mandarIgual = true
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
      body: JSON.stringify({ socio_id: d.socio_id, via, tier: elegido.tier, igual: mandarIgual }),
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
