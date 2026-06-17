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

    const getTotal = () => track.scrollWidth - window.innerWidth + 100

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

  const tl = gsap.timeline({ delay: 0.15 })

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

// ── Page loader ──
function initLoader() {
  const loader = document.querySelector<HTMLElement>('.page-loader')
  if (!loader) return

  const logo    = loader.querySelector<HTMLElement>('.loader-logo')
  const tagline = loader.querySelector<HTMLElement>('.loader-tagline')
  const bar     = loader.querySelector<HTMLElement>('.loader-progress')

  if (prefersReducedMotion) {
    loader.style.display = 'none'
    document.body.style.overflow = ''
    return
  }

  document.body.style.overflow = 'hidden'

  const tl = gsap.timeline({
    onComplete: () => {
      document.body.style.overflow = ''
    }
  })

  tl.to(logo,    { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' })
    .to(tagline, { opacity: 1, duration: 0.35, ease: 'power2.out' }, '-=0.1')
    .to(bar,     { width: '100%', duration: 0.5, ease: 'power1.inOut' }, 0)
    .to(loader,  { yPercent: -100, duration: 0.7, ease: 'power3.inOut', delay: 0.1 })
    .set(loader, { display: 'none' })
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
    document.body.style.overflow = 'hidden'
    // Foco al cierre para accesibilidad
    setTimeout(() => closeBtn?.focus(), 50)
  }

  const closeDrawer = () => {
    drawer.hidden = true
    hamburger.setAttribute('aria-expanded', 'false')
    document.body.style.overflow = ''
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
function init() {
  initLoader()
  initNav()
  initMobileDrawer()
  initHeroImage()
  initHeroVideo()
  initYouTubeFacades()
  initParticles()
  initCursor()

  splitWords()
  ScrollTrigger.refresh()

  initHeroEntrance()
  initHeroParallax()
  animateSplitWords()
  initCounters()
  initClipReveal()
  initHorizontalScroll()
  initStepLine()
  initBentoItems()
  initStats()
  initFadeIn()
  initScrollProgress()
  initMagnetic()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
