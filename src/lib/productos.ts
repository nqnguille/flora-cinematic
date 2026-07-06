// ═══════════════════════════════════════════════
// CATÁLOGO DE PRODUCTOS — fuente única
// La landing pública y el portal de socios leen de acá.
// Los PRECIOS NO viven acá: están en KV (key 'precios'),
// solo visibles vía /api/socios/precios con sesión de socio.
// ═══════════════════════════════════════════════

export const WA = 'https://wa.me/5492996375723'
export const wa = (t: string) => `${WA}?text=${encodeURIComponent(t)}`

// Ficha técnica según cromatografía del último lote (HPLC-UV, IACA, 02/06/2026)
export const aceites = [
  {
    id: 'aceite-q1',
    codigo: 'Q1',
    sub: 'Quimiotipo I · THC predominante',
    desc: 'Perfil de THC alto con presencia de CBG. Pensado para uso nocturno y dolor intenso, siempre con el equipo orientando la dosis.',
    perfil: [
      { k: 'CBD', v: '21,8' },
      { k: 'THC', v: '51,0' },
      { k: 'CBG', v: '6,9' },
    ],
    para: ['Dolor agudo o intenso', 'Insomnio severo', 'Náuseas y falta de apetito'],
    pdf: '/analisis/Q1.pdf',
    img: '/img/prod-aceite-q1.jpg',
    color: '#C9396B',
    ratio: 'THC:CBD ≈ 3:1',
    href: wa('Hola Flora, me interesa el aceite Q1 🌿'),
  },
  {
    id: 'aceite-q2',
    codigo: 'Q2',
    sub: 'Quimiotipo II · CBD:THC balanceado',
    desc: 'Relación equilibrada entre CBD y THC. Acompaña el día y la noche. El elegido por quienes ya tienen su tratamiento calibrado.',
    perfil: [
      { k: 'CBD', v: '23,9' },
      { k: 'THC', v: '17,0' },
      { k: 'CBG', v: '1,3' },
    ],
    para: ['Dolor crónico y artritis', 'Migrañas', 'Dolores menstruales'],
    pdf: '/analisis/Q2.pdf',
    img: '/img/prod-aceite-q2.jpg',
    color: '#6E54C8',
    ratio: 'THC:CBD ≈ 1:1',
    href: wa('Hola Flora, me interesa el aceite Q2 🌿'),
  },
  {
    id: 'aceite-q3',
    codigo: 'Q3',
    sub: 'Quimiotipo III · CBD predominante',
    desc: 'CBD alto y THC casi nulo, de efecto suave. Ideal para el día, la ansiedad y para empezar con un perfil liviano.',
    perfil: [
      { k: 'CBD', v: '32,6' },
      { k: 'THC', v: '1,2' },
      { k: 'CBG', v: '0,3' },
    ],
    para: ['Ansiedad y estrés', 'Dificultad para dormir', 'Dolor neuropático'],
    pdf: '/analisis/Q3.pdf',
    img: '/img/prod-aceite-q3.jpg',
    color: '#1F9389',
    ratio: 'THC:CBD ≈ 1:20',
    href: wa('Hola Flora, me interesa el aceite Q3 🌿'),
  },
]

export const cremas = [
  {
    id: 'crema-30',
    nombre: 'Crema de CBD premium',
    presentacion: '1 g CBD · 30 ml',
    desc: 'Para alivio localizado, en tu rutina diaria.',
    para: ['Dolores articulares y musculares', 'Contracturas y tensión localizada', 'Uso diario, sin efecto psicoactivo'],
    img: '/img/prod-cremas.jpg',
    href: wa('Hola Flora, quiero consultar por la crema 🌿'),
  },
]

export const extracciones = [
  {
    id: 'cartucho-1ml-thc',
    nombre: 'Cartucho 1 ml',
    detalle: 'THC',
    badge: '1 ml',
    color: '#6E54C8',
    img: '/img/prod-cartucho-1ml.webp',
    desc: 'Extracto de THC en 1 ml: vaporizás en vez de fumar, con dosis más precisa.',
    href: wa('Hola Flora, quiero consultar por el cartucho 1 ml THC 🌿'),
  },
  {
    id: 'cartucho-05-thc',
    nombre: 'Cartucho 0,5 ml',
    detalle: 'THC',
    badge: '0,5 ml',
    color: '#C9396B',
    img: '/img/prod-extracciones.jpg',
    desc: 'El mismo extracto de THC en 0,5 ml, ideal para empezar a vaporizar.',
    href: wa('Hola Flora, quiero consultar por el cartucho 0,5 ml THC 🌿'),
  },
  {
    id: 'cartucho-05-cbd',
    nombre: 'Cartucho 0,5 ml',
    detalle: 'CBD',
    badge: '0,5 ml',
    color: '#1F9389',
    img: '/img/prod-cartucho-cbd.webp',
    desc: 'Extracto de CBD para el día: calma en vapor, sin quemar nada.',
    href: wa('Hola Flora, quiero consultar por el cartucho 0,5 ml CBD 🌿'),
  },
  {
    id: 'bateria-510',
    nombre: 'Batería 510',
    detalle: 'Para cartuchos',
    badge: '510',
    color: '#B8A878',
    img: '/img/prod-bateria-510.webp',
    desc: 'Recargable por USB y compatible con todos nuestros cartuchos: tu entrada al vapor.',
    href: wa('Hola Flora, quiero consultar por la batería 510 🌿'),
  },
]
