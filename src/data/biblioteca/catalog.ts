// ═══════════════════════════════════════════════════════════
// Biblioteca de módulos — Flora
// Catálogo de todo lo desarrollado en las 5 versiones del sitio,
// para revisar y reciclar contenido hacia el diseño actual (cinematic).
// ═══════════════════════════════════════════════════════════

export interface Version {
  id: string
  name: string
  stack: string
  port: number
  shot: string
  tagline: string
  current?: boolean
}

export interface ModuleVariant {
  version: string // id de Version
  file: string
  note?: string
}

export type ModuleStatus = 'activo' | 'reciclar' | 'nuevo'

export interface ModuleEntry {
  id: string
  name: string
  desc: string
  status: ModuleStatus
  variants: ModuleVariant[]
}

export const versions: Version[] = [
  {
    id: 'flora-ong',
    name: 'flora-ong',
    stack: 'Next.js + Framer Motion + shadcn/ui',
    port: 3001,
    shot: '/biblioteca/captures/flora-ong.png',
    tagline: 'Primera versión. Base sólida: formulario de contacto, sección de confianza, FAQ.',
  },
  {
    id: 'flora-v2',
    name: 'flora-v2',
    stack: 'Next.js + Framer Motion',
    port: 3002,
    shot: '/biblioteca/captures/flora-v2.png',
    tagline: 'Iteración rica: ScrollStory, perfiles, productos, testimonios, onboarding por chat.',
  },
  {
    id: 'flora-v3',
    name: 'flora-v3',
    stack: 'Next.js + Framer Motion',
    port: 3003,
    shot: '/biblioteca/captures/flora-v3.png',
    tagline: 'La más completa en módulos: comunidad, podcast, educación, legalidad, hero con video.',
  },
  {
    id: 'flora-v4',
    name: 'flora-v4',
    stack: 'Next.js 16 + Framer Motion',
    port: 3004,
    shot: '/biblioteca/captures/flora-v4.png',
    tagline: 'Hero split full-bleed 120px, testimonial, educación y legalidad pulidos.',
  },
  {
    id: 'flora-cinematic',
    name: 'flora-cinematic',
    stack: 'Astro + GSAP + Lenis',
    port: 4321,
    shot: '/biblioteca/captures/flora-cinematic.png',
    tagline: 'Diseño actual. Editorial cinematográfico, video de fondo, bento, scroll horizontal.',
    current: true,
  },
]

