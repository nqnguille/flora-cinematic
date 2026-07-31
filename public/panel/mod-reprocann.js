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

  P.registrar('reprocann', {
    init(el) {
      cont = el
      el.innerHTML = `
        <p class="so-help" style="max-width:78ch;margin:0 0 14px">El trámite pasa por manos del paciente,
        de Ezequiel, nuestras y del Ministerio. Acá se ve <b>de quién depende cada uno hoy</b> — el club es
        responsable del último paso: vincular al paciente como su cultivador con el mismo código.</p>
        <div id="rc-cuerpo"></div>`
      el.addEventListener('click', (e) => {
        const b = e.target.closest('.rc-editar')
        if (b) modalEditar(b.dataset.id, b.dataset.nombre)
      })
      cargar()
    },
  })
})()
