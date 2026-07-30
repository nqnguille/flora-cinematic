/* Placeholders: cada módulo real (mod-finanzas.js, mod-socios.js…) va a
   pisar su registro al cargarse antes que este archivo deje de listarlo.
   Mientras un módulo no exista, la sección muestra qué va a haber ahí. */
(() => {
  'use strict'
  const P = window.Panel
  const PROXIMOS = {
    inicio: ['Resumen del día: reservas activas, retiros de hoy, cobros del día', 'Accesos directos a lo que tiene pendiente tu rol'],
    socios: ['El padrón completo (manda la hoja Pacientes del Excel)', 'Solicitudes de acceso y altas', 'Ficha por socio con su cuenta y su saldo de gramos'],
    reservas: ['Las reservas del portal, con estados y reasignación', 'Ranking de lo más reservado'],
    mostrador: ['Carga de retiro en el momento: socio, gramos, genética', 'Descuenta saldo de gramos y stock solo', 'Cobros del día'],
    catalogo: ['Genéticas, aceites, cremas y extracciones', 'Precios con vigencia y ancla en dólares', 'Stock por ítem con kardex'],
    finanzas: ['Cómo viene el mes: entró, salió, resultado', 'Cobranza depurada (planes prepagos descontados solos)', 'Movimientos, gastos fijos con plantilla, aportes en USD, personal'],
    ajustes: ['Quién entra al panel y con qué rol', 'dueno · socio_ong · socio_ong_carga · mostrador'],
  }
  Object.keys(PROXIMOS).forEach((nombre) => {
    P.registrar(nombre, {
      init(cont) {
        cont.innerHTML = `<div class="card" style="max-width:560px">
          <span class="k">En construcción</span>
          <ul style="margin:12px 0 0;padding-left:18px;color:var(--ink2)">
            ${PROXIMOS[nombre].map((t) => `<li style="margin:6px 0">${P.esc(t)}</li>`).join('')}
          </ul>
        </div>`
      },
    })
  })
})()
