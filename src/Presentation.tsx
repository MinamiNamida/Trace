import { ArrowLeft, ArrowRight, Maximize2, Move, Printer, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Reveal from 'reveal.js'
import Notes from 'reveal.js/plugin/notes'
import 'reveal.js/reveal.css'
import { BoardRenderer } from './BoardRenderer'
import { zoomAt } from './model'
import type { Board, Story, Viewport } from './model'
import { cameraFor, visibleItemsForStep } from './storyView'
import type { RevealApi } from 'reveal.js'

type Flight = { viewport: Viewport; moving: boolean }

export function Presentation({ board, story, onClose }: { board: Board; story: Story; onClose: () => void }) {
  const printMode = new URLSearchParams(window.location.search).has('print-pdf')
  const root = useRef<HTMLDivElement>(null)
  const deck = useRef<RevealApi | null>(null)
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  const indexRef = useRef(0)
  const currentCamera = useRef<Viewport>(cameraFor(board, story.steps[0], window.innerWidth, window.innerHeight))
  const flightTimer = useRef(0)
  const flightFrame = useRef(0)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState<Record<string, number>>({})
  const [flight, setFlight] = useState<Flight | null>(null)
  const [exploring, setExploring] = useState(false)
  const [exploreViewport, setExploreViewport] = useState(currentCamera.current)
  const drag = useRef<{ x: number; y: number; camera: Viewport } | null>(null)
  const pinch = useRef<Viewport | null>(null)

  const animateCamera = (from: Viewport, to: Viewport) => {
    clearTimeout(flightTimer.current)
    cancelAnimationFrame(flightFrame.current)
    setFlight({ viewport: from, moving: false })
    flightFrame.current = requestAnimationFrame(() => {
      flightFrame.current = requestAnimationFrame(() => setFlight({ viewport: to, moving: true }))
    })
    flightTimer.current = window.setTimeout(() => setFlight(null), 540)
  }
  const enterExplore = () => {
    if (exploring) return
    setExploreViewport(currentCamera.current)
    setExploring(true)
    deck.current?.configure({ keyboard: false })
  }
  const resume = () => {
    if (!exploring) return
    const target = cameraFor(board, story.steps[index], window.innerWidth, window.innerHeight)
    animateCamera(exploreViewport, target)
    currentCamera.current = target
    setExploring(false)
    deck.current?.configure({ keyboard: true })
  }

  useEffect(() => {
    if (!root.current) return
    const instance = new Reveal(root.current, {
      width: window.innerWidth, height: window.innerHeight, margin: 0, minScale: 1, maxScale: 1,
      controls: false, progress: false, center: false, transition: 'none', overview: false,
      hash: false, keyboard: true, embedded: false, plugins: [Notes], pdfSeparateFragments: false,
    })
    deck.current = instance
    const onSlide = (raw: Event) => {
      const event = raw as Event & { indexh?: number }
      const next = Math.max(0, Math.min(story.steps.length - 1, event.indexh ?? 0))
      const target = cameraFor(board, story.steps[next], window.innerWidth, window.innerHeight)
      animateCamera(currentCamera.current, target)
      currentCamera.current = target
      indexRef.current = next
      setIndex(next)
      const section = instance.getCurrentSlide()
      if (section) setRevealed(old => ({ ...old, [story.steps[next].id]: section.querySelectorAll('.story-fragment.visible').length }))
    }
    const onFragment = () => {
      const section = instance.getCurrentSlide()
      const stepId = section?.getAttribute('data-story-step')
      if (section && stepId) setRevealed(old => ({ ...old, [stepId]: section.querySelectorAll('.story-fragment.visible').length }))
    }
    instance.on('slidechanged', onSlide)
    instance.on('fragmentshown', onFragment)
    instance.on('fragmenthidden', onFragment)
    void instance.initialize()
    const resize = () => {
      instance.configure({ width: window.innerWidth, height: window.innerHeight })
      instance.layout()
      setSize({ width: window.innerWidth, height: window.innerHeight })
      currentCamera.current = cameraFor(board, story.steps[indexRef.current], window.innerWidth, window.innerHeight)
    }
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      instance.off('slidechanged', onSlide)
      instance.off('fragmentshown', onFragment)
      instance.off('fragmenthidden', onFragment)
      instance.destroy()
      deck.current = null
      clearTimeout(flightTimer.current)
      cancelAnimationFrame(flightFrame.current)
    }
    // A presentation is mounted for one Story and Board snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (exploring) resume()
      else enterExplore()
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [exploring, exploreViewport, index])

  useEffect(() => {
    const blockPageZoom = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey) event.preventDefault() }
    const blockGesture = (event: Event) => { event.preventDefault() }
    document.addEventListener('wheel', blockPageZoom, { passive: false, capture: true })
    document.addEventListener('gesturestart', blockGesture, { passive: false, capture: true })
    document.addEventListener('gesturechange', blockGesture, { passive: false, capture: true })
    return () => {
      document.removeEventListener('wheel', blockPageZoom, true)
      document.removeEventListener('gesturestart', blockGesture, true)
      document.removeEventListener('gesturechange', blockGesture, true)
    }
  }, [])

  useEffect(() => {
    const surface = root.current?.parentElement
    if (!surface || !exploring) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = surface.getBoundingClientRect()
      const x = event.clientX - rect.left, y = event.clientY - rect.top
      setExploreViewport(old => event.ctrlKey || event.metaKey || event.deltaMode !== 0 || Math.abs(event.deltaY) >= 45 && Math.abs(event.deltaX) < 1
        ? zoomAt(old, x, y, old.zoom * Math.exp(-event.deltaY * (event.deltaMode ? .04 : event.ctrlKey || event.metaKey ? .003 : .009)))
        : { ...old, x: old.x - event.deltaX, y: old.y - event.deltaY })
    }
    type Gesture = Event & { scale?: number; clientX?: number; clientY?: number }
    const start = (event: Event) => { event.preventDefault(); pinch.current = exploreViewport }
    const change = (raw: Event) => {
      if (!pinch.current) return
      const event = raw as Gesture
      event.preventDefault()
      const rect = surface.getBoundingClientRect()
      setExploreViewport(zoomAt(pinch.current, (event.clientX ?? rect.left+rect.width/2)-rect.left, (event.clientY ?? rect.top+rect.height/2)-rect.top, pinch.current.zoom*(event.scale ?? 1)))
    }
    const end = (event: Event) => { event.preventDefault(); pinch.current = null }
    surface.addEventListener('wheel', wheel, { passive: false, capture: true })
    surface.addEventListener('gesturestart', start, { passive: false, capture: true })
    surface.addEventListener('gesturechange', change, { passive: false, capture: true })
    surface.addEventListener('gestureend', end, { passive: false, capture: true })
    return () => {
      surface.removeEventListener('wheel', wheel, true)
      surface.removeEventListener('gesturestart', start, true)
      surface.removeEventListener('gesturechange', change, true)
      surface.removeEventListener('gestureend', end, true)
    }
  }, [exploring])

  const startDrag = (event: React.PointerEvent) => {
    if (!exploring || event.button !== 0) return
    drag.current = { x: event.clientX, y: event.clientY, camera: exploreViewport }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: React.PointerEvent) => {
    if (!drag.current) return
    setExploreViewport({ ...drag.current.camera, x: drag.current.camera.x + event.clientX - drag.current.x, y: drag.current.camera.y + event.clientY - drag.current.y })
  }

  return <div className="presentation-shell">
    <div className="reveal" ref={root}><div className="slides">{story.steps.map(step => <section key={step.id} data-story-step={step.id}><div className="presentation-viewport"><BoardRenderer board={board} viewport={cameraFor(board, step, size.width, size.height)} visibleItems={visibleItemsForStep(board, step, printMode ? step.revealItems?.length || 0 : revealed[step.id] || 0)} mode="readonly" /></div>{step.revealItems?.map((id, order) => <span key={id} className="fragment story-fragment" data-fragment-index={order} aria-hidden="true" />)}{step.notes && <aside className="notes">{step.notes}</aside>}</section>)}</div></div>
    {flight && !exploring && <div className={`presentation-flight ${flight.moving ? 'moving' : ''}`}><BoardRenderer board={board} viewport={flight.viewport} mode="readonly" /></div>}
    {exploring && <div className="presentation-explore" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null }}><BoardRenderer board={board} viewport={exploreViewport} mode="readonly" /></div>}
    <div className="presentation-top"><span>{story.title}</span><span className="presentation-count">{String(index + 1).padStart(2, '0')} / {String(story.steps.length).padStart(2, '0')}{!!story.steps[index].revealItems?.length && ` · ${revealed[story.steps[index].id] || 0}/${story.steps[index].revealItems?.length}`}</span><button onClick={onClose} title="Close presentation"><X size={18} /></button></div>
    <div className="presentation-bottom"><button title="Previous" disabled={(index === 0 && !(revealed[story.steps[0].id] || 0)) || exploring} onClick={() => deck.current?.prev()}><ArrowLeft size={18} /></button><button title="Next" disabled={(index >= story.steps.length-1 && (revealed[story.steps[index].id] || 0) >= (story.steps[index].revealItems?.length || 0)) || exploring} onClick={() => deck.current?.next()}><ArrowRight size={18} /></button><span className="presentation-divider" /><button title={exploring ? 'Resume story' : 'Explore board · Esc'} onClick={exploring ? resume : enterExplore}><Move size={17} /> {exploring ? 'Resume' : 'Explore'}</button><button title="Speaker view · S" onClick={() => (deck.current?.getPlugin('notes') as { open?: () => void } | undefined)?.open?.()}>Notes</button><button title="Print or save as PDF" onClick={() => { const url = new URL(window.location.href); url.searchParams.set('board', board.id); url.searchParams.set('story', story.id); url.searchParams.set('print-pdf', ''); window.open(url.href, '_blank', 'noopener') }}><Printer size={16} /></button><button title="Fullscreen" onClick={() => void document.documentElement.requestFullscreen?.()}><Maximize2 size={16} /></button></div>
    {exploring && <div className="explore-caption">Explore board · Esc to resume this step</div>}
  </div>
}
