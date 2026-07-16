import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

// Quitar clase no-js tan pronto como el script corre
document.documentElement.classList.remove('no-js')

// ── Detectar preferencia de movimiento reducido ──
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ── Smooth scroll con Lenis ──
const lenis = new Lenis({
  duration: 1.1,
  easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  smoothWheel: true,
})

// Callback opcional que initNav() engancha acá — se corre en cada frame
// (ver comentario en initNav sobre por qué un simple listener no alcanza).
let onFrame: (() => void) | null = null

function raf(time: number) {
  lenis.raf(time)
  ScrollTrigger.update()
  onFrame?.()
  requestAnimationFrame(raf)
}
requestAnimationFrame(raf)

// ── Bloqueo de scroll real ──
// document.body.style.overflow SOLO no alcanza: en la mayoría de los
// navegadores el elemento que realmente scrollea es <html>, no <body> —
// y Lenis (smoothWheel: true) intercepta la rueda por su cuenta, scrolleando
// igual aunque el overflow nativo esté en hidden. Hay que frenar los tres.
const lockScroll = () => {
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
  lenis.stop()
}
// El welcome (hero-story) necesita saber si el loader de edad ya terminó
// antes de escuchar sus propios gestos — si llega tarde a un 'flora:loader-done'
// que ya se disparó (caso: EDAD_KEY ya validado, el loader ni se muestra),
// un simple addEventListener se lo perdería. Esta bandera cubre ese caso.
let loaderDone = false

const unlockScroll = () => {
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
  lenis.start()
}

// ── Anchors suaves: cualquier link a #id (del nav, de una card, de un CTA)
// scrollea con la misma curva de Lenis en vez del salto instantáneo nativo
// del navegador — incluye los links que vienen de OTRA página con /#id
// (ej. "Acompañamiento" desde /aceites/), que hacen una navegación real y
// after eso arrancan el scroll suave hacia la sección en vez de aparecer
// ya saltados ahí. offset negativo para que la sección no quede tapada
// por el nav fijo (60px de alto).
function initSmoothAnchors() {
  const NAV_OFFSET = -76

  function scrollToHash(hash: string): boolean {
    const id = hash.replace('#', '')
    if (!id) return false
    const target = document.getElementById(id)
    if (!target) return false
    lenis.scrollTo(target, {
      offset: NAV_OFFSET,
      duration: 1.3,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
    })
    return true
  }

  document.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!link) return
    let url: URL
    try {
      url = new URL(link.href, location.href)
    } catch {
      return
    }
    if (url.pathname !== location.pathname) return
    if (url.hash) {
      if (scrollToHash(url.hash)) e.preventDefault()
      return
    }
    // Link a la misma página sin hash (ej. el logo con href="/" estando ya
    // en home): en vez de la navegación/recarga nativa, sube suave arriba.
    lenis.scrollTo(0, {
      duration: 1.3,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
    })
    e.preventDefault()
  })

  // Llegada con hash en la URL (desde otra página, o F5 con #ancla): en vez
  // de dejar que el navegador salte de golpe antes de que Lenis levante,
  // arrancamos arriba y scrolleamos suave una vez que la página está lista.
  if (location.hash) {
    const hash = location.hash
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)
    window.addEventListener('load', () => {
      setTimeout(() => scrollToHash(hash), 120)
    })
  }
}

// ── Nav scroll behavior ──
function initNav() {
  const nav = document.querySelector<HTMLElement>('.site-nav')
  if (!nav) return

  // La barra clara recién entra al terminar el relato oscuro del welcome.
  // Se mide la posición real de #perfiles en cada scroll (inmune al pin
  // del welcome, que corre la sección ~4500px después del cálculo inicial).
  const firstLight = document.getElementById('perfiles')
  const gate = () => {
    if (!firstLight) return
    nav.classList.toggle('scrolled', firstLight.getBoundingClientRect().top <= 64)
  }
  // El scroll nativo del navegador no es confiable acá: con smoothWheel de
  // Lenis + la sección "welcome" pineada por GSAP, hay tramos donde el
  // evento 'scroll' nativo no se dispara al ritmo del movimiento visual real
  // (bug reportado: la barra se quedaba transparente aunque la página ya
  // estuviera scrolleada sobre fondo blanco). Tampoco alcanza con re-medir
  // solo en eventos: si la página carga ya scrolleada (ej. usuario logueado
  // que vuelve) la primera medición puede correr antes de que el layout del
  // pin de GSAP termine de asentarse, y sin un scroll nuevo ese error nunca
  // se corrige. La única fuente de verdad confiable es medir en cada frame,
  // enganchado al mismo loop que ya corre Lenis/ScrollTrigger — costo
  // insignificante (un getBoundingClientRect + un toggle) y sin carreras.
  onFrame = gate
  gate()
}

// ── Imagen hero con fade-in cuando carga ──
function initHeroImage() {
  const img = document.getElementById('hero-img') as HTMLImageElement | null
  if (!img) return
  if (img.complete) {
    img.classList.add('loaded')
  } else {
    img.addEventListener('load', () => img.classList.add('loaded'))
  }
}

