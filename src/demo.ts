import { markdownForCode, type Board, type CanvasItem, type Frame } from './model'
import { saveAsset } from './storage'
import { reconcileFrames } from './boardOperations'

export const GUIDE_BOARD_ID = 'main'
export const GUIDE_START_FRAME = 'guide-start'

// Fingerprint of the original Fourier template; never replace a user's edited copy.
export async function isOriginalDemoBoard(board: Board): Promise<boolean> {
  if (board.id !== 'main' || board.title !== 'Fourier Transform · study board' || !crypto.subtle) return false
  const canonical = JSON.stringify(board, (_, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') === '7949b29eed6e545afff7d4dc090ea386a9f68f097bc8e896d3d15b615222df6f'
}

// The guide image is local and self-contained, so first launch also works offline.
const guideImage = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="220" viewBox="0 0 640 220">
<rect width="640" height="220" rx="16" fill="#edf2eb"/>
<path d="M192 110H240M398 110H446" fill="none" stroke="#859b8c" stroke-width="3"/>
<path d="m230 103 10 7-10 7m206-14 10 7-10 7" fill="none" stroke="#859b8c" stroke-width="3"/>
<g fill="#fbfcf8" stroke="#b7c9b9" stroke-width="2"><rect x="30" y="42" width="162" height="136" rx="10"/><rect x="240" y="42" width="158" height="136" rx="10"/><rect x="446" y="42" width="164" height="136" rx="10"/></g>
<g fill="#4b6956" font-family="sans-serif" font-size="22" text-anchor="middle"><text x="111" y="98">Collect</text><text x="319" y="98">Connect</text><text x="528" y="98">Share</text></g>
<g stroke="#91aa96" stroke-width="3" stroke-linecap="round"><path d="M78 125h66m-66 14h44"/><path d="M287 132h64m-46-12 14 12-14 12"/><path d="M507 140v-20h42v20m-30-15 9-10 9 10m-9-10v26"/></g>
</svg>`

export async function createGuideBoard(id = GUIDE_BOARD_ID): Promise<Board> {
  const assetId = `${id}:guide-image`
  await saveAsset(assetId, new Blob([guideImage], { type: 'image/svg+xml' }))
  const items: CanvasItem[] = []
  const note = (id: string, text: string, x: number, y: number, width: number, height: number, fontSize = 25) => {
    items.push({ id, type: 'text', text, fontSize, markdown: true, transform: { x, y, width, height } })
  }

  note('guide-welcome', '# 欢迎来到 Trace\n把想法放在同一张白板上。', 48, 42, 790, 120, 31)
  note('guide-intro', '笔记、代码、公式、图片与草图可以自由摆放。  \n这块 **入门指南画板** 也可以直接编辑，边读边试。', 48, 181, 790, 92)
  note('guide-navigation', '### 先试着移动与缩放\n- **移动视野**：空格 + 拖动，或 Hand（`H`）\n- **触控板**：双指滚动移动，双指捏合缩放\n- **缩放**：鼠标滚轮，或右下角 `−` / `+`', 48, 295, 790, 166, 23)
  note('guide-next', '**继续学习 →** 点右上角 **Story**，选择四个步骤切换区域。  \n点右下角 **Fit board** 可以查看整张教程。', 48, 490, 790, 80, 23)

  note('guide-writing', '## 让文字、代码和公式一起思考', 1028, 42, 790, 48, 25)
  note('guide-text-help', '**Text（`T`）**：点击空白处放一条笔记。  \n双击已有内容编辑；点其他地方结束。  \n支持 **Markdown**：标题、列表、代码与行内公式。', 1028, 108, 790, 120, 24)
  note('guide-markdown', '**这是可编辑的笔记**\n\n- 列出想法，再连接起来\n- 行内公式：$a^2+b^2=c^2$\n\n双击试试修改这些文字。', 1028, 247, 375, 160, 21)
  note('guide-code', markdownForCode('// 双击修改；语言写在 ``` 之后\nconst idea = "Hello, Trace";\nconsole.log(idea);', 'javascript'), 1434, 248, 384, 160, 16)
  note('guide-formula-help', '**Code（`C`）** 添加代码块；**Formula（`F`）** 添加公式。  \n它们都是 Markdown：代码写在 ``` 之间，公式写在 `$$` 之间，双击即可修改。', 1028, 432, 790, 76, 23)
  note('guide-formula', '$$\na^2 + b^2 = c^2\n$$', 1260, 522, 410, 60, 22)

  note('guide-visuals', '## 把材料摆出来，再框出一个想法', 48, 722, 790, 48, 25)
  note('guide-image-help', '**Image（`I`）** 选图，或直接拖入 / 粘贴图片。  \n拖动物件调整位置；选中后拖右下角调整大小。', 48, 788, 790, 86, 24)
  items.push({ id: 'guide-image', type: 'image', assetId, alt: 'Collect → Connect → Share：收集、连接、分享', transform: { x: 48, y: 892, width: 510, height: 175 } })
  note('guide-pen-help', '**Pen（`P`）**：自由画线  \n**Eraser（`E`）**：擦除笔画  \n试着在旁边画个箭头。', 582, 910, 270, 117, 21)
  items.push({ id: 'guide-stroke', type: 'drawing', lineWidth: 4, points: Array.from({ length: 48 }, (_, index) => ({ x: index * 5, y: 18 + Math.sin(index * .13) * 11, pressure: .5 })), transform: { x: 585, y: 1045, width: 240, height: 44 } })
  note('guide-frame-help', '**Frame（`R`）**：拖出区域；双击标题命名。  \n拖标题旁的 `↗` 到另一个 Frame，连接两个区域。  \n移动 Frame 会带着内容一起走；右键可移除框并保留内容。  \n**编组**：框选 / Shift 点击 → 右键编组（`⌘ / Ctrl G`）。', 48, 1100, 790, 150, 21)

  note('guide-sharing', '## 用 Story 带别人走过你的思路', 1028, 722, 790, 48, 25)
  note('guide-story-help', '打开右上角 **Story**：\n- 用 **Frame** 建立步骤，再添加、重复或调整顺序\n- 点 **Present** 演示，方向键推进；`Esc` 自由探索\n- 当前 **白板入门 · 四步导览** 就是一个完整示例', 1028, 790, 790, 154, 23)
  note('guide-reveal', '**这条提示会在演示时逐步出现。**  \n在 **Reveal** 设置显示顺序；**Notes** 写讲者备注。', 1028, 965, 790, 83, 23)
  note('guide-export-help', '- **HTML**：下载可离线打开的演示\n- **PDF**：打开打印对话框，选择 **Save as PDF**，每步一页', 1028, 1068, 790, 84, 23)
  note('guide-your-board', '**准备好了？** 点左上角画板名 → **New blank board**。  \n修改自动保存在当前浏览器；菜单里可以重命名或删除。  \n撤销：`⌘ / Ctrl Z`；重做：`⌘ / Ctrl Shift Z`。', 1028, 1168, 790, 112, 23)

  const frames: Frame[] = [
    { id: GUIDE_START_FRAME, title: '01 · 从这里开始', bounds: { x: 0, y: 0, width: 900, height: 580 } },
    { id: 'guide-write', title: '02 · 文字 / 代码 / 公式', bounds: { x: 980, y: 0, width: 900, height: 620 } },
    { id: 'guide-visual', title: '03 · 图片 / 绘图 / Frame', bounds: { x: 0, y: 680, width: 900, height: 590 } },
    { id: 'guide-share', title: '04 · Story / 导出 / 新画板', bounds: { x: 980, y: 680, width: 900, height: 640 } },
  ]
  const groups = [
    ['guide-welcome', 'guide-intro', 'guide-navigation', 'guide-next'],
    ['guide-writing', 'guide-text-help', 'guide-markdown', 'guide-code', 'guide-formula-help', 'guide-formula'],
    ['guide-visuals', 'guide-image-help', 'guide-image', 'guide-pen-help', 'guide-stroke', 'guide-frame-help'],
    ['guide-sharing', 'guide-story-help', 'guide-export-help', 'guide-your-board'],
  ]
  const notes = ['邀请读者先试试平移和缩放，再用 Story 切换区域。', '双击笔记，代码与公式也在笔记里编辑。', '拖动图片、调整大小，再试试绘图和 Frame。Frame 会绑定区域内的内容。', '推进一次演示显示 Reveal 提示，然后体验导出或建立自己的空白画板。']
  const board: Board = {
    id, version: 2, title: 'Trace · 白板使用指南',
    items: Object.fromEntries(items.map(item => [item.id, item])),
    frames: Object.fromEntries(frames.map(frame => [frame.id, frame])),
    frameEdges: Object.fromEntries(frames.slice(1).map((frame, index) => [`guide-edge-${index}`, { id: `guide-edge-${index}`, from: frames[index].id, to: frame.id }])),
    stories: {
      'guide-tour': { id: 'guide-tour', title: '白板入门 · 四步导览', steps: frames.map((frame, index) => ({ id: `guide-step-${index}`, frameId: frame.id, visibleItems: groups[index], notes: notes[index], ...(index === 3 ? { revealItems: ['guide-reveal'] } : {}) })) },
    },
  }
  reconcileFrames(board)
  board.frameMembership = true
  return board
}
