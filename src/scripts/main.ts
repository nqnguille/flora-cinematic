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

function raf(time: number) {
  lenis.raf(time)
  ScrollTrigger.update()
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
const unlockScroll = () => {
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
  lenis.start()
}

// ── Nav scroll behavior ──
function initNav() {
  const nav = document.querySelector<HTMLElement>('.site-nav')
  if (!nav) return

  ScrollTrigger.create({
    start: 'top -60px',
    onEnter: () => nav.classList.add('scrolled'),
    onLeaveBack: () => nav.classList.remove('scrolled'),
  })
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

// ── Parallax hero ──
function initHeroParallax() {
  if (prefersReducedMotion) return

  const heroVisual = document.querySelector<HTMLElement>('.hero-visual')
  if (!heroVisual) return

  gsap.to(heroVisual, {
    yPercent: -25,
    ease: 'none',
    scrollTrigger: {
      trigger: '.hero',
      start: 'top top',
      end: 'bottom top',
      scrub: true,
    }
  })
}

// ── Contadores ──
function initCounters() {
  if (prefersReducedMotion) return

  gsap.utils.toArray<HTMLElement>('.count-up').forEach(el => {
    const target = parseInt(el.dataset.target || '0')
    const suffix = el.dataset.suffix || ''
    const obj = { val: 0 }

    gsap.to(obj, {
      val: target,
      duration: 1.6,
      ease: 'power2.out',
      snap: { val: 1 },
      onUpdate() {
        el.textContent = Math.round(obj.val).toString() + suffix
      },
      scrollTrigger: {
        trigger: el,
        start: 'top 80%',
        once: true
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

// ── Horizontal scroll membresías ──
function initHorizontalScroll() {
  const mm = gsap.matchMedia()

  mm.add('(min-width: 768px)', () => {
    if (prefersReducedMotion) return

    const track = document.querySelector<HTMLElement>('.cards-track')
    const section = document.querySelector<HTMLElement>('.horizontal-section')
    if (!track || !section) return

    const cards = gsap.utils.toArray<HTMLElement>('.membresia-card')

    ScrollTrigger.refresh()

    // Distancia a trasladar = overflow real del track respecto del ANCHO VISIBLE
    // del wrapper (no del viewport). La sección tiene una columna de label a la
    // izquierda, así que el área visible del slider es más angosta que la ventana;
    // usar window.innerWidth dejaba la 4ª card (Tierra) fuera de pantalla.
    const wrapper = track.parentElement as HTMLElement | null
    const getTotal = () => {
      const last = cards[cards.length - 1]
      if (!last || !wrapper) return 0
      const x = (gsap.getProperty(track, 'x') as number) || 0
      const lastRight = last.getBoundingClientRect().right - x // borde derecho sin transform
      const wrapRight = wrapper.getBoundingClientRect().right
      return Math.max(0, lastRight - wrapRight + 40)
    }

    const tween = gsap.to(track, {
      x: () => -getTotal(),
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top top',
        end: () => `+=${getTotal() + window.innerHeight}`,
        pin: true,
        scrub: 1.2,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      }
    })

    // Hover tilt suave
    cards.forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect()
        const x = (e.clientX - rect.left) / rect.width - 0.5
        const y = (e.clientY - rect.top) / rect.height - 0.5
        gsap.to(card, {
          rotateY: x * 8,
          rotateX: -y * 8,
          duration: 0.5,
          ease: 'power2.out',
          transformPerspective: 900
        })
      })

      card.addEventListener('mouseleave', () => {
        gsap.to(card, {
          rotateY: 0,
          rotateX: 0,
          duration: 0.7,
          ease: 'elastic.out(1, 0.5)'
        })
      })
    })

    return () => {
      tween.kill()
    }
  })
}

// ── Step line draw ──
function initStepLine() {
  const line = document.querySelector<HTMLElement>('.step-line')
  if (!line) return

  if (prefersReducedMotion) {
    // Sin animación: mostrar la línea directamente
    line.style.transform = 'scaleY(1)'
    return
  }

  gsap.to(line, {
    scaleY: 1,
    transformOrigin: 'top center',
    ease: 'power2.inOut',
    scrollTrigger: {
      trigger: '.steps-section',
      start: 'top 65%',
      end: 'bottom 75%',
      scrub: 0.6,
    }
  })
}

// ── Bento items stagger ──
function initBentoItems() {
  if (prefersReducedMotion) return

  const items = gsap.utils.toArray<HTMLElement>('.bento-item')
  items.forEach((item, i) => {
    gsap.set(item, { opacity: 0, y: 20 })
    gsap.to(item, {
      opacity: 1,
      y: 0,
      duration: 0.6,
      ease: 'power2.out',
      delay: i * 0.07,
      scrollTrigger: {
        trigger: item,
        start: 'top 88%',
      }
    })
  })

  // Statement editorial
  const statement = document.querySelector<HTMLElement>('.bento-statement')
  if (statement) {
    gsap.set(statement, { opacity: 0, y: 16 })
    gsap.to(statement, {
      opacity: 1,
      y: 0,
      duration: 0.8,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: statement,
        start: 'top 85%',
      }
    })
  }
}

// ── Hero entrance ──
function initHeroEntrance() {
  if (prefersReducedMotion) return

  const eyebrow = document.querySelector<HTMLElement>('.hero-eyebrow')
  const title   = document.querySelector<HTMLElement>('.hero-title')
  const bottom  = document.querySelector<HTMLElement>('.hero-bottom')
  const scrollInd = document.querySelector<HTMLElement>('.scroll-indicator')
  const ticker  = document.querySelector<HTMLElement>('.hero-ticker')

  // Setear estados iniciales con GSAP
  if (eyebrow) gsap.set(eyebrow, { opacity: 0, y: 12 })
  if (bottom)  gsap.set(bottom,  { opacity: 0, y: 18 })
  if (scrollInd) gsap.set(scrollInd, { opacity: 0 })
  if (ticker)  gsap.set(ticker, { opacity: 0 })

  // El manifiesto ya no es lo primero (lo precede el welcome): la entrada se
  // dispara al llegar scrolleando, no en la carga.
  const tl = gsap.timeline({
    scrollTrigger: { trigger: '.hero', start: 'top 72%' },
  })

  if (eyebrow) tl.to(eyebrow, { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out' })

  if (title) {
    const inners = title.querySelectorAll<HTMLElement>('.word-inner')
    if (inners.length > 0) {
      // Setear estado inicial
      gsap.set(inners, { yPercent: 110, opacity: 0 })
      tl.to(inners, {
        yPercent: 0,
        opacity: 1,
        duration: 0.9,
        stagger: 0.055,
        ease: 'power3.out',
      }, '-=0.15')
    }
  }

  if (bottom) tl.to(bottom, { opacity: 1, y: 0, duration: 0.65, ease: 'power2.out' }, '-=0.45')
  if (scrollInd) tl.to(scrollInd, { opacity: 1, duration: 0.5 }, '-=0.35')
  if (ticker) tl.to(ticker, { opacity: 1, duration: 0.5 }, '-=0.4')
}

// ── Stat items ──
function initStats() {
  if (prefersReducedMotion) return

  gsap.utils.toArray<HTMLElement>('.stat-item').forEach((item, i) => {
    gsap.set(item, { opacity: 0, y: 16 })
    gsap.to(item, {
      opacity: 1,
      y: 0,
      duration: 0.6,
      ease: 'power2.out',
      delay: i * 0.08,
      scrollTrigger: {
        trigger: item,
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

// ── Custom cursor ──
function initCursor() {
  const isTouch = window.matchMedia('(hover: none)').matches
  if (isTouch || prefersReducedMotion) return

  // Recién acá ocultamos el cursor nativo: el custom ya existe
  document.body.classList.add('custom-cursor')

  const dot  = document.createElement('div')
  const ring = document.createElement('div')
  dot.className  = 'cursor-dot'
  ring.className = 'cursor-ring'
  document.body.append(dot, ring)

  let mx = 0, my = 0, rx = 0, ry = 0

  document.addEventListener('mousemove', (e) => {
    mx = e.clientX
    my = e.clientY
    gsap.set(dot, { x: mx, y: my })
  })

  ;(function animateRing() {
    rx += (mx - rx) * 0.1
    ry += (my - ry) * 0.1
    gsap.set(ring, { x: rx, y: ry })
    requestAnimationFrame(animateRing)
  })()

  document.querySelectorAll('a, button, .membresia-card, .btn-primary, .btn-secondary').forEach(el => {
    el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'))
    el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'))
  })

  document.addEventListener('mouseleave', () => gsap.to([dot, ring], { opacity: 0, duration: 0.25 }))
  document.addEventListener('mouseenter', () => gsap.to([dot, ring], { opacity: 1, duration: 0.25 }))
}

// ── Magnetic buttons ──
function initMagnetic() {
  const isTouch = window.matchMedia('(hover: none)').matches
  if (isTouch || prefersReducedMotion) return

  document.querySelectorAll<HTMLElement>('.btn-primary, .btn-secondary, .footer-cta-band .btn-primary').forEach(btn => {
    btn.addEventListener('mousemove', (e) => {
      const r = btn.getBoundingClientRect()
      const x = (e.clientX - r.left - r.width  / 2)
      const y = (e.clientY - r.top  - r.height / 2)
      gsap.to(btn, { x: x * 0.22, y: y * 0.22, duration: 0.4, ease: 'power2.out' })
    })
    btn.addEventListener('mouseleave', () => {
      gsap.to(btn, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.45)' })
    })
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
}

// ── Instagram: slider en vivo (feed JSON servido por Behold) ──
interface IgSize { mediaUrl?: string }
interface IgPost {
  id: string
  caption?: string
  prunedCaption?: string
  mediaType?: string
  mediaUrl?: string
  thumbnailUrl?: string
  permalink: string
  timestamp?: string
  sizes?: { small?: IgSize; medium?: IgSize; large?: IgSize; full?: IgSize }
}

function initInstagramFeed() {
  const slider = document.querySelector<HTMLElement>('.ig-slider')
  if (!slider) return
  const track = slider.querySelector<HTMLElement>('.ig-track')
  const prev = slider.querySelector<HTMLButtonElement>('.ig-prev')
  const next = slider.querySelector<HTMLButtonElement>('.ig-next')
  if (!track) return

  // Navegación por flechas: desplaza ~una tarjeta + gap
  const step = () => {
    const card = track.querySelector<HTMLElement>('.ig-card')
    return card ? card.offsetWidth + 20 : 300
  }
  const updateNav = () => {
    if (!prev || !next) return
    const max = track.scrollWidth - track.clientWidth - 2
    prev.disabled = track.scrollLeft <= 2
    next.disabled = track.scrollLeft >= max
  }
  prev?.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }))
  next?.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }))
  track.addEventListener('scroll', updateNav, { passive: true })

  // Trae los posteos reales; si falla, quedan las tarjetas de respaldo
  const feed = slider.dataset.feed
  if (feed) {
    fetch(feed, { headers: { Accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { posts?: IgPost[] }) => {
        const posts = (data.posts || []).filter(p => p.permalink)
        if (!posts.length) return
        renderInstagramPosts(track, posts)
        updateNav()
        ScrollTrigger.refresh()
      })
      .catch(() => {/* se mantiene el fallback */})
  }
  updateNav()
}

function renderInstagramPosts(track: HTMLElement, posts: IgPost[]) {
  const fmt = (ts?: string) => {
    if (!ts) return ''
    const d = new Date(ts)
    return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
  }
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
  const clip = (s: string) => (s.length > 140 ? s.slice(0, 137).trimEnd() + '…' : s)

  // Behold sirve imágenes estables (hop.behold.pictures) en `sizes`; se
  // prefieren a la mediaUrl cruda de Instagram, que caduca.
  const pickImg = (p: IgPost) =>
    p.sizes?.medium?.mediaUrl || p.sizes?.large?.mediaUrl || p.sizes?.small?.mediaUrl ||
    (p.mediaType === 'VIDEO' ? p.thumbnailUrl : p.mediaUrl) || p.thumbnailUrl || p.mediaUrl

  track.innerHTML = posts
    .map(p => {
      const img = pickImg(p)
      const rawCap = p.prunedCaption || p.caption
      const cap = rawCap ? esc(clip(rawCap)) : 'Ver este posteo en Instagram.'
      const media = img
        ? `<span class="ig-card-media"><img src="${esc(img)}" alt="" loading="lazy" /></span>`
        : `<span class="ig-card-media" aria-hidden="true"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg></span>`
      return `<li class="ig-card" role="listitem">
        <a class="ig-card-link" href="${esc(p.permalink)}" target="_blank" rel="noopener noreferrer">
          ${media}
          <span class="ig-card-body">
            <span class="ig-card-caption">${cap}</span>
            <span class="ig-card-date">${fmt(p.timestamp)}</span>
          </span>
        </a>
      </li>`
    })
    .join('')
}

// ── Welcome: relato de bienvenida con fondos que evolucionan ──
// El relato del hero (5 beats: 4 líneas + "Bienvenido a Flora") es una
// navegación paso a paso, no un scroll-scrub continuo: cada gesto (rueda,
// swipe, tecla) avanza o retrocede EXACTAMENTE un beat, con el mismo "lock"
// anti-ráfaga que el gate de edad, para que un movimiento brusco de dedo no
// se salte líneas sin leerlas — como ir pasando reels, no scrolleando.
// Recién al pedir avanzar desde el último beat (con los botones ya
// visibles) se libera el scroll y el usuario sigue navegando el sitio.
// El relato del hero vuelve a ser scroll-scrub continuo (no un lock por
// pasos): el intento de "un swipe = un paso" bloqueaba el scroll real de la
// página apenas el usuario no scrolleaba con el timing exacto que esperaba
// el cooldown, y eso rompía la navegación del sitio entero. Para que un
// swipe brusco no se salte todo el relato igual, la distancia de scroll
// virtual es generosa (steps * 1.6 pantallas) sin llegar a bloquear nada.
function initWelcome() {
  const section  = document.querySelector<HTMLElement>('.welcome')
  if (!section) return
  const stage    = section.querySelector<HTMLElement>('.welcome-stage')
  const imgs     = gsap.utils.toArray<HTMLElement>('.welcome-img')
  const lines    = gsap.utils.toArray<HTMLElement>('.welcome-line')
  const outro    = section.querySelector<HTMLElement>('.welcome-outro')
  const cue      = section.querySelector<HTMLElement>('.welcome-cue')
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

  // Reduced motion: mostramos el cierre del relato (poster estático), sin scrub
  if (prefersReducedMotion) {
    gsap.set(imgs, { opacity: 0 })
    gsap.set(imgs[steps - 1], { opacity: 1 })
    gsap.set(lines, { opacity: 0 })
    gsap.set(lines[steps - 1], { opacity: 1 })
    if (outro) gsap.set(outro, { opacity: 1, y: 0 })
    if (cue) gsap.set(cue, { opacity: 0 })
    return
  }

  // Estado inicial (GSAP setea el from, no el CSS)
  gsap.set(imgs, { opacity: 0, scale: 1.12 })
  gsap.set(imgs[0], { opacity: 1 })
  gsap.set(lines, { opacity: 0, y: 36 })
  gsap.set(lines[0], { opacity: 1, y: 0 })
  if (outro) gsap.set(outro, { opacity: 0, y: 36 })

  playOnly(0) // arranca el primer clip

  // Ruedita del mouse (solo se ve en desktop, por CSS) animada con GSAP —
  // evita líos de transform-box en SVG entre navegadores.
  const cueWheel = section.querySelector<SVGCircleElement>('.welcome-cue-wheel')
  if (cueWheel) {
    gsap.to(cueWheel, { y: 9, opacity: 0, duration: 0.7, ease: 'power1.in', repeat: -1, yoyo: true, repeatDelay: 0.3 })
  }

  const TRANS = 0.6   // crossfade
  const HOLD = 1.0    // permanencia de cada beat

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: section,
      start: 'top top',
      end: () => '+=' + Math.round(window.innerHeight * steps * 1.6),
      pin: stage,
      scrub: 1,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
  })

  for (let i = 0; i < steps; i++) {
    // Reproduce el clip de este beat (fire en ambos sentidos del scrub)
    tl.call(() => playOnly(i), undefined, i === 0 ? 0 : '<')

    // Ken Burns: la imagen activa se asienta de 1.12 → 1.0 durante su beat
    tl.to(imgs[i], { scale: 1.0, duration: HOLD + TRANS, ease: 'none' }, i === 0 ? 0 : '<')

    if (i > 0) {
      tl.to(imgs[i], { opacity: 1, duration: TRANS }, '<')
      tl.to(imgs[i - 1], { opacity: 0, duration: TRANS }, '<')
      tl.to(lines[i], { opacity: 1, y: 0, duration: TRANS * 0.9 }, '<0.1')
    }

    tl.to({}, { duration: HOLD }) // hold

    if (i < steps - 1) {
      tl.to(lines[i], { opacity: 0, y: -36, duration: TRANS * 0.8 })
    }
  }

  if (outro) tl.to(outro, { opacity: 1, y: 0, duration: TRANS }, '-=0.1')

  // El cue desaparece apenas se empieza a scrollear
  if (cue) {
    gsap.to(cue, {
      opacity: 0,
      scrollTrigger: {
        trigger: section,
        start: 'top top',
        end: '+=' + Math.round(window.innerHeight * 0.5),
        scrub: true,
      },
    })
  }
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

// ── Acceso: selector de cantidad de material vegetal ──
function initAcceso() {
  const picker = document.querySelector<HTMLElement>('.fl-acceso-picker')
  if (!picker) return
  const buttons = Array.from(picker.querySelectorAll<HTMLButtonElement>('.fl-amount'))
  const amountEl = picker.querySelector<HTMLElement>('[data-acceso-amount]')
  const cta = picker.querySelector<HTMLAnchorElement>('[data-acceso-cta]')

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => {
        b.classList.remove('is-active')
        b.setAttribute('aria-pressed', 'false')
      })
      btn.classList.add('is-active')
      btn.setAttribute('aria-pressed', 'true')
      if (amountEl && btn.dataset.g) amountEl.textContent = btn.dataset.g
      if (cta && btn.dataset.wa) cta.setAttribute('href', btn.dataset.wa)
    })
  })
}

function init() {
  initLoader()
  initNav()
  initMobileDrawer()
  initHeroImage()
  initHeroVideo()
  initYouTubeFacades()
  initParticles()
  // initCursor() — desactivado: se usa el cursor nativo (flecha + manito)

  splitWords()
  ScrollTrigger.refresh()

  initWelcome()
  initReveal()
  initAcceso()
  animateSplitWords()
  initClipReveal()
  initFadeIn()
  initScrollProgress()
  initMagnetic()
  initProductTabs()
  initWhatsAppFloat()
  initInstagramFeed()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