export const modules: ModuleEntry[] = [
  {
    id: 'hero',
    name: 'Hero',
    desc: 'Apertura del sitio. Hay variantes con imagen, con video de fondo y split layout.',
    status: 'activo',
    variants: [
      { version: 'flora-ong', file: 'components/sections/Hero.tsx' },
      { version: 'flora-v2', file: 'components/sections/Hero.tsx', note: 'con WordReveal' },
      { version: 'flora-v3', file: 'components/sections/Hero.tsx' },
      { version: 'flora-v3', file: 'components/sections/HeroVideo.tsx', note: 'video fullscreen' },
      { version: 'flora-v4', file: 'components/sections/Hero.tsx', note: 'split full-bleed 120px' },
      { version: 'flora-cinematic', file: 'index.astro · .hero', note: 'actual, video + viñeta' },
    ],
  },
  {
    id: 'porque',
    name: 'Por qué Flora',
    desc: 'Argumentos de valor: trazabilidad, legalidad, calidad, acompañamiento.',
    status: 'activo',
    variants: [
      { version: 'flora-ong', file: 'components/sections/PorQueFlora.tsx' },
      { version: 'flora-ong', file: 'components/sections/QueEsFlora.tsx', note: 'variante explicativa' },
      { version: 'flora-v2', file: 'components/sections/Features.tsx' },
      { version: 'flora-v3', file: 'components/sections/PorQueFlora.tsx' },
      { version: 'flora-v4', file: 'components/sections/PorQueFlora.tsx' },
      { version: 'flora-cinematic', file: 'index.astro · .why-section', note: 'actual, bento' },
    ],
  },
  {
    id: 'membresias',
    name: 'Membresías',
    desc: 'Planes de cultivo compartido (Semilla / Raíz / Cosecha / Tierra).',
    status: 'activo',
    variants: [
      { version: 'flora-ong', file: 'components/sections/Memberships.tsx' },
      { version: 'flora-v2', file: 'components/sections/Memberships.tsx' },
      { version: 'flora-v3', file: 'components/sections/Membresias.tsx' },
      { version: 'flora-v4', file: 'components/sections/Membresias.tsx' },
      { version: 'flora-cinematic', file: 'index.astro · .horizontal-section', note: 'actual, scroll horizontal + tilt' },
    ],
  },
  {
    id: 'como-funciona',
    name: 'Cómo funciona',
    desc: 'Los pasos para asociarse, del formulario al cultivo compartido.',
    status: 'activo',
    variants: [
      { version: 'flora-ong', file: 'components/sections/HowItWorks.tsx' },
      { version: 'flora-v2', file: 'components/sections/HowItWorks.tsx' },
      { version: 'flora-v3', file: 'components/sections/ComoFunciona.tsx' },
      { version: 'flora-v4', file: 'components/sections/ComoFunciona.tsx' },
      { version: 'flora-cinematic', file: 'index.astro · .steps-section', note: 'actual, línea + 4 pasos' },
    ],
  },
  {
    id: 'stats',
    name: 'Stats / métricas',
    desc: 'Contadores de confianza: asociados, años activos, alcance, legalidad.',
    status: 'nuevo',
    variants: [
      { version: 'flora-cinematic', file: 'index.astro · .stats-section', note: 'count-up animado' },
    ],
  },
  {
    id: 'educacion',
    name: 'Educación',
    desc: 'Contenido para decidir mejor: recursos, artículos, formación sobre cannabis medicinal.',
    status: 'reciclar',
    variants: [
      { version: 'flora-v3', file: 'components/sections/Educacion.tsx' },
      { version: 'flora-v4', file: 'components/sections/Educacion.tsx', note: 'versión pulida' },
    ],
  },
  {
    id: 'comunidad',
    name: 'Comunidad',
    desc: 'La pertenencia como parte del bienestar. Vida del club más allá del producto.',
    status: 'reciclar',
    variants: [
      { version: 'flora-v3', file: 'components/sections/Comunidad.tsx' },
    ],
  },
  {
    id: 'podcast',
    name: 'Podcast / Espacio libre de prejuicios',
    desc: 'Programa de YouTube del club: conversaciones sobre cannabis medicinal, acceso y legalidad. 2 episodios reales embebidos.',
    status: 'activo',
    variants: [
      { version: 'flora-v3', file: 'components/sections/Podcast.tsx' },
      { version: 'flora-cinematic', file: 'index.astro · .programa-section', note: 'reciclado, embeds YouTube facade' },
    ],
  },
  {
    id: 'legalidad',
    name: 'Legalidad',
    desc: 'Marco legal explicado: Ley 27.350, REPROCANN, sin compraventa. Genera confianza.',
    status: 'activo',
    variants: [
      { version: 'flora-v3', file: 'components/sections/Legalidad.tsx' },
      { version: 'flora-v4', file: 'components/sections/Legalidad.tsx', note: 'versión pulida' },
      { version: 'flora-cinematic', file: 'index.astro · .legal-section', note: 'reciclado, checklist + badge REPROCANN' },
    ],
  },
  {
    id: 'testimonios',
    name: 'Testimonios',
    desc: 'Voces de asociados. Prueba social del acceso real y el acompañamiento.',
    status: 'reciclar',
    variants: [
      { version: 'flora-v2', file: 'components/sections/Testimonios.tsx' },
      { version: 'flora-v4', file: 'components/sections/Testimonial.tsx', note: 'destacado individual' },
    ],
  },
  {
    id: 'perfiles',
    name: 'Perfiles',
    desc: 'Tipos de asociado / casos de uso. Ayuda a que cada persona se identifique.',
    status: 'reciclar',
    variants: [
      { version: 'flora-v2', file: 'components/sections/Perfiles.tsx' },
    ],
  },
  {
    id: 'productos',
    name: 'Productos',
    desc: 'Genéticas / variedades disponibles, con su documentación por lote.',
    status: 'reciclar',
    variants: [
      { version: 'flora-v2', file: 'components/sections/Productos.tsx' },
    ],
  },
  {
    id: 'scrollstory',
    name: 'ScrollStory',
    desc: 'Narrativa scrolleable que cuenta la historia del club paso a paso.',
    status: 'reciclar',
    variants: [
      { version: 'flora-v2', file: 'components/sections/ScrollStory.tsx' },
    ],
  },
  {
    id: 'trust',
    name: 'Confianza / Trust',
    desc: 'Sellos, garantías y señales de seriedad. Reduce la fricción para asociarse.',
    status: 'reciclar',
    variants: [
      { version: 'flora-ong', file: 'components/sections/Trust.tsx' },
      { version: 'flora-v2', file: 'components/sections/Trust.tsx' },
    ],
  },
  {
    id: 'contacto',
    name: 'Formulario de contacto',
    desc: 'Form de ingreso / consulta. Hoy el sitio deriva todo a WhatsApp; útil si se quiere captar leads on-site.',
    status: 'reciclar',
    variants: [
      { version: 'flora-ong', file: 'components/sections/ContactForm.tsx' },
    ],
  },
  {
    id: 'onboarding',
    name: 'Onboarding por chat',
    desc: 'Flujo conversacional para guiar al alta del asociado. Interacción premium.',
    status: 'reciclar',
    variants: [
      { version: 'flora-v2', file: 'components/ui/ChatOnboarding.tsx' },
    ],
  },
  {
    id: 'navbar',
    name: 'Navbar',
    desc: 'Navegación principal. La actual suma hamburguesa mobile + drawer accesible.',
    status: 'activo',
    variants: [
      { version: 'flora-ong', file: 'components/layout/Navbar.tsx' },
      { version: 'flora-v2', file: 'components/layout/Navbar.tsx' },
      { version: 'flora-v3', file: 'components/sections/Navbar.tsx' },
      { version: 'flora-cinematic', file: 'index.astro · .site-nav', note: 'actual, + drawer mobile' },
    ],
  },
  {
    id: 'footer',
    name: 'Footer',
    desc: 'Cierre del sitio: CTA final, navegación, legal.',
    status: 'activo',
    variants: [
      { version: 'flora-ong', file: 'components/layout/Footer.tsx' },
      { version: 'flora-v2', file: 'components/layout/Footer.tsx' },
      { version: 'flora-v3', file: 'components/sections/Footer.tsx' },
      { version: 'flora-cinematic', file: 'index.astro · .footer', note: 'actual' },
    ],
  },
  {
    id: 'whatsapp-float',
    name: 'WhatsApp flotante',
    desc: 'Botón flotante de WhatsApp siempre visible. Canal de conversión directo.',
    status: 'reciclar',
    variants: [
      { version: 'flora-ong', file: 'components/layout/WhatsAppFloat.tsx' },
      { version: 'flora-v2', file: 'components/layout/WhatsAppFloat.tsx' },
    ],
  },
  {
    id: 'ui-botanica',
    name: 'UI botánica / fondos',
    desc: 'Piezas decorativas: hojas, divisores botánicos, fondos con glow y degradés, WordReveal.',
    status: 'reciclar',
    variants: [
      { version: 'flora-v2', file: 'components/ui/BotanicalLeaf.tsx' },
      { version: 'flora-v2', file: 'components/ui/BotanicalDivider.tsx' },
      { version: 'flora-v2', file: 'components/ui/GlowBackground.tsx' },
      { version: 'flora-v2', file: 'components/ui/GradientBackground.tsx' },
      { version: 'flora-v2', file: 'components/ui/WordReveal.tsx' },
    ],
  },
]

export const statusLabels: Record<ModuleStatus, string> = {
  activo: 'En el diseño actual',
  reciclar: 'Para reciclar',
  nuevo: 'Nuevo en cinematic',
}
