/* Módulo Accesos (prefijo aj-): quién entra al panel y con qué rol.
   Solo lo ve el presidente (capacidad accesos_gestionar).
   El catálogo de roles (etiqueta + descripción) viene del server para que
   haya UNA sola definición (functions/api/panel/_rol.ts). */
(() => {
  'use strict'
  const P = window.Panel

  let cont = null
  let ROLES = []   // [{rol, etiqueta, descripcion}] — llega con el GET
  const nombreRol = (v) => (ROLES.find((r) => r.rol === v) || {}).etiqueta || v

  function pintarSelector() {
    const sel = cont.querySelector('#aj-rol')
    sel.innerHTML = ROLES.map((r) => `<option value="${r.rol}">${P.esc(r.etiqueta)}</option>`).join('')
    pintarAyuda()
  }
  function pintarAyuda() {
    const v = cont.querySelector('#aj-rol').value
    const r = ROLES.find((x) => x.rol === v)
    cont.querySelector('#aj-rol-ayuda').textContent = r ? r.descripcion + '.' : ''
  }

  async function cargar() {
    const lista = cont.querySelector('#aj-lista')
    lista.innerHTML = '<div class="vacio">⏳ Cargando…</div>'
    const res = await fetch('/api/panel/accesos', { credentials: 'include' })
    if (!res.ok) { lista.innerHTML = `<div class="vacio">Error ${res.status} al traer los accesos.</div>`; return }
    const d = await res.json()
    if (Array.isArray(d.roles) && d.roles.length) { ROLES = d.roles; pintarSelector() }
    const accesos = d.accesos || []
    if (!accesos.length) { lista.innerHTML = '<div class="vacio">Nadie tiene acceso todavía.</div>'; return }
    const yo = (P.me && P.me.email) || ''
    lista.innerHTML = `<table class="tabla"><thead><tr>
        <th>Quién</th><th>Rol</th><th>Alta</th><th class="r"></th>
      </tr></thead><tbody>${accesos.map((a) => `<tr>
        <td><div class="fila"><span class="av">${P.esc(P.iniciales(a.nombre || a.email))}</span>
          <div><div style="font-weight:600">${P.esc(a.nombre || '—')}${a.email === yo ? ' <span style="color:var(--muted);font-weight:400;font-size:11px">(vos)</span>' : ''}</div>
          <div style="color:var(--muted);font-size:11.5px">${P.esc(a.email)}</div></div></div></td>
        <td><span class="tag ${a.rol === 'dueno' ? 'tag-auto' : 'tag-off'}" title="${P.esc((ROLES.find((r) => r.rol === a.rol) || {}).descripcion || '')}">${P.esc(nombreRol(a.rol))}</span></td>
        <td style="color:var(--muted)">${P.esc((a.creado || '').slice(0, 10))}</td>
        <td class="r">${a.email === yo ? '' : `<button class="btn aj-editar" data-email="${P.esc(a.email)}" data-nombre="${P.esc(a.nombre || '')}" data-rol="${P.esc(a.rol)}" type="button">Cambiar rol</button>
          <button class="btn btn-peligro aj-del" data-email="${P.esc(a.email)}" type="button">Quitar</button>`}</td>
      </tr>`).join('')}</tbody></table>`
  }

  async function guardar(email, nombre, rol, msgSel) {
    const msg = cont.querySelector(msgSel)
    if (msg) { msg.className = 'msg'; msg.textContent = '⏳ guardando…' }
    const res = await fetch('/api/panel/accesos', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, nombre, rol }),
    })
    const d = await res.json().catch(() => ({}))
    if (msg) {
      msg.className = res.ok ? 'msg ok' : 'msg err'
      msg.textContent = res.ok ? '✔ listo' : '✗ ' + (d.error || 'error ' + res.status)
      setTimeout(() => { msg.textContent = '' }, 5000)
    }
    return res.ok ? null : (d.error || 'error ' + res.status)
  }

  async function alta(e) {
    e.preventDefault()
    const email = cont.querySelector('#aj-email').value.trim().toLowerCase()
    const nombre = cont.querySelector('#aj-nombre').value.trim()
    const rol = cont.querySelector('#aj-rol').value
    const err = await guardar(email, nombre, rol, '#aj-msg')
    if (!err) { cont.querySelector('#aj-form').reset(); pintarAyuda(); cargar() }
  }

  function modalCambiarRol(email, nombre, rolActual) {
    const ov = P.modal(`Rol de ${nombre || email}`, `
      <div style="display:grid;gap:8px">${ROLES.map((r) => `
        <label class="fila" style="gap:10px;align-items:flex-start;cursor:pointer;padding:8px;border:1px solid var(--line);border-radius:8px">
          <input type="radio" name="aj-mr" value="${r.rol}" ${r.rol === rolActual ? 'checked' : ''} style="margin-top:3px" />
          <span><b>${P.esc(r.etiqueta)}</b><br /><span style="color:var(--muted);font-size:12px">${P.esc(r.descripcion)}</span></span>
        </label>`).join('')}
      </div>
      <div class="pn-mod-acciones">
        <button class="btn" onclick="Panel.cerrarModal()" type="button">Cancelar</button>
        <button class="btn btn-pri" id="aj-mr-ok" type="button">Guardar</button>
      </div>`)
    ov.querySelector('#aj-mr-ok').addEventListener('click', async () => {
      const v = ov.querySelector('input[name="aj-mr"]:checked')
      if (!v) return
      const err = await guardar(email, nombre || null, v.value, null)
      P.cerrarModal()
      if (err) {
        P.modal('No se pudo', `<p style="color:var(--ink2)">${P.esc(err)}</p>
          <div class="pn-mod-acciones"><button class="btn btn-pri" onclick="Panel.cerrarModal()" type="button">Entendido</button></div>`)
      }
      cargar()
    })
  }

  P.registrar('ajustes', {
    init(el) {
      cont = el
      el.innerHTML = `
        <div class="grid2" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);align-items:start">
          <div class="card">
            <span class="k">Accesos al panel</span>
            <div id="aj-lista" style="margin-top:12px"></div>
          </div>
          <div class="card">
            <span class="k">Dar acceso</span>
            <form id="aj-form" style="display:grid;gap:10px;margin-top:12px">
              <div><label class="lb" for="aj-email">Email (cuenta de Google)</label>
                <input class="input" id="aj-email" type="email" required placeholder="persona@gmail.com" /></div>
              <div><label class="lb" for="aj-nombre">Nombre</label>
                <input class="input" id="aj-nombre" type="text" placeholder="Cómo lo ves en el panel" /></div>
              <div><label class="lb" for="aj-rol">Rol</label>
                <select class="sel" id="aj-rol"></select>
                <p class="so-help" id="aj-rol-ayuda" style="margin:6px 0 0"></p></div>
              <div class="fila"><button class="btn btn-pri" type="submit">Dar acceso</button><span id="aj-msg" class="msg"></span></div>
            </form>
            <p style="color:var(--muted);font-size:12px;margin:14px 0 0">Esto controla quién entra a ESTE panel.
            Los pacientes de la carta se gestionan en Socios, no acá.</p>
          </div>
        </div>`
      el.querySelector('#aj-form').addEventListener('submit', alta)
      el.querySelector('#aj-rol').addEventListener('change', pintarAyuda)
      el.addEventListener('click', async (e) => {
        const ed = e.target.closest('.aj-editar')
        if (ed) { modalCambiarRol(ed.dataset.email, ed.dataset.nombre, ed.dataset.rol); return }
        const b = e.target.closest('.aj-del')
        if (!b) return
        const email = b.dataset.email
        if (!(await P.confirmar(`¿Quitarle el acceso al panel a ${email}?`, 'Sí, quitar'))) return
        const res = await fetch('/api/panel/accesos', {
          method: 'DELETE', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          P.modal('No se pudo', `<p style="color:var(--ink2)">${P.esc(d.error || 'Error ' + res.status)}</p>
            <div class="pn-mod-acciones"><button class="btn btn-pri" onclick="Panel.cerrarModal()" type="button">Entendido</button></div>`)
          return
        }
        cargar()
      })
      cargar()
    },
  })
})()
