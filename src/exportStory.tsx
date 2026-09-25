import { renderToStaticMarkup } from 'react-dom/server'
import { BoardRenderer } from './BoardRenderer'
import type { Board, Story } from './model'
import { loadAsset } from './storage'
import { cameraFor, visibleItemsForStep } from './storyView'
import revealCss from '../node_modules/reveal.js/dist/reveal.css?raw'
import revealRuntime from '../node_modules/reveal.js/dist/reveal.js?raw'
import notesRuntime from '../node_modules/reveal.js/dist/plugin/notes.js?raw'

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const safeScript = (value: string) => value.replace(/<\/script/gi, '<\\/script')

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function embeddedCss(): Promise<string> {
  const chunks: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode
    let css = ''
    let base = location.href
    if (owner instanceof HTMLStyleElement) css = owner.textContent || ''
    else if (owner instanceof HTMLLinkElement && owner.rel === 'stylesheet' && new URL(owner.href).origin === location.origin) {
      const response = await fetch(owner.href)
      if (!response.ok) throw new Error(`Could not load stylesheet: ${owner.href}`)
      css = await response.text()
      base = owner.href
    } else continue
    const urls = [...new Set([...css.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g)].map(match => match[2]))]
    const replacements = new Map<string, string>()
    for (const url of urls) {
      if (/^(data:|blob:|https?:)/i.test(url)) continue
      const response = await fetch(new URL(url, base))
      if (!response.ok) throw new Error(`Could not load font asset: ${url}`)
      replacements.set(url, await blobToDataUrl(await response.blob()))
    }
    chunks.push(css.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g, (match, _quote: string, url: string) => replacements.has(url) ? `url("${replacements.get(url)}")` : match))
  }
  return chunks.join('\n')
}

export async function exportStoryHtml(board: Board, story: Story) {
  if (!story.steps.length) throw new Error('This story has no steps.')
  const assetUrls: Record<string, string> = {}
  for (const item of Object.values(board.items)) if (item.type === 'image' && !assetUrls[item.assetId]) {
    const blob = await loadAsset(item.assetId)
    if (!blob) throw new Error(`Missing image asset: ${item.alt || item.assetId}`)
    assetUrls[item.assetId] = await blobToDataUrl(blob)
  }
  const css = await embeddedCss()
  const slides = story.steps.map(step => {
    const itemIds = visibleItemsForStep(board, step, step.revealItems?.length || 0)
    const boardHtml = renderToStaticMarkup(<BoardRenderer board={board} viewport={cameraFor(board, step, 1440, 900)} visibleItems={itemIds} assetUrls={assetUrls} mode="readonly" />)
    const fragments = (step.revealItems || []).map((id, index) => `<span class="fragment story-fragment" data-fragment-index="${index}" data-item="${escapeHtml(id)}" aria-hidden="true"></span>`).join('')
    const notes = step.notes ? `<aside class="notes">${escapeHtml(step.notes)}</aside>` : ''
    return `<section data-story-step="${escapeHtml(step.id)}"><div class="presentation-viewport">${boardHtml}</div>${fragments}${notes}</section>`
  }).join('\n')
  const initialVisibility = story.steps.flatMap(step => (step.revealItems || []).map(id => `section[data-story-step="${step.id}"] [data-item-id="${id}"]{visibility:hidden}`)).join('\n')
  const title = escapeHtml(`${story.title} · ${board.title}`)
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${revealCss}\n${css}\n${initialVisibility}\nhtml,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f7f7f4}.reveal{width:100%;height:100%;background:#f7f7f4}.reveal .slides{text-align:left}.reveal .slides section{height:100%;overflow:hidden}.presentation-viewport{position:relative;width:100%;height:100%;overflow:hidden;background:#f7f7f4}.story-fragment{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important}@media print{html,body{overflow:visible}}</style></head><body><div class="reveal"><div class="slides">${slides}</div></div><script>${safeScript(revealRuntime)}</script><script>${safeScript(notesRuntime)}</script><script>
const printMode = new URLSearchParams(location.search).has('print-pdf');
const deck = new Reveal(document.querySelector('.reveal'), {width:1440,height:900,margin:0,minScale:1,maxScale:1,controls:true,progress:false,center:false,transition:'none',overview:false,hash:false,pdfSeparateFragments:false,plugins:[RevealNotes]});
function updateStoryItems(){const slides=printMode?document.querySelectorAll('.reveal .slides section'):[deck.getCurrentSlide()];slides.forEach(slide=>{if(!slide)return;const shown=slide.querySelectorAll('.story-fragment.visible');const ids=new Set(Array.from(shown,el=>el.getAttribute('data-item')));slide.querySelectorAll('.story-fragment').forEach(el=>{const item=slide.querySelector('[data-item-id="'+el.getAttribute('data-item')+'"]');if(item)item.style.visibility=printMode||ids.has(el.getAttribute('data-item'))?'visible':'hidden'})})}
deck.on('slidechanged',updateStoryItems);deck.on('fragmentshown',updateStoryItems);deck.on('fragmenthidden',updateStoryItems);deck.initialize().then(updateStoryItems);
</script></body></html>`
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${story.title.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'story'}.html`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
