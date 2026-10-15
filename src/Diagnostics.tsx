import { useEffect, useRef, useState } from 'react'
import getStroke from 'perfect-freehand'
import { acceptSample, PEN_PRESETS, pressureCurve, samplesOf } from './ink'
import type { PenSettings } from './ink'
import type { StrokePoint } from './model'

type Stats = { raw: number; kept: number; coalescedEvents: number; events: number; meanDt: number; maxDt: number; renderMs: number; maxDeviation: number }

/** Temporary tool, opened with ?diagnostics. Draws a stroke and compares raw samples against the rendered outline. */
export default function Diagnostics() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const graph = useRef<HTMLCanvasElement>(null)
  const [pen, setPen] = useState<PenSettings>(PEN_PRESETS.technical)
  const [stats, setStats] = useState<Stats | null>(null)
  const [touch, setTouch] = useState('no touch yet')
  const lastPen = useRef(0)
  const state = useRef({ points: [] as StrokePoint[], start: 0, events: 0, coalesced: 0, drawing: false })
  const penRef = useRef(pen)
  penRef.current = pen

  const render = () => {
    const c = canvas.current!, ctx = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, c.clientWidth, c.clientHeight)
    const { points } = state.current
    if (!points.length) return
    const p = penRef.current
    const started = performance.now()
    const s = Math.min(1, Math.max(0, p.smoothing))
    const outline = getStroke(points.map(q => [q.x, q.y, q.pressure === undefined ? .5 : pressureCurve(q.pressure, p.curve)]), {
      size: p.width, thinning: p.mode === 'technical' ? 0 : .6, smoothing: .65 * s, streamline: .42 * s, simulatePressure: p.mode === 'ink' && !points.some(q => q.pressure !== undefined), last: true,
    })
    ctx.fillStyle = '#33343188'
    ctx.beginPath(); outline.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill()
    const renderMs = performance.now() - started
    ctx.fillStyle = '#c0392b'
    for (const q of points) ctx.fillRect(q.x - 1, q.y - 1, 2, 2)
    let maxDeviation = 0
    if (outline.length) for (const q of points) {
      let best = Infinity
      for (const [x, y] of outline) best = Math.min(best, Math.hypot(x - q.x, y - q.y))
      maxDeviation = Math.max(maxDeviation, best)
    }
    const dts = points.slice(1).map((q, i) => (q.t ?? 0) - (points[i].t ?? 0))
    setStats({ raw: points.length, kept: points.length, coalescedEvents: state.current.coalesced, events: state.current.events, meanDt: dts.length ? dts.reduce((a, b) => a + b, 0) / dts.length : 0, maxDt: Math.max(0, ...dts), renderMs, maxDeviation })
    const g = graph.current!, gx = g.getContext('2d')!
    g.width = g.clientWidth; g.height = g.clientHeight
    gx.strokeStyle = '#718b85'; gx.beginPath()
    points.forEach((q, i) => { const x = i / Math.max(1, points.length - 1) * g.width, y = g.height - (q.pressure ?? 0) * g.height; i ? gx.lineTo(x, y) : gx.moveTo(x, y) }); gx.stroke()
    gx.strokeStyle = '#c0392b'; gx.beginPath()
    points.forEach((q, i) => { const x = i / Math.max(1, points.length - 1) * g.width, y = g.height - pressureCurve(q.pressure ?? 0, p.curve) * g.height; i ? gx.lineTo(x, y) : gx.moveTo(x, y) }); gx.stroke()
  }

  useEffect(() => {
    const c = canvas.current!
    const rect = () => c.getBoundingClientRect()
    const probe = (e: PointerEvent) => {
      if (e.pointerType === 'pen') lastPen.current = e.timeStamp
      else if (e.pointerType === 'touch') setTouch(`touch ${e.type}: contact ${e.width.toFixed(0)}×${e.height.toFixed(0)}px, ${lastPen.current ? `${(e.timeStamp - lastPen.current).toFixed(0)}ms after last pen event` : 'no pen event yet'}`)
    }
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) c.addEventListener(type, probe as EventListener)
    const add = (e: PointerEvent) => {
      const r = rect(), st = state.current
      st.events++
      const samples = samplesOf(e)
      st.coalesced += samples.length
      for (const sample of samples) {
        const t = Math.round(sample.timeStamp - st.start)
        const x = sample.clientX - r.left, y = sample.clientY - r.top
        if (acceptSample(st.points.at(-1), x, y, t)) st.points.push({ x, y, pressure: sample.pointerType === 'pen' ? sample.pressure : undefined, t })
      }
    }
    const down = (e: PointerEvent) => { c.setPointerCapture(e.pointerId); state.current = { points: [], start: e.timeStamp, events: 0, coalesced: 0, drawing: true }; add(e); render() }
    const move = (e: PointerEvent) => { if (state.current.drawing) { add(e); render() } }
    const up = () => { state.current.drawing = false }
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up)
    return () => { for (const type of ['pointerdown', 'pointermove', 'pointerup']) c.removeEventListener(type, probe as EventListener); c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up) }
  }, [])
  useEffect(render, [pen])

  return <div style={{ position: 'fixed', inset: 0, background: '#f7f7f4', font: '13px system-ui', color: '#333' }}>
    <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
    <div style={{ position: 'absolute', top: 12, left: 12, background: '#fffe', padding: 10, borderRadius: 6, display: 'grid', gap: 6, minWidth: 260 }}>
      <b>Pen diagnostics</b>
      <div><button onClick={() => setPen(PEN_PRESETS.technical)}>Technical</button> <button onClick={() => setPen(PEN_PRESETS.ink)}>Ink</button></div>
      <label>Width {pen.width.toFixed(2)} <input type="range" min=".25" max="12" step=".25" value={pen.width} onChange={e => setPen({ ...pen, width: Number(e.target.value) })} /></label>
      <label>Smooth {pen.smoothing.toFixed(2)} <input type="range" min="0" max="1" step=".05" value={pen.smoothing} onChange={e => setPen({ ...pen, smoothing: Number(e.target.value) })} /></label>
      <label>Curve {pen.curve.toFixed(2)} <input type="range" min=".4" max="2.5" step=".05" value={pen.curve} onChange={e => setPen({ ...pen, curve: Number(e.target.value) })} /></label>
      {stats && <pre style={{ margin: 0 }}>{`samples ${stats.raw}\nevents ${stats.events} (coalesced ${stats.coalescedEvents})\ndt mean ${stats.meanDt.toFixed(1)}ms  max ${stats.maxDt}ms\nrender ${stats.renderMs.toFixed(2)}ms\nmax raw→outline ${stats.maxDeviation.toFixed(2)}px`}</pre>}
      <div title="Palm rejection drops contacts larger than 40px or within 700ms of the pen">{touch}</div>
      <div>Pressure: raw <span style={{ color: '#718b85' }}>■</span> curved <span style={{ color: '#c0392b' }}>■</span></div>
      <canvas ref={graph} style={{ width: 240, height: 60, background: '#fff', border: '1px solid #ddd' }} />
      <a href={window.location.pathname}>Back to editor</a>
    </div>
  </div>
}