// ── Embeds de YouTube tipo "facade" (carga el iframe recién al click) ──
function initYouTubeFacades() {
  document.querySelectorAll<HTMLButtonElement>('.yt-facade').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id
      if (!id || btn.dataset.loaded) return
      btn.dataset.loaded = '1'
      const title = btn.dataset.title || 'Episodio'
      const iframe = document.createElement('iframe')
      iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`
      iframe.title = title
      iframe.allow = 'accelerated-sensors; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
      iframe.setAttribute('allowfullscreen', '')
      btn.replaceChildren(iframe)
    })
  })
}

// ── Video de fondo del hero ──
// Sólo se carga/reproduce si hay movimiento permitido. Con reduced-motion
// queda el poster estático (no se descarga el video).
function initHeroVideo() {
  const video = document.getElementById('hero-video') as HTMLVideoElement | null
  if (!video) return
  if (prefersReducedMotion) return

  video.preload = 'auto'
  const reveal = () => video.classList.add('loaded')
  video.addEventListener('playing', reveal, { once: true })
  video.addEventListener('canplay', reveal, { once: true })

  const play = () => {
    const p = video.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  }
  if (video.readyState >= 2) play()
  else video.addEventListener('loadeddata', play, { once: true })
  video.load()
}

// ── Video de fondo de Acceso ──
// Sin autoplay en el HTML: con reduced-motion queda el poster (no se
// descargan los 5.5MB); si hay movimiento, carga y reproduce recién al
// acercarse la sección, y pausa al salir de pantalla.
function initAccesoVideo() {
  const video = document.querySelector<HTMLVideoElement>('.fl-acceso-video')
  if (!video) return
  if (prefersReducedMotion) return

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const p = video.play()
        if (p && typeof p.catch === 'function') p.catch(() => {})
      } else {
        video.pause()
      }
    })
  }, { rootMargin: '200px 0px' })
  io.observe(video)
}

// ── Acceso: escena viva — revelado escalonado + parallax del video ──
// Estados iniciales via gsap.set (nunca CSS) para no romper no-js/reduced-motion.
function initAccesoScene() {
  const section = document.querySelector<HTMLElement>('.fl-acceso')
  if (!section || prefersReducedMotion) return

  const items = [
    section.querySelector('.fl-acceso-head .fl-eyebrow'),
    section.querySelector('.fl-acceso-head .fl-title'),
    section.querySelector('.fl-acceso-story'),
    section.querySelector('.fl-acceso-datos'),
    section.querySelector('.fl-acceso-ctas'),
    section.querySelector('.fl-acceso-note'),
  ].filter(Boolean)

  gsap.set(items, { opacity: 0, y: 26 })
  gsap.to(items, {
    opacity: 1,
    y: 0,
    duration: 0.9,
    stagger: 0.12,
    ease: 'power3.out',
    scrollTrigger: { trigger: section, start: 'top 68%' },
  })

  // El video respira: leve escala + deriva vertical mientras la escena cruza el viewport
  const video = section.querySelector<HTMLElement>('.fl-acceso-video')
  if (video) {
    gsap.fromTo(video,
      { yPercent: -6, scale: 1.12 },
      {
        yPercent: 6,
        scale: 1.12,
        ease: 'none',
        scrollTrigger: { trigger: section, start: 'top bottom', end: 'bottom top', scrub: true },
      }
    )
  }
}

// ── CTA "placa de metal": brillo de estudio que sigue al cursor ──
// Progressive enhancement — sin JS, el brillo queda fijo en la posición
// definida por --fl-mx/--fl-my en el CSS. Con JS, sigue al puntero vía
// --mx/--my, con throttle por requestAnimationFrame (nunca más de un
// recálculo de estilo por frame).
function initAccesoPortalGlint() {
  if (prefersReducedMotion) return

  let raf = 0
  document.querySelectorAll<HTMLElement>('.fl-acceso-card').forEach(el => {
    el.addEventListener('pointermove', (e) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        const mx = ((e.clientX - r.left) / r.width) * 100
        const my = ((e.clientY - r.top) / r.height) * 100
        el.style.setProperty('--mx', `${mx}%`)
        el.style.setProperty('--my', `${my}%`)
        raf = 0
      })
    })
    el.addEventListener('pointerleave', () => {
      el.style.removeProperty('--mx')
      el.style.removeProperty('--my')
    })
  })
}

// ── Split words ──
// IMPORTANTE: No ponemos opacity:0 en CSS. GSAP setea el from sólo si hay animaciones.
function splitWords() {
  document.querySelectorAll<HTMLElement>('.split-words').forEach(el => {
    const raw = el.innerHTML
    const lines = raw.split(/<br\s*\/?>/i)
    el.innerHTML = lines.map(line => {
      const tmp = document.createElement('span')
      tmp.innerHTML = line.trim()
      const tokens: string[] = []
      tmp.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          const words = (node.textContent || '').trim().split(/\s+/).filter(Boolean)
          words.forEach(w => tokens.push(`<span class="word"><span class="word-inner">${w}</span></span>`))
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const elem = node as HTMLElement
          const words = (elem.textContent || '').trim().split(/\s+/).filter(Boolean)
          words.forEach(w => {
            tokens.push(`<span class="word"><span class="word-inner"><${elem.tagName.toLowerCase()} class="${elem.className}">${w}</${elem.tagName.toLowerCase()}></span></span>`)
          })
        }
      })
      return tokens.join(' ')
    }).join('<br>')
  })
}

function animateSplitWords() {
  if (prefersReducedMotion) return

  gsap.utils.toArray<HTMLElement>('.split-words').forEach(el => {
    const inners = el.querySelectorAll<HTMLElement>('.word-inner')
    // Setear estado inicial aquí, no en CSS
    gsap.set(inners, { yPercent: 110, opacity: 0 })
    gsap.to(inners, {
      yPercent: 0,
      opacity: 1,
      duration: 0.85,
      stagger: 0.055,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: el,
        start: 'top 88%',
      }
    })
  })
}

// ── Clip-path reveal — CRÍTICO: estado base VISIBLE en CSS, GSAP setea el from ──
function initClipReveal() {
  if (prefersReducedMotion) return

  gsap.utils.toArray<HTMLElement>('.clip-reveal').forEach(el => {
    // Set initial state con GSAP, no con CSS
    gsap.set(el, { clipPath: 'inset(100% 0% 0% 0%)' })
    gsap.to(el, {
      clipPath: 'inset(0% 0% 0% 0%)',
      duration: 1.0,
      ease: 'power4.out',
      scrollTrigger: {
        trigger: el,
        start: 'top 82%'
      }
    })
  })
}

// ── Fade-in genérico ──
function initFadeIn() {
  if (prefersReducedMotion) return

  gsap.utils.toArray<HTMLElement>('.fade-in').forEach(el => {
    gsap.set(el, { opacity: 0, y: 24 })
    gsap.to(el, {
      opacity: 1,
      y: 0,
      duration: 0.75,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: el,
        start: 'top 85%',
      }
    })
  })
}

// ── Page loader / gate de mayoría de edad ──
// La "O" del sello es un anillo de progreso real: avanza mientras la página
// carga y remata a 100% cuando fuentes + primer video del hero están listos
// de verdad (con un tope de seguridad para no colgar a nadie con mala
// conexión). Una vez completo, aparece la pregunta con dos botones reales:
// "Sí, soy mayor" muestra la invitación a deslizar (un gesto más, recién ahí
// se revela el sitio); "No" es un link que va a la página de verificación.
function initLoader() {
  const loader   = document.querySelector<HTMLElement>('.page-loader')
  if (!loader) return

  // El gate de edad se responde UNA sola vez: si ya confirmó, el loader ni aparece.
  const EDAD_KEY = 'flora-edad-ok'
  const EDAD_TTL = 180 * 24 * 60 * 60 * 1000 // 180 días
  try {
    const t = Number(localStorage.getItem(EDAD_KEY) || 0)
    if (t && Date.now() - t < EDAD_TTL) {
      loader.remove()
      loaderDone = true
      window.dispatchEvent(new CustomEvent('flora:loader-done'))
      return
    }
  } catch { /* sin storage, el gate se muestra normal */ }

  const ring      = loader.querySelector<HTMLElement>('.loader-ring')
  const ringFill  = loader.querySelector<HTMLElement>('.loader-ring-fill')
  const cue       = loader.querySelector<HTMLElement>('.loader-cue')
  const askStep   = loader.querySelector<HTMLElement>('.loader-gate-ask')
  const slideStep = loader.querySelector<HTMLElement>('.loader-slide-cue')
  const srMsg     = loader.querySelector<HTMLElement>('.loader-sr-msg')
  const yesBtn    = loader.querySelector<HTMLButtonElement>('.loader-gate-yes')

  // markReady: el contenido real ya está — se anuncia por accesibilidad,
  // pero el loader queda visible en pantalla (gate de edad completo).
  // finish: recién oculta el loader, y solo la dispara el gesto final.
  const markReady = () => {
    loader.setAttribute('aria-busy', 'false')
    if (srMsg) srMsg.textContent = 'Flora ONG lista'
  }
  const finish = () => {
    unlockScroll()
    loader.style.display = 'none'
    // Aviso para el hero: recién ahí puede empezar a escuchar sus propios
    // gestos, para que el swipe que cierra el loader no le robe un paso.
    loaderDone = true
    window.dispatchEvent(new CustomEvent('flora:loader-done'))
  }

  lockScroll()

  // El anillo real del logo se revela angularmente: --pct va de 0 a 100 y
  // un conic-gradient en el mask-image del PNG del anillo lo va "dibujando".
  const pctProxy = { v: 0 }
  const setPct = (v: number) => { if (ringFill) ringFill.style.setProperty('--pct', `${v}`) }

  let tl: ReturnType<typeof gsap.timeline> | null = null

  // Paso final: un gesto real (scroll, deslizar el dedo, tecla) revela el
  // sitio — solo queda activo después de confirmar "Sí, soy mayor".
  let revealed = false
  const revealSite = () => {
    if (revealed) return
    revealed = true
    tl?.kill()
    gsap.to(loader, { yPercent: -100, duration: 0.5, ease: 'power2.inOut', onComplete: finish })
  }

  // Ruedita del mouse animada con GSAP (evita líos de transform-box en SVG).
  const wheelDot = loader.querySelector<SVGCircleElement>('.loader-cue-wheel')
  if (wheelDot) {
    gsap.to(wheelDot, { y: 9, opacity: 0, duration: 0.7, ease: 'power1.in', repeat: -1, yoyo: true, repeatDelay: 0.3 })
  }

  let answered = false
  const confirmYes = () => {
    if (answered) return
    answered = true
    try { localStorage.setItem(EDAD_KEY, String(Date.now())) } catch { /* sin storage */ }
    setPct(100)
    markReady()

    if (prefersReducedMotion) {
      // Sin la animación de "deslizar": confirmar ya revela el sitio.
      revealSite()
      return
    }

    if (askStep) {
      gsap.to(askStep, { opacity: 0, duration: 0.3, ease: 'power1.out', onComplete: () => {
        askStep.style.visibility = 'hidden'
        askStep.setAttribute('aria-hidden', 'true')
      }})
    }
    if (slideStep) gsap.to(slideStep, { opacity: 1, duration: 0.4, ease: 'power2.out', delay: 0.15 })
    ;(['wheel', 'touchmove', 'keydown'] as const).forEach(evt =>
      window.addEventListener(evt, revealSite, { once: true, passive: true })
    )
  }
  if (yesBtn) yesBtn.addEventListener('click', confirmYes)

  if (prefersReducedMotion) {
    // Sin animación, pero el gate sigue en pie: se muestra completo de
    // entrada y espera la respuesta del usuario.
    setPct(100)
    if (ring) gsap.set(ring, { opacity: 1, y: 0, scale: 1 })
    if (cue) gsap.set(cue, { opacity: 1 })
    markReady()
    return
  }

  const fontsReady: Promise<unknown> = document.fonts?.ready ?? Promise.resolve()
  const heroVideo = document.querySelector<HTMLVideoElement>('.welcome-img[data-bg="0"]')
  const heroReady = new Promise<void>((resolve) => {
    if (!heroVideo || heroVideo.readyState >= 2) { resolve(); return }
    heroVideo.addEventListener('canplay', () => resolve(), { once: true })
    heroVideo.addEventListener('error',   () => resolve(), { once: true })
  })
  const safetyTimeout = new Promise<void>((resolve) => setTimeout(resolve, 2600))
  const ready = Promise.race([Promise.all([fontsReady, heroReady]), safetyTimeout])

  // Si la carga real termina ANTES de que la animación cosmética llegue a la
  // pausa, no hay nada que "resumir" todavía — por eso guardamos la posta en
  // isReady y la consultamos también desde el propio callback de la pausa,
  // para que ambos órdenes posibles queden cubiertos.
  let isReady = false
  tl = gsap.timeline()

  // Termina con el anillo al 100% y el gate (pregunta + invitación) visible
  // — sin slide automático. El sitio queda "listo" (markReady) pero el
  // loader se mantiene en pantalla hasta que el usuario responda.
  tl.to(ring,     { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'power2.out' })
    .to(pctProxy, { v: 88, duration: 1.1, ease: 'power1.inOut', onUpdate: () => setPct(pctProxy.v) }, '-=0.15')
    .addPause(undefined, () => { if (isReady) tl!.resume() })
    .to(pctProxy, { v: 100, duration: 0.35, ease: 'power2.out', onUpdate: () => setPct(pctProxy.v) })
    .to(cue,      { opacity: 1, duration: 0.4, ease: 'power2.out' }, '+=0.05')
    .call(markReady)

  ready.then(() => {
    isReady = true
    if (!answered && tl && tl.paused()) tl.resume()
  })
}

// ── Scroll progress bar ──
function initScrollProgress() {
  if (prefersReducedMotion) return

  const bar = document.querySelector<HTMLElement>('.scroll-progress')
  if (!bar) return

  gsap.to(bar, {
    scaleX: 1,
    ease: 'none',
    scrollTrigger: {
      trigger: document.body,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.1,
    }
  })
}

// ── Partículas flotantes ──
function initParticles() {
  if (prefersReducedMotion) return

  const container = document.querySelector<HTMLElement>('.hero-particles')
  if (!container) return

  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div')
    p.className = 'particle'
    const size = 2 + Math.random() * 2.5
    p.style.setProperty('--dur',   `${8 + Math.random() * 10}s`)
    p.style.setProperty('--del',   `${Math.random() * 12}s`)
    p.style.setProperty('--drift', `${(Math.random() - 0.5) * 100}px`)
    p.style.left   = `${Math.random() * 100}%`
    p.style.width  = `${size}px`
    p.style.height = `${size}px`
    // Partículas alternadas: verde y dorado tenue
    p.style.background = i % 5 === 0 ? 'rgba(184, 168, 120, 0.6)' : 'rgba(113, 206, 106, 0.5)'
    container.appendChild(p)
  }
}

// ── Mobile drawer ──
function initMobileDrawer() {
  // La home carga main.ts Y tienda.js (para el carrito) — tienda.js trae su
  // propia copia standalone del hamburguesa/drawer/dropdowns para las
  // páginas de catálogo que no cargan main.ts. tienda.js es un <script>
  // clásico (is:inline) que corre ANTES que este módulo, así que si ya
  // marcó la página, no nos enganchamos de nuevo — las dos versiones se
  // pisaban el aria-expanded en cada click (una lo ponía en true, la otra
  // lo volvía a false en el mismo evento).
  if ((window as any).__floraNavInit) return
  const hamburger = document.querySelector<HTMLButtonElement>('.nav-hamburger')
  const drawer    = document.getElementById('mobile-drawer') as HTMLElement | null
  const backdrop  = drawer?.querySelector<HTMLElement>('.drawer-backdrop')
  const closeBtn  = drawer?.querySelector<HTMLButtonElement>('.drawer-close')

  if (!hamburger || !drawer) return

  const openDrawer = () => {
    drawer.hidden = false
    hamburger.setAttribute('aria-expanded', 'true')
    lockScroll()
    // Foco al cierre para accesibilidad
    setTimeout(() => closeBtn?.focus(), 50)
  }

  const closeDrawer = () => {
    drawer.hidden = true
    hamburger.setAttribute('aria-expanded', 'false')
    unlockScroll()
    hamburger.focus()
  }

  hamburger.addEventListener('click', openDrawer)
  closeBtn?.addEventListener('click', closeDrawer)
  backdrop?.addEventListener('click', closeDrawer)

  // Cerrar con Escape
  drawer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer()
  })

  // Cerrar al hacer click en cualquier link del drawer
  drawer.querySelectorAll<HTMLAnchorElement>('a').forEach(link => {
    link.addEventListener('click', () => {
      if (!link.getAttribute('target')) closeDrawer()
      else closeDrawer()
    })
  })
}

// ── Dropdown "Servicios" en el nav de desktop ──
function initNavDropdown() {
  if ((window as any).__floraNavInit) return // ver comentario en initMobileDrawer
  const dropdown = document.querySelector<HTMLElement>('.nav-dropdown')
  const trigger  = dropdown?.querySelector<HTMLButtonElement>('.nav-dropdown-trigger')
  if (!dropdown || !trigger) return

  const close = () => {
    trigger.setAttribute('aria-expanded', 'false')
    dropdown.classList.remove('is-open')
  }
  const toggle = () => {
    const open = trigger.getAttribute('aria-expanded') === 'true'
    trigger.setAttribute('aria-expanded', open ? 'false' : 'true')
    dropdown.classList.toggle('is-open', !open)
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation()
    toggle()
  })
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target as Node)) close()
  })
  dropdown.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); trigger.focus() }
  })
  dropdown.querySelectorAll<HTMLAnchorElement>('.nav-dropdown-menu a').forEach(link => {
    link.addEventListener('click', close)
  })
}

// ── Dropdown "Servicios" en el drawer mobile (acordeón) ──
function initDrawerDropdown() {
  if ((window as any).__floraNavInit) return // ver comentario en initMobileDrawer
  document.addEventListener('click', (e) => {
    const trigger = (e.target as HTMLElement)?.closest?.('.drawer-dropdown-trigger') as HTMLButtonElement | null
    if (!trigger) return
    const open = trigger.getAttribute('aria-expanded') === 'true'
    trigger.setAttribute('aria-expanded', open ? 'false' : 'true')
  })
}

// ── Init all ──
// ── Productos: selector de formato (tabs) ──
function initProductTabs() {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.prod-tab'))
  const panels = Array.from(document.querySelectorAll<HTMLElement>('.prod-panel'))
  if (!tabs.length) return

  const select = (tab: HTMLButtonElement, focus = false) => {
    const target = tab.dataset.tab
    tabs.forEach(t => {
      const active = t === tab
      t.classList.toggle('is-active', active)
      t.setAttribute('aria-selected', active ? 'true' : 'false')
      t.tabIndex = active ? 0 : -1
    })
    panels.forEach(p => {
      const show = p.dataset.panel === target
      p.classList.toggle('is-active', show)
      p.hidden = !show
    })
    if (focus) tab.focus()
    ScrollTrigger.refresh()
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab))
    // Navegación por teclado del tablist (patrón WAI-ARIA)
    tab.addEventListener('keydown', (e) => {
      let next = -1
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % tabs.length
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + tabs.length) % tabs.length
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = tabs.length - 1
      else return
      e.preventDefault()
      select(tabs[next], true)
    })
  })
}

// ── WhatsApp flotante: oculto en el hero, aparece al pasarlo ──
function initWhatsAppFloat() {
  const float = document.querySelector<HTMLElement>('.wa-float')
  const hero = document.querySelector<HTMLElement>('.welcome') || document.querySelector<HTMLElement>('.hero')
  if (!float || !hero) return

  ScrollTrigger.create({
    trigger: hero,
    start: 'bottom 80%',
    onEnter: () => float.classList.add('is-visible'),
    onLeaveBack: () => float.classList.remove('is-visible'),
  })

  // Se achica y se corre de encima del contenido MIENTRAS se scrollea (en
  // mobile tapaba botones y recortaba texto de pasada); apenas el scroll se
  // frena, vuelve a su tamaño y posición normales.
  let scrollTimer: ReturnType<typeof setTimeout> | undefined
  window.addEventListener('scroll', () => {
    float.classList.add('is-scrolling')
    clearTimeout(scrollTimer)
    scrollTimer = setTimeout(() => float.classList.remove('is-scrolling'), 500)
  }, { passive: true })
}

// ── Instagram: últimas publicaciones reales desde NUESTRO backend ──
// El endpoint propio /api/instagram usa la Graph API oficial + caché en KV
// (sin plugins de terceros). Si no hay token configurado o Meta falla, el
// endpoint devuelve posts: [] y se mantienen las cards locales de respaldo
// que ya vienen renderizadas por Astro. El módulo nunca se ve roto.
interface IgCard {
  caption?: string
  img?: string
  permalink?: string
  timestamp?: string
  type?: string
}

function initInstagramFeed() {
  const showcase = document.querySelector<HTMLElement>('.ig-showcase')
  const slider = document.querySelector<HTMLElement>('.ig-slider')
  if (!showcase && !slider) return

  const track = slider?.querySelector<HTMLElement>('.ig-track') || null
  const prev = slider?.querySelector<HTMLButtonElement>('.ig-prev') || null
  const next = slider?.querySelector<HTMLButtonElement>('.ig-next') || null

  const step = () => {
    if (!track) return 340
    const card = track.querySelector<HTMLElement>('.ig-card')
    return card ? card.offsetWidth + 20 : 340
  }
  const updateNav = () => {
    if (!track || !prev || !next) return
    const max = track.scrollWidth - track.clientWidth - 2
    prev.disabled = track.scrollLeft <= 2
    next.disabled = track.scrollLeft >= max
  }
  if (track) {
    prev?.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }))
    next?.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }))
    track.addEventListener('scroll', updateNav, { passive: true })
    updateNav()
  }

  const endpoints = [
    showcase?.dataset.endpoint || slider?.dataset.endpoint || '/api/instagram',
    showcase?.dataset.fallbackEndpoint,
  ].filter(Boolean) as string[]

  if (!endpoints.length) return

  fetchInstagramPosts(endpoints)
    .then(({ posts, source }) => {
      if (!posts.length) return

      if (showcase) hydrateInstagramShowcase(showcase, posts, source)

      // El carrusel quedó oculto en esta versión del módulo. Si se vuelve a
      // mostrar por CSS, conserva la capacidad de renderizar embeds reales.
      const shouldRenderSlider = !!(slider && track && getComputedStyle(slider).display !== 'none')
      if (shouldRenderSlider && track) renderInstagramEmbeds(track, posts, updateNav)
    })
    .catch(() => {
      showcase?.classList.add('is-empty')
    })
}

async function fetchInstagramPosts(endpoints: string[]): Promise<{ posts: IgCard[]; source: string }> {
  let lastError: unknown = null
  for (const endpoint of endpoints) {
    try {
      const r = await fetch(endpoint, { headers: { Accept: 'application/json' } })
      if (!r.ok) throw new Error(`instagram_${r.status}`)
      const data = await r.json() as { posts?: IgCard[]; source?: string }
      const posts = (data.posts || [])
        .filter((p) => p.permalink && p.img)
        .slice(0, 9)
      if (posts.length) return { posts, source: data.source || 'instagram' }
    } catch (e) {
      lastError = e
    }
  }
  throw lastError || new Error('instagram_empty')
}

function hydrateInstagramShowcase(showcase: HTMLElement, posts: IgCard[], source: string) {
  const clip = (str: string, n = 120) => (str.length > n ? str.slice(0, n - 1).trimEnd() + '…' : str)
  // Número pseudo-aleatorio pero ESTABLE por post (mismo permalink → mismo valor).
  const seed = (s: string) => {
    let h = 2166136261
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
    return (h >>> 0)
  }
  const nf = new Intl.NumberFormat('es-AR')
  const fakeLikes = (p: IgCard) => 90 + (seed(p.permalink || p.img || '') % 520)      // 90–609
  const fakeComments = (p: IgCard) => 4 + (seed((p.permalink || '') + 'c') % 44)       // 4–47
  const relTime = (ts?: string) => {
    if (!ts) return 'Hace poco'
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return 'Hace poco'
    const diff = Date.now() - d.getTime()
    const h = Math.floor(diff / 3.6e6)
    if (h < 1) return 'Hace instantes'
    if (h < 24) return `Hace ${h} h`
    const days = Math.floor(h / 24)
    if (days < 7) return `Hace ${days} d`
    const weeks = Math.floor(days / 7)
    if (weeks < 5) return `Hace ${weeks} sem`
    return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })
  }
  const addImg = (parent: HTMLElement, src: string, alt = '') => {
    parent.querySelector('img')?.remove()
    const img = document.createElement('img')
    img.src = src
    img.alt = alt
    img.loading = 'lazy'
    img.decoding = 'async'
    img.referrerPolicy = 'no-referrer'
    parent.prepend(img)
  }

  showcase.classList.add('is-live')
  showcase.querySelectorAll<HTMLElement>('[data-ig-count]').forEach((el) => {
    el.textContent = String(posts.length)
  })
  const sourceEl = showcase.querySelector<HTMLElement>('[data-ig-source]')
  if (sourceEl) sourceEl.textContent = source === 'live' ? 'Live' : source === 'cache' ? 'Cache IG' : 'Instagram'

  // Cada celular = un post real distinto (posts[0] y posts[1]).
  const phones = showcase.querySelectorAll<HTMLElement>('[data-ig-phone]')
  phones.forEach((phone) => {
    const idx = Number(phone.dataset.igPhone || 0)
    const post = posts[idx] || posts[posts.length - 1]
    if (!post) { phone.closest('.ig-phone')?.classList.add('is-empty'); return }

    const media = phone.querySelector<HTMLElement>('[data-ig-media]')
    if (media && post.img) {
      addImg(media, post.img, post.caption || 'Publicación real de Instagram de Flora')
      media.querySelector<HTMLElement>('[data-ig-loader]')?.remove()
      if (media instanceof HTMLAnchorElement && post.permalink) media.href = post.permalink
      const dots = media.querySelector<HTMLElement>('[data-ig-carddot]')
      if (dots) dots.hidden = post.type !== 'CAROUSEL_ALBUM'
    }

    const likes = phone.querySelector<HTMLElement>('[data-ig-likes]')
    if (likes) likes.textContent = nf.format(fakeLikes(post))
    const caption = phone.querySelector<HTMLElement>('[data-ig-caption]')
    if (caption) caption.textContent = clip(post.caption || 'Ver publicación real en Instagram.', 120)
    const comments = phone.querySelector<HTMLElement>('[data-ig-comments]')
    if (comments) comments.textContent = `Ver los ${fakeComments(post)} comentarios`
    const time = phone.querySelector<HTMLElement>('[data-ig-time]')
    if (time) time.textContent = relTime(post.timestamp)
  })
}

// Embeds oficiales de Instagram: usamos embed.js (script de instagram.com,
// gratuito y sin límites) para renderizar cada post real. Los permalinks salen
// de /api/instagram. El embed trae like/comentar nativos que abren Instagram.
function loadInstagramEmbedScript(): Promise<void> {
  return new Promise((resolve) => {
    const w = window as unknown as { instgrm?: { Embeds: { process: () => void } } }
    if (w.instgrm) return resolve()
    const existing = document.querySelector<HTMLScriptElement>('script[src*="instagram.com/embed.js"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      // por si ya cargó
      if (w.instgrm) resolve()
      return
    }
    const sc = document.createElement('script')
    sc.src = 'https://www.instagram.com/embed.js'
    sc.async = true
    sc.onload = () => resolve()
    sc.onerror = () => resolve()
    document.body.appendChild(sc)
  })
}

function renderInstagramEmbeds(track: HTMLElement, posts: IgCard[], updateNav: () => void) {
  const esc = (str: string) =>
    str.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
  const clip = (str: string) => (str.length > 140 ? str.slice(0, 137).trimEnd() + '…' : str)

  track.innerHTML = posts
    .map((p, i) => {
      const href = esc(p.permalink || '')
      return `<li class="ig-card ig-embed" role="listitem" data-ig-index="${i}">
        <blockquote class="instagram-media" data-instgrm-permalink="${href}" data-instgrm-version="14" style="margin:0;width:100%;min-width:0;max-width:100%;background:#fff;border-radius:16px"></blockquote>
      </li>`
    })
    .join('')

  const fallbackCard = (li: HTMLElement, post: IgCard) => {
    const href = esc(post.permalink || 'https://www.instagram.com/flora.cultivamosconciencia/')
    const img = esc(post.img || '')
    const cap = esc(clip(post.caption || 'Ver este posteo en Instagram.'))
    li.classList.remove('ig-embed')
    li.classList.add('is-fallback', 'ig-embed-fallback')
    li.innerHTML = `<a class="ig-card-link" href="${href}" target="_blank" rel="noopener noreferrer">
      <span class="ig-card-media">${img ? `<img src="${img}" alt="" loading="lazy" width="900" height="1100" />` : ''}</span>
      <span class="ig-card-body">
        <span class="ig-card-caption">${cap}</span>
        <span class="ig-card-cue">Ver en Instagram →</span>
      </span>
    </a>`
  }

  const replaceFailedEmbeds = () => {
    track.querySelectorAll<HTMLElement>('.ig-card.ig-embed').forEach((li) => {
      const idx = Number(li.dataset.igIndex || -1)
      const iframe = li.querySelector<HTMLIFrameElement>('iframe')
      const rendered = iframe?.classList.contains('instagram-media-rendered')
      const h = iframe?.getBoundingClientRect().height || 0
      if (!iframe || !rendered || h < 120) {
        const post = posts[idx]
        if (post) fallbackCard(li, post)
      }
    })
  }

  loadInstagramEmbedScript().then(() => {
    const w = window as unknown as { instgrm?: { Embeds: { process: () => void } } }
    try { w.instgrm?.Embeds.process() } catch {}
    // Los iframes de Instagram cargan async y cambian el ancho del track;
    // recalculamos navegación y reemplazamos embeds que queden colgados.
    const refresh = () => { updateNav(); try { ScrollTrigger.refresh() } catch {} }
    setTimeout(refresh, 800)
    setTimeout(refresh, 2000)
    setTimeout(() => { replaceFailedEmbeds(); refresh() }, 4500)
    setTimeout(() => { replaceFailedEmbeds(); refresh() }, 8000)
  })
}

// ── Welcome: relato de bienvenida con fondos que evolucionan ──
// El relato del hero (5 beats: 4 líneas + "Bienvenido a Flora") es una
// navegación paso a paso, no scroll-scrub: cada gesto (rueda, swipe, tecla)
// avanza o retrocede EXACTAMENTE un beat, sin importar qué tan brusco sea,
// para que no se salteen líneas sin leerlas — como ir pasando reels.
//
// Ya hubo un intento anterior de esto que se revirtió: bloqueaba el scroll
// real de la página cuando algo fallaba, dejando el sitio entero trabado.
// Esta versión evita ese riesgo de tres formas:
//   1. lockScroll()/unlockScroll() (el mismo mecanismo ya probado del gate
//      de edad) en vez de intentar interceptar el scroll nativo a medias.
//   2. El botón "Omitir introducción" siempre funciona, pase lo que pase
//      con el estado interno — es la vía de escape garantizada.
//   3. Un timeout de seguridad libera el lock solo si algo se cuelga.
function initWelcome() {
  const section  = document.querySelector<HTMLElement>('.welcome')
  if (!section) return

  // El hero-intro se muestra UNA sola vez por dispositivo — en visitas
  // siguientes aburre. Se saca del DOM antes de armar nada, así se entra
  // directo al resto de la home.
  const HERO_KEY = 'flora-hero-seen'
  const HERO_TTL = 180 * 24 * 60 * 60 * 1000 // 180 días
  try {
    const t = Number(localStorage.getItem(HERO_KEY) || 0)
    if (t && Date.now() - t < HERO_TTL) {
      section.remove()
      return
    }
    localStorage.setItem(HERO_KEY, String(Date.now()))
  } catch { /* sin storage, el hero se muestra normal */ }

  const stage   = section.querySelector<HTMLElement>('.welcome-stage')
  const imgs    = gsap.utils.toArray<HTMLElement>('.welcome-img')
  const lines   = gsap.utils.toArray<HTMLElement>('.welcome-line')
  const outro   = section.querySelector<HTMLElement>('.welcome-outro')
  const cue     = section.querySelector<HTMLElement>('.welcome-cue')
  const dots     = gsap.utils.toArray<HTMLElement>('.welcome-dot')
  const skipBtn  = section.querySelector<HTMLButtonElement>('.welcome-skip')
  const progress = section.querySelector<HTMLElement>('.welcome-progress')
  if (!stage || imgs.length === 0 || lines.length === 0) return

  const steps = lines.length

  // Reproduce sólo el video activo (ahorra CPU/datos); el resto en pausa con su poster
  const playOnly = (idx: number) => {
    imgs.forEach((el, k) => {
      if (!(el instanceof HTMLVideoElement)) return
      if (k === idx) { const p = el.play(); if (p && typeof p.catch === 'function') p.catch(() => {}) }
      else el.pause()
    })
  }

  // Reduced motion: mostramos el cierre del relato (poster estático), sin gestos
  if (prefersReducedMotion) {
    gsap.set(imgs, { opacity: 0 })
    gsap.set(imgs[steps - 1], { opacity: 1 })
    gsap.set(lines, { opacity: 0 })
    gsap.set(lines[steps - 1], { opacity: 1 })
    if (outro) gsap.set(outro, { opacity: 1, y: 0 })
    if (cue) gsap.set(cue, { opacity: 0 })
    if (progress) gsap.set(progress, { opacity: 0 })
    dots.forEach((d, i) => d.classList.toggle('is-on', i === steps - 1))
    return
  }

  // Estado inicial (GSAP setea el from, no el CSS)
  gsap.set(imgs, { opacity: 0, scale: 1.12 })
  gsap.set(imgs[0], { opacity: 1 })
  gsap.set(lines, { opacity: 0, y: 36 })
  gsap.set(lines[0], { opacity: 1, y: 0 })
  if (outro) gsap.set(outro, { opacity: 0, y: 36 })
  dots.forEach((d, i) => d.classList.toggle('is-on', i === 0))

  playOnly(0) // arranca el primer clip

  // Ruedita del mouse (solo se ve en desktop, por CSS) animada con GSAP —
  // evita líos de transform-box en SVG entre navegadores.
  const cueWheel = section.querySelector<SVGCircleElement>('.welcome-cue-wheel')
  if (cueWheel) {
    gsap.to(cueWheel, { y: 9, opacity: 0, duration: 0.7, ease: 'power1.in', repeat: -1, yoyo: true, repeatDelay: 0.3 })
  }

  const TRANS = 0.5       // crossfade entre beats
  const CUE_DELAY = 1.6   // si no gesticula nada, el cue reaparece a los X seg de asentado el beat

  let current = 0
  let animating = false
  let finished = false
  let cueTimer: ReturnType<typeof setTimeout> | null = null
  let safetyTimer: ReturnType<typeof setTimeout> | null = null

  function showCue(show: boolean) {
    if (!cue) return
    if (cueTimer) clearTimeout(cueTimer)
    gsap.to(cue, { opacity: show ? 1 : 0, duration: 0.35, ease: 'power1.out' })
  }
  function scheduleCue() {
    if (!cue || finished) return
    if (cueTimer) clearTimeout(cueTimer)
    cueTimer = setTimeout(() => showCue(true), CUE_DELAY * 1000)
  }

  function goToStep(i: number, dir: 1 | -1) {
    animating = true
    showCue(false)
    playOnly(i)
    const from = current
    current = i
    dots.forEach((d, k) => d.classList.toggle('is-on', k === i))

    // Salvavidas: si por lo que sea el timeline no dispara onComplete, no
    // queremos que 'animating' quede en true para siempre — a los 2s se
    // libera solo, en el peor caso el usuario siente medio segundo de más.
    if (safetyTimer) clearTimeout(safetyTimer)
    safetyTimer = setTimeout(() => { animating = false }, 2000)

    const tl = gsap.timeline({
      onComplete: () => {
        animating = false
        if (safetyTimer) clearTimeout(safetyTimer)
        scheduleCue()
      },
    })
    tl.to(imgs[i], { scale: 1.0, duration: TRANS * 1.8, ease: 'none' }, 0)
    tl.to(imgs[i], { opacity: 1, duration: TRANS }, 0)
    tl.to(imgs[from], { opacity: 0, duration: TRANS }, 0)
    tl.to(lines[from], { opacity: 0, y: dir === 1 ? -36 : 36, duration: TRANS * 0.8 }, 0)
    tl.to(lines[i], { opacity: 1, y: 0, duration: TRANS * 0.9 }, TRANS * 0.15)
  }

  function finishIntro() {
    if (finished) return
    finished = true
    showCue(false)
    // El grupo de progreso (dots + omitir) se esfuma primero — recién cuando
    // ya casi terminó de irse arrancan los CTAs finales, para que no se
    // sientan como que aparecen "todos juntos".
    if (progress) {
      gsap.to(progress, {
        opacity: 0, duration: 0.3, ease: 'power1.out',
        onComplete: () => { progress.style.visibility = 'hidden' },
      })
    }
    if (outro) gsap.to(outro, { opacity: 1, y: 0, duration: 0.5, delay: 0.2 })
    stopListening()
    unlockScroll()
  }

  function next() {
    if (finished) return
    if (animating) return
    if (current < steps - 1) goToStep(current + 1, 1)
    else finishIntro()
  }
  function prev() {
    if (finished || animating || current === 0) return
    goToStep(current - 1, -1)
  }

  // ── Gestos: rueda, swipe táctil y teclado — cada uno vale por UN paso,
  //    sin importar la distancia/velocidad del gesto físico. ──
  let touchStartX = 0
  let touchStartY = 0
  const SWIPE_MIN = 36 // px — piso para contar como gesto intencional

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    if (Math.abs(e.deltaY) < 2) return
    if (e.deltaY > 0) next(); else prev()
  }
  function onTouchStart(e: TouchEvent) {
    touchStartX = e.touches[0].clientX
    touchStartY = e.touches[0].clientY
  }
  function onTouchMove(e: TouchEvent) {
    e.preventDefault() // frena el scroll/rebote nativo mientras dura el relato
  }
  function onTouchEnd(e: TouchEvent) {
    const dy = touchStartY - e.changedTouches[0].clientY
    const dx = touchStartX - e.changedTouches[0].clientX
    if (Math.abs(dy) < SWIPE_MIN || Math.abs(dy) < Math.abs(dx)) return // gesto horizontal o muy chico: ignorar
    if (dy > 0) next(); else prev()
  }
  function onKeydown(e: KeyboardEvent) {
    if (['ArrowDown', 'ArrowRight', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); next() }
    else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); prev() }
    else if (e.key === 'Escape') finishIntro()
  }

  // Timeout de seguridad extra a nivel de toda la experiencia: si algo
  // impidiera el hand-off normal, esto libera el scroll solo igual — nunca
  // más "el sitio entero trabado" por este componente.
  let globalSafety: ReturnType<typeof setTimeout> | null = null

  function startListening() {
    lockScroll()
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('keydown', onKeydown)
    scheduleCue()
    globalSafety = setTimeout(finishIntro, 90_000)
  }
  function stopListening() {
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('touchstart', onTouchStart)
    window.removeEventListener('touchmove', onTouchMove)
    window.removeEventListener('touchend', onTouchEnd)
    window.removeEventListener('keydown', onKeydown)
    if (cueTimer) clearTimeout(cueTimer)
    if (safetyTimer) clearTimeout(safetyTimer)
    if (globalSafety) clearTimeout(globalSafety)
  }

  if (skipBtn) skipBtn.addEventListener('click', finishIntro)

  if (loaderDone) startListening()
  else window.addEventListener('flora:loader-done', startListening, { once: true })
}

// ── Reveal simple: el movimiento por defecto del giro (fade + y al entrar) ──
function initReveal() {
  const els = Array.from(document.querySelectorAll<HTMLElement>('.reveal'))
  if (els.length === 0) return

  // reduced-motion: mostramos todo de una, sin animar
  if (prefersReducedMotion) {
    els.forEach((el) => el.classList.add('is-in'))
    return
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const el = entry.target as HTMLElement
        io.unobserve(el)
        const delay = Number(el.dataset.revealDelay || 0)
        if (delay) el.style.transitionDelay = delay + 'ms'
        el.classList.add('is-in')
      })
    },
    { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
  )
  els.forEach((el) => io.observe(el))
}

// ── Perfiles: flechas del carrusel horizontal ──
// ── Perfiles: expandir card con tap (donde no hay hover) ──
function initPerfilesExpand() {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.fl-perfil-card'))
  if (!cards.length) return
  cards.forEach((card) => {
    const toggle = card.querySelector<HTMLButtonElement>('.fl-perfil-card-toggle')
    if (!toggle) return
    toggle.addEventListener('click', () => {
      const open = card.classList.toggle('is-open')
      toggle.setAttribute('aria-expanded', String(open))
      if (open) {
        cards.forEach((c) => {
          if (c !== card) {
            c.classList.remove('is-open')
            c.querySelector('.fl-perfil-card-toggle')?.setAttribute('aria-expanded', 'false')
          }
        })
      }
    })
  })
}

// Autodeslizante e infinito, mismo mecanismo que el carrusel de la carta de
// socios: el markup ya trae 3 copias seguidas del listado (perfilesLoop) y
// acá medimos el ancho de UNA copia (loopOffset) para arrancar en la 2ª
// copia y, en cada frame, rebobinar sin costura al llegar a los bordes.
function initPerfilesCarousel() {
  const track = document.querySelector<HTMLElement>('[data-carousel-track]')
  const prevBtn = document.querySelector<HTMLButtonElement>('[data-carousel-prev]')
  const nextBtn = document.querySelector<HTMLButtonElement>('[data-carousel-next]')
  if (!track || !prevBtn || !nextBtn) return

  const SPEED = 0.6 // px por frame — misma cadencia pausada que la carta de socios
  const cardGap = 16
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let loopOffset = 0
  let centered = false
  let hoverPaused = false
  let touchPaused = false
  let resumeTimer: ReturnType<typeof setTimeout> | null = null

  function pauseSoon(delay: number) {
    touchPaused = true
    clearTimeout(resumeTimer as ReturnType<typeof setTimeout>)
    resumeTimer = setTimeout(() => { touchPaused = false }, delay)
  }

  function measure() {
    const cards = track!.querySelectorAll<HTMLElement>('.fl-perfil-card')
    const singleCount = cards.length / 3
    const secondCopyStart = cards[singleCount]
    loopOffset = secondCopyStart ? secondCopyStart.offsetLeft : 0
    if (!centered && loopOffset > 0) { track!.scrollLeft = loopOffset; centered = true }
  }

  function stepAmount() {
    const card = track!.querySelector<HTMLElement>('.fl-perfil-card')
    return (card?.offsetWidth ?? 280) + cardGap
  }

  track.addEventListener('mouseenter', () => { hoverPaused = true })
  track.addEventListener('mouseleave', () => { hoverPaused = false })
  track.addEventListener('touchstart', () => { touchPaused = true; clearTimeout(resumeTimer as ReturnType<typeof setTimeout>) }, { passive: true })
  track.addEventListener('touchend', () => pauseSoon(4000), { passive: true })
  track.addEventListener('wheel', () => pauseSoon(4000), { passive: true })
  track.addEventListener('focusin', () => pauseSoon(8000))
  window.addEventListener('resize', () => requestAnimationFrame(measure))

  // Arrastrar con el mouse para mover el carrusel a gusto
  let dragging = false, lastX = 0
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return
    dragging = true; lastX = e.clientX; track!.classList.add('is-grabbing')
  })
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return
    track!.scrollLeft -= (e.clientX - lastX); lastX = e.clientX
  })
  window.addEventListener('pointerup', () => {
    if (!dragging) return
    dragging = false; track!.classList.remove('is-grabbing')
  })

  prevBtn.addEventListener('click', () => { track.scrollLeft -= stepAmount(); pauseSoon(4000) })
  nextBtn.addEventListener('click', () => { track.scrollLeft += stepAmount(); pauseSoon(4000) })

  requestAnimationFrame(measure)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure)

  function frame() {
    if (loopOffset > 0 && !hoverPaused && !touchPaused && !reduceMotion) {
      track!.scrollLeft += SPEED
      if (track!.scrollLeft < loopOffset) track!.scrollLeft += loopOffset
      else if (track!.scrollLeft >= loopOffset * 2) track!.scrollLeft -= loopOffset
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

function init() {
  initLoader()
  initSmoothAnchors()
  initNav()
  initMobileDrawer()
  initNavDropdown()
  initDrawerDropdown()
  initHeroImage()
  initHeroVideo()
  initAccesoVideo()
  initAccesoScene()
  initAccesoPortalGlint()
  initYouTubeFacades()
  initParticles()

  splitWords()
  ScrollTrigger.refresh()

  initWelcome()
  initReveal()
  initPerfilesCarousel()
  initPerfilesExpand()
  animateSplitWords()
  initClipReveal()
  initFadeIn()
  initScrollProgress()
  initProductTabs()
  initWhatsAppFloat()
  initInstagramFeed()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
