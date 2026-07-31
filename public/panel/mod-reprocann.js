/* Módulo REPROCANN (prefijo rc-): el embudo del trámite de cada socio.
   La pregunta que contesta no es "en qué estado está" sino "a quién hay que
   empujar hoy": el paciente, Ezequiel, nosotros o el Ministerio. */
(() => {
  'use strict'
  const P = window.Panel

  let cont = null
  let datos = null
  let filtro = 'accionables'
  let q = ''

  const QUIEN = {
    paciente: { txt: 'Le toca al paciente', cls: 'tag-deb' },
    medico: { txt: 'Le toca a Ezequiel', cls: 'tag-auto' },
    club: { txt: 'Nos toca a nosotros', cls: 'tag-mal' },
    organismo: { txt: 'Espera al Ministerio', cls: 'tag-off' },
    '—': { txt: '', cls: 'tag-ok' },
  }

  async function cargar() {
    const cuerpo = cont.querySelector('#rc-cuerpo')
    cuerpo.innerHTML = '<div class="vacio">⏳ Cargando el embudo…</div>'
    const r = await fetch('/api/panel/reprocann/embudo', { credentials: 'include' })
    if (!r.ok) { cuerpo.innerHTML = `<div class="vacio">El servidor respondió ${r.status}.</div>`; return }
    datos = await r.json()
    pintar()
  }

  function pintar() {
    const pasos = Object.fromEntries(datos.pasos.map((p) => [p.id, p]))
    const cuenta = {}
    for (const s of datos.socios) cuenta[s.reprocann_estado] = (cuenta[s.reprocann_estado] || 0) + 1

    const nosToca = datos.socios.filter((s) => (pasos[s.reprocann_estado] || {}).quien === 'club').length
    const alPaciente = datos.socios.filter((s) => (pasos[s.reprocann_estado] || {}).quien === 'paciente').length
    const alMedico = datos.socios.filter((s) => (pasos[s.reprocann_estado] || {}).quien === 'medico').length

    let lista = datos.socios
    if (filtro === 'accionables') lista = lista.filter((s) => ['club', 'paciente', 'medico'].includes((pasos[s.reprocann_estado] || {}).quien))
    else if (filtro !== 'todos') lista = lista.filter((s) => (pasos[s.reprocann_estado] || {}).quien === filtro)
    if (q) lista = lista.filter((s) => (s.nombre + ' ' + (s.email || '')).toLowerCase().includes(q))

    const hace = (iso) => {
      if (!iso) return 'nunca'
      const d = Math.floor((Date.now() - Date.parse(iso.replace(' ', 'T') + 'Z')) / 86400000)
      return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`
    }

    cont.querySelector('#rc-cuerpo').innerHTML = `
      <div class="grid3" style="margin-bottom:14px">
        <div class="card rc-tile" data-f="club" style="border-left:3px solid var(--dan)">
          <span class="k">Nos toca a nosotros</span><div class="kpi-v" style="font-size:30px;color:var(--dan)">${nosToca}</div>
          <div class="kpi-d">vincular como cultivadora o definir</div></div>
        <div class="card rc-tile" data-f="paciente" style="border-left:3px solid var(--amb)">
          <span class="k">Le toca al paciente</span><div class="kpi-v" style="font-size:30px;color:var(--amb)">${alPaciente}</div>
          <div class="kpi-d">su código o su firma del consentimiento</div></div>
        <div class="card rc-tile" data-f="medico" style="border-left:3px solid var(--vio)">
          <span class="k">Le toca a Ezequiel</span><div class="kpi-v" style="font-size:30px;color:var(--vio)">${alMedico}</div>
          <div class="kpi-d">cargar el trámite o corregirlo</div></div>
      </div>
      ${datos.porVencer ? `<div class="card" style="border-left:3px solid var(--amb);margin-bottom:14px">
        <span class="k">Vencimientos</span><div class="kpi-d" style="margin-top:6px">
        <b>${datos.porVencer}</b> certificado(s) vencen en menos de 60 días — el de persona jurídica dura 1 año y no se renueva solo.</div></div>` : ''}

      <div class="fila" style="margin-bottom:10px;flex-wrap:wrap">
        ${[['accionables', 'Hay algo que hacer'], ['club', 'Nosotros'], ['paciente', 'Paciente'], ['medico', 'Ezequiel'], ['organismo', 'Ministerio'], ['todos', 'Todos']]
          .map(([v, n]) => `<button class="chip ${filtro === v ? 'on' : ''}" data-f="${v}" type="button">${n}</button>`).join('')}
        <span class="pn-sp"></span>
        <input class="input" id="rc-buscar" type="search" placeholder="Buscar socio…" value="${P.esc(q)}" style="max-width:220px" />
      </div>

      <div class="card" style="padding-bottom:6px">${lista.length ? `<table class="tabla"><thead><tr>
        <th>Socio</th><th>Paso</th><th>De quién depende</th><th>Código</th><th>Sin moverse</th><th class="r"></th>
      </tr></thead><tbody>${lista.map((s) => {
        const p = pasos[s.reprocann_estado] || { nombre: s.reprocann_estado, quien: '—', ayuda: '' }
        const qn = QUIEN[p.quien] || QUIEN['—']
        return `<tr title="${P.esc(p.ayuda)}">
          <td><div class="fila"><span class="av">${P.esc(P.iniciales(s.nombre))}</span>
            <div><div style="font-weight:600">${P.esc(s.nombre)}</div>
            ${s.reprocann_nota ? `<div style="color:var(--muted);font-size:11px">${P.esc(s.reprocann_nota)}</div>` : ''}</div></div></td>
          <td>${P.esc(p.nombre)}</td>
          <td>${qn.txt ? `<span class="tag ${qn.cls}">${qn.txt}</span>` : '<span class="tag tag-ok">al día</span>'}</td>
          <td style="font-family:var(--font-ui);letter-spacing:.06em;color:${s.reprocann_codigo ? 'var(--grn)' : 'var(--muted)'}">${s.reprocann_codigo ? P.esc(s.reprocann_codigo) : '—'}</td>
          <td style="color:var(--muted)">${hace(s.reprocann_actualizado)}</td>
          <td class="r">
            ${s.telefono ? `<a class="btn" target="_blank" rel="noopener" href="${P.esc(waDe(s, p))}">WhatsApp</a>` : ''}
            <button class="btn rc-editar" data-id="${s.id}" data-nombre="${P.esc(s.nombre)}" type="button">Editar</button>
          </td>
        </tr>`
      }).join('')}</tbody></table>` : '<div class="vacio">Nadie en este filtro.</div>'}</div>`

    cont.querySelectorAll('.rc-tile').forEach((t) => t.addEventListener('click', () => { filtro = t.dataset.f; pintar() }))
    cont.querySelectorAll('.chip[data-f]').forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.f; pintar() }))
    const buscar = cont.querySelector('#rc-buscar')
    buscar.addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); pintar(); cont.querySelector('#rc-buscar').focus() })
  }

  // El mensaje ya escrito según de qué depende: el empujón es el producto.
  function waDe(s, paso) {
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

  function modalEditar(id, nombre) {
    const s = datos.socios.find((x) => x.id === Number(id)) || {}
    const ov = P.modal(`REPROCANN — ${nombre}`, `
      <div style="display:grid;gap:10px">
        <div><label class="lb" for="rc-e-paso">Paso</label><select class="sel" id="rc-e-paso">
          ${datos.pasos.map((p) => `<option value="${p.id}" ${s.reprocann_estado === p.id ? 'selected' : ''}>${P.esc(p.nombre)}</option>`).join('')}
        </select></div>
        <div class="grid2">
          <div><label class="lb" for="rc-e-cod">Código de vinculación</label>
            <input class="input" id="rc-e-cod" maxlength="13" value="${P.esc(s.reprocann_codigo || '')}" placeholder="13 caracteres" style="letter-spacing:.08em" /></div>
          <div><label class="lb" for="rc-e-tram">Nº de trámite</label>
            <input class="input" id="rc-e-tram" type="number" value="${P.esc(s.reprocann_tramite || '')}" placeholder="Ej. 434210" /></div>
        </div>
        <div class="grid2">
          <div><label class="lb" for="rc-e-vence">Vence</label>
            <input class="input" id="rc-e-vence" type="date" value="${P.esc((s.reprocann_vence || '').slice(0, 10))}" /></div>
          <div><label class="lb" for="rc-e-nota">Nota</label>
            <input class="input" id="rc-e-nota" value="${P.esc(s.reprocann_nota || '')}" placeholder="Quién gestiona, detalles…" /></div>
        </div>
        <div class="fila"><button class="btn btn-pri" id="rc-e-ok" type="button">Guardar</button><span class="msg" id="rc-e-msg"></span></div>
      </div>`)
    ov.querySelector('#rc-e-ok').addEventListener('click', async () => {
      const msg = ov.querySelector('#rc-e-msg')
      msg.className = 'msg'; msg.textContent = '⏳ guardando…'
      const r = await fetch('/api/panel/reprocann/socio', {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: Number(id),
          estado: ov.querySelector('#rc-e-paso').value,
          codigo: ov.querySelector('#rc-e-cod').value.trim(),
          tramite: ov.querySelector('#rc-e-tram').value || null,
          vence: ov.querySelector('#rc-e-vence').value || null,
          nota: ov.querySelector('#rc-e-nota').value.trim(),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) { msg.className = 'msg ok'; msg.textContent = '✔ guardado'; setTimeout(() => { P.cerrarModal(); cargar() }, 700) }
      else { msg.className = 'msg err'; msg.textContent = '✗ ' + (d.error || 'error') }
    })
  }

  // ============ Unificar pacientes (ru-): el volcado oficial del portal ============
  // El portal de REPROCANN (cuenta de la ONG) es la única fuente con el DNI
  // oficial de cada trámite. El volcado entra acá, el matching propone pares
  // contra el padrón y CADA vínculo se confirma a mano. Una vez confirmado,
  // los volcados siguientes actualizan a ese socio solos.
  let ruDatos = null

  const RU_ESTADOS = {
    Aprobado: ['Aprobado', 'tag-ok'], PendienteEvaluacion: ['En evaluación', 'tag-off'],
    PendienteConsentimientoPaciente: ['Espera su firma', 'tag-deb'], PendienteConsentimiento: ['Espera su firma', 'tag-deb'],
    ObservadoPorPaciente: ['Observado', 'tag-deb'], PendienteVinculacionCultivador: ['Nos toca vincular', 'tag-mal'],
    PendienteRevisionMedica: ['Volvió al médico', 'tag-auto'], Rechazado: ['Rechazado', 'tag-mal'], Anulado: ['Anulado', 'tag-mal'],
  }
  const ruEstado = (e) => {
    const [txt, cls] = RU_ESTADOS[e] || [e, 'tag-off']
    return `<span class="tag ${cls}">${P.esc(txt)}</span>`
  }
  const CHIP = {
    dni: ['DNI', 'tag-ok'], nombre: ['nombre', 'tag-auto'], nombre_parcial: ['nombre parcial', 'tag-deb'],
  }
  const ruChips = (sen) => {
    if (!sen) return ''
    const m = (sen.match || []).map((s) => { const [t, c] = CHIP[s] || [s, 'tag-off']; return `<span class="tag ${c}">${t}</span>` })
    const conf = (sen.conflictos || []).map((s) => `<span class="tag tag-mal">${s === 'dni' ? 'DNI distinto' : P.esc(s)}</span>`)
    return m.concat(conf).join(' ')
  }

  async function ruCargar() {
    const caja = cont.querySelector('#ru-panel')
    caja.innerHTML = '<div class="vacio">⏳ Buscando pares…</div>'
    const r = await fetch('/api/panel/reprocann/unificar', { credentials: 'include' })
    if (!r.ok) { caja.innerHTML = `<div class="vacio">El servidor respondió ${r.status}.</div>`; return }
    ruDatos = await r.json()
    ruPintar()
  }

  function ruPintar() {
    const d = ruDatos
    const caja = cont.querySelector('#ru-panel')
    const simples = d.pares.filter((g) => g.candidatos.length === 1 && (g.candidatos[0].senales || {}).confianza !== 'revisar')
    const revisar = d.pares.filter((g) => g.candidatos.length > 1 || (g.candidatos[0].senales || {}).confianza === 'revisar')
    const cnt = cont.querySelector('#ru-cnt')
    if (cnt) { cnt.hidden = !d.pares.length; cnt.textContent = d.pares.length }

    caja.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <span class="k">Volcado del portal</span>
        <p class="so-help" style="margin:6px 0 8px">Pegá el JSON de trámites del portal de REPROCANN (cuenta de la ONG)
        o subí el archivo. Cada carga actualiza sola a los ${d.vinculados} socio(s) ya vinculados y propone pares nuevos.
        ${d.ultimaCarga ? `Última carga: ${P.esc(d.ultimaCarga.slice(0, 16).replace('T', ' '))}.` : 'Todavía no se cargó ninguno.'}</p>
        <div class="fila" style="flex-wrap:wrap;gap:8px">
          <textarea class="input" id="ru-json" rows="2" placeholder='Pegar acá el JSON…' style="flex:1;min-width:220px;font-size:11.5px;font-family:var(--font-ui)"></textarea>
          <input type="file" id="ru-file" accept="application/json,.json" hidden />
          <button class="btn" id="ru-subir" type="button">Subir archivo</button>
          <button class="btn btn-pri" id="ru-procesar" type="button">Procesar</button>
        </div>
        <p class="msg" id="ru-msg" style="margin:8px 0 0"></p>
      </div>

      ${simples.length ? `<div class="card" style="margin-bottom:14px;border-left:3px solid var(--vio)">
        <span class="k">Pares por confirmar (${simples.length})</span>
        <p class="so-help">El matching dice que son la misma persona. Nada se une sin tu click.</p>
        ${simples.map((g) => ruFila(g, g.candidatos[0])).join('')}
      </div>` : ''}

      ${revisar.length ? `<div class="card" style="margin-bottom:14px;border-left:3px solid var(--amb)">
        <span class="k">Revisar con cuidado (${revisar.length})</span>
        <p class="so-help">Datos que se contradicen o más de un socio posible — mirá bien antes de confirmar.</p>
        ${revisar.map((g) => g.candidatos.length === 1 ? ruFila(g, g.candidatos[0], true)
          : `<div style="padding:9px 0;border-top:1px solid var(--line)">
              <div><b>${P.esc(g.persona.nombre + ' ' + g.persona.apellido)}</b>
                <span style="color:var(--muted)">· DNI ${P.esc(g.dni)}</span> ${ruEstado(g.persona.estado)}</div>
              <div class="so-help" style="margin:4px 0 6px">¿Cuál de estos socios es?</div>
              ${g.candidatos.map((c) => `<div class="fila" style="padding:4px 0">
                <span>${P.esc(c.socio.nombre)}${c.socio.email ? ` <span style="color:var(--muted);font-size:11px">${P.esc(c.socio.email)}</span>` : ''} ${ruChips(c.senales)}</span>
                <span class="pn-sp"></span>
                <button class="btn ru-si" data-dni="${P.esc(g.dni)}" data-socio="${c.socio_id}" type="button">Es él</button>
              </div>`).join('')}
              <div class="fila" style="padding:4px 0"><span class="pn-sp"></span>
                <button class="btn ru-ninguno" data-dni="${P.esc(g.dni)}" data-socios="${g.candidatos.map((c) => c.socio_id).join(',')}" type="button">Ninguno de estos</button></div>
            </div>`).join('')}
      </div>` : ''}

      ${!simples.length && !revisar.length ? `<div class="card" style="margin-bottom:14px"><div class="vacio">
        No hay pares pendientes${d.vinculados ? ` — ${d.vinculados} socio(s) vinculados se actualizan solos con cada volcado` : ''}.</div></div>` : ''}

      ${d.sinMatch.length ? `<details class="card" style="margin-bottom:14px">
        <summary style="cursor:pointer;font-weight:600;font-size:13px">Sin match en el padrón (${d.sinMatch.length})</summary>
        <p class="so-help" style="margin-top:8px">Trámites de la ONG cuya persona no se parece a ningún socio.
        Con «Dar de alta» se abre el alta de socio ya precargada con su nombre y DNI oficiales.</p>
        <table class="tabla"><thead><tr><th>Persona</th><th>DNI</th><th>Trámite</th><th>Vence</th><th class="r"></th></tr></thead>
        <tbody>${d.sinMatch.map((p) => `<tr>
          <td><b>${P.esc(p.nombre + ' ' + p.apellido)}</b>${p.renovacion ? ' <span class="tag tag-off">renovación</span>' : ''}</td>
          <td style="font-family:var(--font-ui)">${P.esc(p.dni)}</td>
          <td>${ruEstado(p.estado)}${p.plantas ? ` <span style="color:var(--muted);font-size:11px">${p.plantas} plantas</span>` : ''}</td>
          <td style="color:var(--muted)">${p.vence ? P.esc(p.vence) : '—'}</td>
          <td class="r"><button class="btn ru-alta" data-dni="${P.esc(p.dni)}" type="button">Dar de alta</button></td>
        </tr>`).join('')}</tbody></table>
      </details>` : ''}`

    const msg = caja.querySelector('#ru-msg')
    const file = caja.querySelector('#ru-file')
    caja.querySelector('#ru-subir').addEventListener('click', () => file.click())
    file.addEventListener('change', async () => {
      if (file.files[0]) caja.querySelector('#ru-json').value = await file.files[0].text()
    })
    caja.querySelector('#ru-procesar').addEventListener('click', async () => {
      let crudo
      try { crudo = JSON.parse(caja.querySelector('#ru-json').value) } catch {
        msg.className = 'msg err'; msg.textContent = '✗ Eso no es un JSON válido — copialo entero, sin recortar.'; return
      }
      msg.className = 'msg'; msg.textContent = '⏳ procesando…'
      const r = await fetch('/api/panel/reprocann/sincronizar', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(crudo),
      })
      const res = await r.json().catch(() => ({}))
      if (!r.ok) { msg.className = 'msg err'; msg.textContent = '✗ ' + (res.error || 'error ' + r.status); return }
      msg.className = 'msg ok'
      msg.textContent = `✔ ${res.personas} persona(s) del portal · ${res.sincronizados} actualizadas solas · ${res.candidatosNuevos} par(es) nuevos por confirmar`
      setTimeout(() => { ruCargar(); cargar() }, 900)
    })
  }

  function ruFila(g, c, cuidado) {
    return `<div class="fila" style="padding:9px 0;border-top:1px solid var(--line);flex-wrap:wrap">
      <span><b>${P.esc(c.socio.nombre)}</b>${c.socio.email ? ` <span style="color:var(--muted);font-size:11px">${P.esc(c.socio.email)}</span>` : ''}
        <span style="color:var(--muted)"> ↔ </span>
        <b>${P.esc(g.persona.nombre + ' ' + g.persona.apellido)}</b>
        <span style="color:var(--muted)">· DNI ${P.esc(g.dni)}</span>
        ${ruEstado(g.persona.estado)}${g.persona.vence ? ` <span style="color:var(--muted);font-size:11px">vence ${P.esc(g.persona.vence)}</span>` : ''}
        ${ruChips(c.senales)}</span>
      <span class="pn-sp"></span>
      <button class="btn ru-si ${cuidado ? '' : 'btn-pri'}" data-dni="${P.esc(g.dni)}" data-socio="${c.socio_id}" ${cuidado ? 'data-cuidado="1"' : ''} type="button">Sí, es él</button>
      <button class="btn ru-no" data-dni="${P.esc(g.dni)}" data-socio="${c.socio_id}" type="button">No es</button>
    </div>`
  }

  async function ruDecidir(body, boton) {
    if (boton) boton.disabled = true
    const r = await fetch('/api/panel/reprocann/vinculo', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { alert(d.error || 'No se pudo: error ' + r.status); if (boton) boton.disabled = false; return }
    if (d.avisoDni) alert(d.avisoDni)
    ruCargar()
    cargar()
  }

  P.registrar('reprocann', {
    init(el) {
      cont = el
      const puedeUnificar = P.puede('padron_editar')
      el.innerHTML = `
        <p class="so-help" style="max-width:78ch;margin:0 0 14px">El trámite pasa por manos del paciente,
        de Ezequiel, nuestras y del Ministerio. Acá se ve <b>de quién depende cada uno hoy</b> — el club es
        responsable del último paso: vincular al paciente como su cultivador con el mismo código.</p>
        ${puedeUnificar ? `<div class="fila" style="margin:0 0 14px">
          <button class="btn" id="ru-btn" type="button">Unificar pacientes<span class="cnt" id="ru-cnt" hidden
            style="margin-left:7px;background:var(--dan);color:#fff;border-radius:999px;padding:1px 7px;font-size:10.5px"></span></button>
        </div>
        <div id="ru-panel" hidden></div>` : ''}
        <div id="rc-cuerpo"></div>`
      el.addEventListener('click', (e) => {
        const b = e.target.closest('.rc-editar')
        if (b) { modalEditar(b.dataset.id, b.dataset.nombre); return }
        const si = e.target.closest('.ru-si')
        if (si) {
          if (si.dataset.cuidado && !confirm('Los datos no coinciden del todo. ¿Vincular igual?')) return
          ruDecidir({ dni: si.dataset.dni, socio_id: Number(si.dataset.socio), aceptar: true }, si); return
        }
        const no = e.target.closest('.ru-no')
        if (no) { ruDecidir({ dni: no.dataset.dni, socio_id: Number(no.dataset.socio), aceptar: false }, no); return }
        const ning = e.target.closest('.ru-ninguno')
        if (ning) { ruDecidir({ dni: ning.dataset.dni, rechazar_socio_ids: ning.dataset.socios.split(',').map(Number) }, ning); return }
        const alta = e.target.closest('.ru-alta')
        if (alta) {
          const p = (ruDatos.sinMatch || []).find((x) => x.dni === alta.dataset.dni)
          if (!p) return
          const PASO = { Aprobado: 'aprobado', PendienteEvaluacion: 'en_evaluacion', PendienteVinculacionCultivador: 'cargado', PendienteConsentimientoPaciente: 'cargado', PendienteConsentimiento: 'cargado', ObservadoPorPaciente: 'cargado', PendienteRevisionMedica: 'en_evaluacion' }
          sessionStorage.setItem('so-alta-prefill', JSON.stringify({
            nombre: `${p.nombre} ${p.apellido}`.trim(), documento: p.dni,
            reprocann_estado: PASO[p.estado] || 'esperando_codigo', reprocann_vence: p.vence || '',
          }))
          P.ir('socios')
          // si el módulo Socios ya estaba inicializado, su init no vuelve a
          // correr: el evento le avisa que abra el alta con la precarga
          setTimeout(() => window.dispatchEvent(new Event('so-alta-prefill')), 50)
        }
      })
      const btn = el.querySelector('#ru-btn')
      if (btn) btn.addEventListener('click', () => {
        const panel = el.querySelector('#ru-panel')
        panel.hidden = !panel.hidden
        btn.classList.toggle('btn-pri', !panel.hidden)
        if (!panel.hidden) ruCargar()
      })
      // el badge de pendientes, sin abrir el panel
      if (puedeUnificar) fetch('/api/panel/reprocann/unificar', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return
          ruDatos = d
          const cnt = el.querySelector('#ru-cnt')
          if (cnt) { cnt.hidden = !d.pares.length; cnt.textContent = d.pares.length }
        })
        .catch(() => { /* sin red no hay badge */ })
      cargar()
    },
  })
})()
