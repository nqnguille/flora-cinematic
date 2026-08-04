// Freno de mano antes de compilar.
//
// El 04/08/2026 se publicó el sitio con el login de socios y el panel de
// admin rotos durante horas: el build salió de un worktree de git, donde el
// .env no existe (está en .gitignore), así que PUBLIC_GOOGLE_CLIENT_ID quedó
// vacío y se horneó vacío en el HTML. El sitio compiló y deployó sin una
// sola advertencia; el único síntoma era "Falta configurar el Google Client
// ID del sitio" en la pantalla de acceso.
//
// Astro reemplaza las import.meta.env.PUBLIC_* en tiempo de compilación: si
// no están, no hay forma de arreglarlo después sin volver a compilar. Por eso
// el chequeo va acá y corta el build, en vez de avisar.

import { existsSync, readFileSync } from 'node:fs'

const REQUERIDAS = [
  {
    nombre: 'PUBLIC_GOOGLE_CLIENT_ID',
    rompe: 'el inicio de sesión con Google en /socios/, /socios/cuenta/, /socios/reprocann/, /socios/carta/ y /admin/',
  },
]

// Astro carga el .env solo; acá lo leemos a mano porque este script corre antes.
const delArchivo = {}
if (existsSync('.env')) {
  for (const linea of readFileSync('.env', 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) delArchivo[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const faltan = REQUERIDAS.filter(({ nombre }) => {
  const v = process.env[nombre] ?? delArchivo[nombre] ?? ''
  return !v.trim()
})

if (faltan.length) {
  console.error('\n  ✖ No se puede compilar: faltan variables de entorno.\n')
  for (const { nombre, rompe } of faltan) {
    console.error(`    ${nombre}`)
    console.error(`      Sin esto se rompe ${rompe}.\n`)
  }
  console.error('    Si estás compilando desde un worktree de git, copiá el .env:')
  console.error('      cp ~/proyectos/flora-cinematic/.env .\n')
  process.exit(1)
}
