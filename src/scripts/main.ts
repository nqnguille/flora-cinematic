import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

// ── Smooth scroll con Lenis ──
const lenis = new Lenis({
  duration: 1.2,
  easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  smoothWheel: true,
})

function raf(time: number) {
  lenis.raf(time)
  ScrollTrigger.update()
  requestAnimationFrame(raf)
}
requestAnimationFrame(raf)

// ── Split words ──
function splitWords() {
  document.querySelectorAll<HTMLElement>('.split-words').forEach(el => {
    // Preserve <br> and <em> by reading innerHTML and splitting on <br>
    const raw = el.innerHTML
    // Split on existing <br> tags (literal line breaks in HTML)
    const lines = raw.split(/<br\s*\/?>/i)
    el.innerHTML = lines.map(line => {
      // Split words but keep inline tags like <em> together
      // Use a temporary div to parse the line HTML into text tokens
      const tmp = document.createElement('span')
      tmp.innerHTML = line.trim()
      // Walk child nodes: text nodes split by space, element nodes kept whole
      const tokens: string[] = []
      tmp.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          const words = (node.textContent || '').trim().split(/\s+/).filter(Boolean)
          words.forEach(w => tokens.push(`<span class="word"><span class="word-inner">${w}</span></span>`))
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const elem = node as HTMLElement
          const words = (elem.textContent || '').trim().split(/\s+/).filter(Boolean)
          words.forEach(w => {
            const wrapped = document.createElement(elem.tagName.toLowerCase())
            wrapped.className = elem.className
            wrapped.innerHTML = w
            tokens.push(`<span class="word"><span class="word-inner"><${elem.tagName.toLowerCase()}>${w}</${elem.tagName.toLowerCase()}></span></span>`)
          })
        }
      })
      return tokens.join(' ')
    }).join('<br>')
  })
}

function animateSplitWords() {
  gsap.utils.toArray<HTMLElement>('.split-words').forEach(el => {
    const inners = el.querySelectorAll<HTMLElement>('.word-inner')
    gsap.from(inners, {
      yPercent: 110,
      opacity: 0,
      duration: 0.9,
      stagger: 0.06,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: el,
        start: 'top 85%',
      }
    })
  })
}

