import { beforeEach, expect, test, vi } from 'vitest'
import { createStoryHtml, exportStoryPdf } from '../src/exportStory'
import { openPrintWindow } from '../src/printWindow'
import { saveAsset } from '../src/storage'
import { blank, image } from './fixtures'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'content-type': 'font/woff2' }), blob: async () => new Blob(['font'], { type: 'font/woff2' }) })))
})

function fixture() {
  const board = blank('export')
  board.title = '中文 <board>'
  board.frames.frame = { id: 'frame', title: 'Frame', bounds: { x: 0, y: 0, width: 900, height: 500 } }
  board.items.text = { id: 'text', type: 'text', text: '**Markdown** $x^2$', markdown: true, fontSize: 22, transform: { x: 150, y: 50, width: 200, height: 100 } }
  board.items.code = { id: 'code', type: 'text', markdown: true, fontSize: 16, text: '```javascript\nconst x = 1\n```', transform: { x: 50, y: 160, width: 300, height: 100 } }
  board.items.image = image('image', 'export-image')
  board.items.excluded = image('excluded', 'missing-but-hidden')
  const story = { id: 'story', title: '中文 </script><script>bad()</script>', steps: [
    { id: 'step"one', frameId: 'frame', visibleItems: ['text', 'image'], revealItems: ['code'], notes: '</aside><script>bad()</script>' },
    { id: 'second', frameId: 'frame', visibleItems: ['text'], viewport: { x: 10, y: 20, width: 500, height: 400 } },
  ] }
  return { board, story }
}

test('HTML embeds fonts and images, renders Markdown and code, and safely includes notes and IDs', async () => {
  const { board, story } = fixture()
  await saveAsset('export-image', new Blob(['image'], { type: 'image/png' }))
  const html = await createStoryHtml(board, story)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  expect(doc.querySelectorAll('section[data-story-step]')).toHaveLength(2)
  expect(doc.querySelector('section')?.getAttribute('data-story-step')).toBe('step"one')
  expect(doc.querySelector('.notes')?.textContent).toBe(story.steps[0].notes)
  expect(doc.querySelector('img')?.src).toMatch(/^data:image\/png;base64,/)
  expect(doc.querySelector('strong')?.textContent).toBe('Markdown')
  expect(doc.querySelector('.katex')).not.toBeNull()
  expect(doc.querySelector('.hljs-keyword')).not.toBeNull()
  expect(doc.querySelector('[data-item-id="code"]')?.getAttribute('style')).toContain('visibility:hidden')
  const css = Array.from(doc.querySelectorAll('style'), style => style.textContent).join('\n')
  const urls = [...css.matchAll(/url\(\s*['"]?([^)'"\s]+)/g)].map(match => match[1])
  expect(urls.length).toBeGreaterThan(0)
  expect(urls.every(url => /^(data:|#)/.test(url))).toBe(true)
  expect(doc.querySelectorAll('script')).toHaveLength(3)
  for (const script of doc.querySelectorAll('script')) expect(() => new Function(script.textContent || '')).not.toThrow()
})

test('print snapshot shows all reveals and disables Reveal paper styles, with fixed pages', async () => {
  const { board, story } = fixture()
  await saveAsset('export-image', new Blob(['image']))
  const html = await createStoryHtml(board, story, true)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  expect(doc.documentElement.classList.contains('print-pdf')).toBe(true)
  expect(doc.querySelector('[data-item-id="code"]')?.getAttribute('style')).not.toContain('visibility:hidden')
  expect(html).toContain('@page{size:1440px 900px;margin:0}')
  expect(html).toContain('window.print()')
  expect(html).toContain('document.fonts.ready')
  expect(html).toContain('const deck = printMode ? null')
})

test('empty stories and failed export assets give an actionable error', async () => {
  const { board, story } = fixture()
  await expect(createStoryHtml(board, { ...story, steps: [] })).rejects.toThrow('no steps')
  await saveAsset('export-image', new Blob(['image']))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, headers: new Headers() })))
  await expect(createStoryHtml(board, story)).rejects.toThrow('export asset')
})

test('print popups open synchronously and a blocked popup reports how to retry', () => {
  const target = { opener: window, document: document.implementation.createHTMLDocument() }
  const open = vi.spyOn(window, 'open').mockReturnValue(target as unknown as Window)
  expect(openPrintWindow()).toBe(target)
  expect(open).toHaveBeenCalledWith('', '_blank')
  expect(target.opener).toBeNull()
  open.mockReturnValue(null)
  expect(() => openPrintWindow()).toThrow('Allow pop-ups')
})

test('a closed PDF tab reports failure instead of writing to it', async () => {
  const { board, story } = fixture()
  await saveAsset('export-image', new Blob(['image']))
  await expect(exportStoryPdf(board, story, { closed: true } as Window)).rejects.toThrow('window was closed')
})
