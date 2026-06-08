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
    const rawText = el.textContent!.trim()
    const lines = rawText.split('\n')
    el.innerHTML = lines.map(line => {
      const words = line.trim().split(' ')
      return words.map(w => `<span class="word"><span class="word-inner">${w}</span></span>`).join(' ')
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

// ── Init all ──
function init() {
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