// ── Parallax hero ──
function initHeroParallax() {
  const heroVisual = document.querySelector<HTMLElement>('.hero-visual')
  if (!heroVisual) return

  gsap.to(heroVisual, {
    yPercent: -30,
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
  gsap.utils.toArray<HTMLElement>('.count-up').forEach(el => {
    const target = parseInt(el.dataset.target || '0')
    const suffix = el.dataset.suffix || ''
    const obj = { val: 0 }

    gsap.to(obj, {
      val: target,
      duration: 1.8,
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

// ── Clip-path reveal ──
function initClipReveal() {
  gsap.utils.toArray<HTMLElement>('.clip-reveal').forEach(el => {
    gsap.from(el, {
      clipPath: 'inset(100% 0% 0% 0%)',
      duration: 1.1,
      ease: 'power4.out',
      scrollTrigger: {
        trigger: el,
        start: 'top 80%'
      }
    })
  })
}

// ── Horizontal scroll membresías ──
function initHorizontalScroll() {
  const mm = gsap.matchMedia()

  mm.add('(min-width: 768px)', () => {
    const track = document.querySelector<HTMLElement>('.cards-track')
    const section = document.querySelector<HTMLElement>('.horizontal-section')
    if (!track || !section) return

    const cards = gsap.utils.toArray<HTMLElement>('.membresia-card')

    // Calcular scroll total después de que el layout esté listo
    ScrollTrigger.refresh()

    const getTotal = () => track.scrollWidth - window.innerWidth + 120

    const tween = gsap.to(track, {
      x: () => -getTotal(),
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top top',
        end: () => `+=${getTotal() + window.innerHeight}`,
        pin: true,
        scrub: 1,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      }
    })

    // Hover tilt
    cards.forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect()
        const x = (e.clientX - rect.left) / rect.width - 0.5
        const y = (e.clientY - rect.top) / rect.height - 0.5
        gsap.to(card, {
          rotateY: x * 12,
          rotateX: -y * 12,
          duration: 0.4,
          ease: 'power2.out',
          transformPerspective: 800
        })
      })

      card.addEventListener('mouseleave', () => {
        gsap.to(card, {
          rotateY: 0,
          rotateX: 0,
          duration: 0.6,
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

  gsap.from(line, {
    scaleY: 0,
    transformOrigin: 'top center',
    duration: 1,
    ease: 'power2.inOut',
    scrollTrigger: {
      trigger: '.steps-section',
      start: 'top 60%',
      end: 'bottom 80%',
      scrub: 0.5,
    }
  })
}

// ── Hero entrance ──
function initHeroEntrance() {
  const badge = document.querySelector<HTMLElement>('.hero-badge')
  const title = document.querySelector<HTMLElement>('.hero-title')
  const subtext = document.querySelector<HTMLElement>('.hero-subtext')
  const ctas = document.querySelector<HTMLElement>('.hero-ctas')
  const scrollInd = document.querySelector<HTMLElement>('.scroll-indicator')

  const tl = gsap.timeline({ delay: 0.2 })

  if (badge) tl.from(badge, { opacity: 0, y: 16, duration: 0.6, ease: 'power2.out' })

  if (title) {
    const inners = title.querySelectorAll<HTMLElement>('.word-inner')
    if (inners.length > 0) {
      tl.from(inners, {
        yPercent: 110,
        opacity: 0,
        duration: 0.9,
        stagger: 0.06,
        ease: 'power3.out',
      }, '-=0.2')
    }
  }

  if (subtext) tl.from(subtext, { opacity: 0, y: 20, duration: 0.7, ease: 'power2.out' }, '-=0.4')
  if (ctas) tl.from(ctas, { opacity: 0, y: 20, duration: 0.7, ease: 'power2.out' }, '-=0.5')
  if (scrollInd) tl.from(scrollInd, { opacity: 0, duration: 0.5 }, '-=0.3')
}

// ── Why items stagger ──
function initWhyItems() {
  gsap.utils.toArray<HTMLElement>('.why-item').forEach((item, i) => {
    gsap.from(item, {
      opacity: 0,
      x: 30,
      duration: 0.7,
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
  const logo = loader.querySelector<HTMLElement>('.loader-logo')
  const bar  = loader.querySelector<HTMLElement>('.loader-progress')

  const tl = gsap.timeline()
  tl.to(logo, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' })
    .to(bar,   { width: '100%', duration: 0.55, ease: 'power1.inOut' }, 0)
    .to(loader, { yPercent: -100, duration: 0.75, ease: 'power3.inOut', delay: 0.05 })
    .set(loader, { display: 'none' })
}

// ── Scroll progress bar ──
function initScrollProgress() {
  const bar = document.querySelector<HTMLElement>('.scroll-progress')
  if (!bar) return
  gsap.to(bar, {
    scaleX: 1,
    ease: 'none',
    scrollTrigger: {
      trigger: document.body,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.15,
    }
  })
}

// ── Custom cursor ──
function initCursor() {
  const isTouch = window.matchMedia('(hover: none)').matches
  if (isTouch) return

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
    rx += (mx - rx) * 0.11
    ry += (my - ry) * 0.11
    gsap.set(ring, { x: rx, y: ry })
    requestAnimationFrame(animateRing)
  })()

  document.querySelectorAll('a, button, .membresia-card, .btn-primary, .btn-secondary').forEach(el => {
    el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'))
    el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'))
  })

  document.addEventListener('mouseleave', () => gsap.to([dot, ring], { opacity: 0, duration: 0.3 }))
  document.addEventListener('mouseenter', () => gsap.to([dot, ring], { opacity: 1, duration: 0.3 }))
}

// ── Magnetic buttons ──
function initMagnetic() {
  const isTouch = window.matchMedia('(hover: none)').matches
  if (isTouch) return

  document.querySelectorAll<HTMLElement>('.btn-primary, .btn-secondary, .footer-cta-band .btn-primary').forEach(btn => {
    btn.addEventListener('mousemove', (e) => {
      const r = btn.getBoundingClientRect()
      const x = (e.clientX - r.left - r.width  / 2)
      const y = (e.clientY - r.top  - r.height / 2)
      gsap.to(btn, { x: x * 0.28, y: y * 0.28, duration: 0.4, ease: 'power2.out' })
    })
    btn.addEventListener('mouseleave', () => {
      gsap.to(btn, { x: 0, y: 0, duration: 0.65, ease: 'elastic.out(1, 0.45)' })
    })
  })
}

// ── Partículas flotantes ──
function initParticles() {
  const container = document.querySelector<HTMLElement>('.hero-particles')
  if (!container) return
  for (let i = 0; i < 22; i++) {
    const p = document.createElement('div')
    p.className = 'particle'
    p.style.setProperty('--dur',   `${7 + Math.random() * 9}s`)
    p.style.setProperty('--del',   `${Math.random() * 10}s`)
    p.style.setProperty('--drift', `${(Math.random() - 0.5) * 120}px`)
    p.style.left   = `${Math.random() * 100}%`
    p.style.width  = `${2 + Math.random() * 3}px`
    p.style.height = p.style.width
    p.style.opacity = String(0.2 + Math.random() * 0.4)
    container.appendChild(p)
  }
}

// ── Init all ──
function init() {
  initLoader()
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
  initWhyItems()
  initScrollProgress()
  initMagnetic()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
