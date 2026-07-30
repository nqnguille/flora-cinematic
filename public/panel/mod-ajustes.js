/* Módulo Accesos (prefijo aj-): quién entra al panel y con qué rol.
   Solo lo ve el presidente (capacidad accesos_gestionar). */
(() => {
  'use strict'
  const P = window.Panel
  const ROLES = [
    ['dueno', 'Presidente', 'Ve y hace todo'],
    ['socio_ong', 'Socio', 'Ve Finanzas y el padrón, sin sueldos'],
    ['socio_ong_carga', 'Socio con carga', 'Además carga movimientos, que esperan tu visto bueno'],
    ['mostrador', 'Mostrador', 'Carga retiros y cobros del día, sin balances'],
  ]
  const NOMBRE_ROL = Object.fromEntries(ROLES.map(([v, n]) => [v, n]))

  let cont = null

  async function cargar() {
    const lista = cont.querySelector('#aj-lista')
    lista.innerHTML = '<div class="vacio">⏳ Cargando…</div>'
    const res = await fetch('/api/panel/accesos', { credentials: 'include' })
    if (!res.ok) { lista.innerHTML = `<div class="vacio">Error ${res.status} al traer los accesos.</div>`; return }
    const { accesos } = await res.json()
    if (!accesos.length) { lista.innerHTML = '<div class="vacio">Nadie tiene acceso todavía.</div>'; return }
    lista.innerHTML = `<table class="tabla"><thead><tr>
        <th>Quién</th><th>Rol</th><th>Alta</th><th class="r"></th>
      </tr></thead><tbody>${accesos.map((a) => `<tr>
        <td><div class="fila"><span class="av">${P.esc(P.iniciales(a.nombre || a.email))}</span>
          <div><div style="font-weight:600">${P.esc(a.nombre || '—')}</div>
          <div style="color:var(--muted);font-size:11.5px">${P.esc(a.email)}</div></div></div></td>
        <td><span class="tag ${a.rol === 'dueno' ? 'tag-auto' : 'tag-off'}">${P.esc(NOMBRE_ROL[a.rol] || a.rol)}</span></td>
        <td style="color:var(--muted)">${P.esc((a.creado || '').slice(0, 10))}</td>
        <td class="r"><button class="btn btn-peligro aj-del" data-email="${P.esc(a.email)}" type="button">Quitar</button></td>
      </tr>`).join('')}</tbody></table>`
  }

  async function alta(e) {
    e.preventDefault()
    const email = cont.querySelector('#aj-email').value.trim().toLowerCase()
    const nombre = cont.querySelector('#aj-nombre').value.trim()
    const rol = cont.querySelector('#aj-rol').value
    const msg = cont.querySelector('#aj-msg')
    msg.className = 'msg'; msg.textContent = '⏳ guardando…'
    const res = await fetch('/api/panel/accesos', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, nombre, rol }),
    })
    if (res.ok) {
      msg.className = 'msg ok'; msg.textContent = '✔ listo'
      cont.querySelector('#aj-form').reset()
      cargar()
    } else {
      const d = await res.json().catch(() => ({}))
      msg.className = 'msg err'; msg.textContent = '✗ ' + (d.error || 'error ' + res.status)
    }
    setTimeout(() => { msg.textContent = '' }, 5000)
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
                <select class="sel" id="aj-rol">${ROLES.map(([v, n, d]) => `<option value="${v}">${n} — ${d}</option>`).join('')}</select></div>
              <div class="fila"><button class="btn btn-pri" type="submit">Dar acceso</button><span id="aj-msg" class="msg"></span></div>
            </form>
            <p style="color:var(--muted);font-size:12px;margin:14px 0 0">Esto controla quién entra a ESTE panel.
            Los pacientes de la carta se gestionan en Socios, no acá.</p>
          </div>
        </div>`
      el.querySelector('#aj-form').addEventListener('submit', alta)
      el.addEventListener('click', async (e) => {
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
