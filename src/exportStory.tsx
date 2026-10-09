import { renderToStaticMarkup } from 'react-dom/server'
import { BoardRenderer } from './BoardRenderer'
import type { Board, Story } from './model'
import { loadAsset } from './storage'
import { cameraFor, visibleItemsForStep } from './storyView'
import boardCss from './styles.css?inline'
import katexCss from 'katex/dist/katex.min.css?inline'
import codeCss from 'highlight.js/styles/github.css?inline'
import revealCss from '../node_modules/reveal.js/dist/reveal.css?raw'
import revealRuntime from '../node_modules/reveal.js/dist/reveal.js?raw'
import notesRuntime from '../node_modules/reveal.js/dist/plugin/notes.js?raw'

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const safeScript = (value: string) => value.replace(/<\/script/gi, '<\\/script')
const safeStyle = (value: string) => value.replace(/<\/style/gi, '<\\/style')

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function embeddedCss(): Promise<string> {
  // Vite resolves CSS URLs in both dev and builds, including a deployment subpath.
  const css = `${revealCss}\n${katexCss}\n${codeCss}\n${boardCss}`
  const pattern = /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g
  const urls = [...new Set([...css.matchAll(pattern)].map(match => match[2]))].filter(url => !/^(data:|#)/i.test(url))
  const replacements = new Map(await Promise.all(urls.map(async url => {
    const response = await fetch(new URL(url, location.href))
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error(`Could not load export asset: ${url}`)
    return [url, await blobToDataUrl(await response.blob())] as const
  })))
  return css.replace(pattern, (match, _quote: string, url: string) => replacements.has(url) ? `url("${replacements.get(url)}")` : match)
}

const printLayout = `
html,body{width:auto!important;height:auto!important;overflow:visible!important}
.reveal{width:auto!important;height:auto!important;overflow:visible!important}
.reveal .slides{position:static!important;width:1440px!important;height:auto!important;margin:0!important;transform:none!important;zoom:1!important;perspective:none!important;overflow:visible!important}
.reveal .slides>section{display:block!important;position:relative!important;top:auto!important;left:auto!important;width:1440px!important;height:900px!important;min-height:900px!important;margin:0!important;padding:0!important;transform:none!important;opacity:1!important;visibility:visible!important;overflow:hidden!important;break-inside:avoid;break-after:page}
.reveal .slides>section:last-child{break-after:auto}
.reveal .slides [data-item-id]{visibility:visible!important}
.reveal .controls,.reveal .progress,.aria-status,.export-tools,.story-fragment,.notes{display:none!important}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}`

export async function createStoryHtml(board: Board, story: Story, print = false): Promise<string> {
  if (!story.steps.length) throw new Error('This story has no steps.')
  const assetUrls: Record<string, string> = {}
  const includedItems = new Set(story.steps.flatMap(step => visibleItemsForStep(board, step, step.revealItems?.length || 0) || Object.keys(board.items)))
  await Promise.all([...new Set(Object.values(board.items).filter(item => includedItems.has(item.id)).flatMap(item => item.type === 'image' ? [item.assetId] : []))].map(async id => {
    const blob = await loadAsset(id)
    if (!blob) throw new Error(`Missing image asset: ${id}`)
    assetUrls[id] = await blobToDataUrl(blob)
  }))
  const css = await embeddedCss()
  const slides = story.steps.map(step => {
    const itemIds = visibleItemsForStep(board, step, step.revealItems?.length || 0)
    const boardHtml = renderToStaticMarkup(<BoardRenderer board={board} viewport={cameraFor(board, step, 1440, 900)} visibleItems={itemIds} hiddenItems={print ? undefined : step.revealItems} assetUrls={assetUrls} mode="readonly" />)
    const fragments = (step.revealItems || []).map((id, index) => `<span class="fragment story-fragment" data-fragment-index="${index}" data-item="${escapeHtml(id)}" aria-hidden="true"></span>`).join('')
    const notes = step.notes ? `<aside class="notes">${escapeHtml(step.notes)}</aside>` : ''
    return `<section data-story-step="${escapeHtml(step.id)}"><div class="presentation-viewport">${boardHtml}</div>${fragments}${notes}</section>`
  }).join('\n')
  const title = escapeHtml(`${story.title} · ${board.title}`)
  return `<!doctype html><html lang="en"${print ? ' class="print-pdf"' : ''}><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${safeStyle(css)}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f7f7f4}.reveal{width:100%;height:100%;background:#f7f7f4;font-family:inherit;color:inherit}.reveal .slides{text-align:left}.reveal .slides section{height:100%;overflow:hidden}.presentation-viewport{position:relative;width:100%;height:100%;overflow:hidden;background:#f7f7f4}.story-fragment{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important}.export-tools{position:fixed;top:12px;right:16px;z-index:50;padding:8px;border-radius:6px;background:#fbfbf8}.export-tools button{padding:6px 10px;border:1px solid #dce3d9;border-radius:4px;background:#f7faf6;color:#4e705b}.export-status{margin-left:8px;color:#69756c;font-size:13px}@page{size:1440px 900px;margin:0}@media print{${printLayout}}</style>${print ? `<style>${printLayout}</style>` : ''}</head><body><div class="reveal"><div class="slides">${slides}</div></div><div class="export-tools"><button id="print-story" type="button">Print / Save as PDF</button><span class="export-status" role="status"></span></div><script>${safeScript(revealRuntime)}</script><script>${safeScript(notesRuntime)}</script><script>
const printMode = ${print} || new URLSearchParams(location.search).has('print-pdf');
if(printMode)document.documentElement.classList.add('print-pdf');
window.addEventListener('beforeprint',()=>document.documentElement.classList.add('print-pdf'));
window.addEventListener('afterprint',()=>{if(!printMode)document.documentElement.classList.remove('print-pdf')});
const deck = printMode ? null : new Reveal(document.querySelector('.reveal'), {width:1440,height:900,margin:0,minScale:0.1,maxScale:2,controls:true,progress:false,center:false,transition:'none',overview:false,hash:false,plugins:[RevealNotes]});
function updateStoryItems(){if(!deck)return;const slide=deck.getCurrentSlide();if(!slide)return;const ids=new Set(Array.from(slide.querySelectorAll('.story-fragment.visible'),el=>el.dataset.item));slide.querySelectorAll('.story-fragment').forEach(el=>{slide.querySelectorAll('[data-item-id]').forEach(item=>{if(item.dataset.itemId===el.dataset.item)item.style.visibility=ids.has(el.dataset.item)?'visible':'hidden'})})}
async function printStory(){const status=document.querySelector('.export-status');status.textContent='Preparing PDF…';await document.fonts.ready;await Promise.all(Array.from(document.images,img=>img.decode().catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));status.textContent='Choose Save as PDF in the print dialog';window.print()}
document.querySelector('#print-story').addEventListener('click',printStory);
if(printMode){const style=document.createElement('style');style.textContent=${JSON.stringify(printLayout)};document.head.append(style);document.querySelectorAll('[data-item-id]').forEach(item=>item.style.visibility='visible');printStory()}else{deck.on('slidechanged',updateStoryItems);deck.on('fragmentshown',updateStoryItems);deck.on('fragmenthidden',updateStoryItems);deck.initialize().then(updateStoryItems)}
</script></body></html>`
}

export async function exportStoryHtml(board: Board, story: Story) {
  const html = await createStoryHtml(board, story)
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${story.title.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'story'}.html`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export async function exportStoryPdf(board: Board, story: Story, target: Window) {
  const html = await createStoryHtml(board, story, true)
  if (target.closed) throw new Error('The PDF window was closed. Please export again.')
  target.document.open()
  target.document.write(html)
  target.document.close()
}
