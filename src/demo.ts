import type { Board, CanvasItem, Frame } from './model'
import { saveAsset } from './storage'

const item = (entry: CanvasItem) => entry
const frame = (entry: Frame) => entry

export async function createDemoBoard(): Promise<Board> {
  const scan = await fetch('/assets/fourier-time-shift.png').then(response => response.blob())
  await saveAsset('fourier-excerpt', scan)
  const items: CanvasItem[] = [
    item({ id: 'scan', type: 'image', assetId: 'fourier-excerpt', alt: 'Page 70 of Engineering Signal Analysis: Time shift theorem', transform: { x: 122, y: 190, width: 500, height: 360 } }),
    item({ id: 'q1', type: 'text', text: '为什么偏偏选复指数作基底？', fontSize: 25, bold: true, transform: { x: 120, y: 560, width: 470, height: 55 } }),
    item({ id: 'p1', type: 'text', text: '普通基底也能展开函数，但平移之后各个系数会彼此混合。复指数的特别之处，是平移只改变一个相位。', fontSize: 19, transform: { x: 125, y: 632, width: 480, height: 105 } }),
    item({ id: 'f1', type: 'formula', latex: 'e^{ik(x-a)}=e^{-ika}e^{ikx}', transform: { x: 714, y: 470, width: 456, height: 76 } }),
    item({ id: 'q2', type: 'text', text: 'translation 为什么会变成乘法？', fontSize: 24, bold: true, transform: { x: 738, y: 595, width: 500, height: 52 } }),
    item({ id: 'p2', type: 'text', text: '先只看一个频率。把 x 换成 x − a，指数律会把 a 从变量中分离出来。于是整个波形平移，频率仍然不变。', fontSize: 18, transform: { x: 736, y: 680, width: 505, height: 112 } }),
    item({ id: 'derivation', type: 'text', text: '我的推导\n\nf(x) = Σ cₖ eⁱᵏˣ\n\nf(x − a) = Σ cₖ eⁱᵏ⁽ˣ⁻ᵃ⁾\n             = Σ (cₖ e⁻ⁱᵏᵃ) eⁱᵏˣ\n\n所以每个频率的系数只多了一个相位因子。', fontSize: 19, transform: { x: 747, y: 821, width: 500, height: 282 } }),
    item({ id: 'p3', type: 'text', text: '这就是算子的“特征函数”视角：函数的形状不变，只被一个数缩放。把复杂信号拆开以后，平移算子就容易理解了。', fontSize: 19, transform: { x: 1440, y: 352, width: 444, height: 126 } }),
    item({ id: 'f2', type: 'formula', latex: 'T_a e^{ikx}=e^{-ika}e^{ikx}', transform: { x: 1436, y: 536, width: 440, height: 78 } }),
    item({ id: 'f3', type: 'formula', latex: '\\widehat{f(\\cdot-a)}(k)=e^{-ika}\\hat f(k)', transform: { x: 1404, y: 684, width: 484, height: 84 } }),
    item({ id: 'example', type: 'text', text: '一个具体例子\n\n若 f(x) = cos(2x)，向右平移 π/4 以后：\ncos(2(x − π/4)) = sin(2x)。\n\n频率仍是 2，改变的是相位。', fontSize: 21, transform: { x: 1417, y: 943, width: 445, height: 244 } }),
    item({ id: 'loose1', type: 'text', text: '旁边再想想：如果信号不是周期的，基底还成立吗？', fontSize: 18, transform: { x: 130, y: 1040, width: 475, height: 81 } }),
    item({ id: 'loose2', type: 'text', text: '待查：Fourier transform 与 Fourier series 的边界条件。', fontSize: 18, transform: { x: 188, y: 1205, width: 510, height: 65 } }),
    item({ id: 'sketch', type: 'drawing', lineWidth: 3, points: Array.from({ length: 80 }, (_, n) => ({ x: n * 6, y: 72 - Math.sin(n * .24) * 47, pressure: .5 })), transform: { x: 129, y: 809, width: 474, height: 145 } }),
    item({ id: 'sketch2', type: 'drawing', lineWidth: 2, points: Array.from({ length: 80 }, (_, n) => ({ x: n * 6, y: 82 - Math.sin(n * .24 - 1.05) * 47, pressure: .5 })), transform: { x: 129, y: 809, width: 474, height: 145 } }),
  ]
  const frames: Frame[] = [
    frame({ id: 'why', title: 'Why Fourier Basis?', bounds: { x: 76, y: 137, width: 622, height: 626 } }),
    frame({ id: 'translation', title: 'Translation', bounds: { x: 669, y: 366, width: 654, height: 772 } }),
    frame({ id: 'eigen', title: 'Eigenfunctions', bounds: { x: 1303, y: 143, width: 654, height: 666 } }),
    frame({ id: 'example-frame', title: 'Example', bounds: { x: 1276, y: 854, width: 653, height: 404 } }),
  ]
  return {
    id: 'main', version: 2, title: 'Fourier Transform · study board',
    items: Object.fromEntries(items.map(i => [i.id, i])),
    frames: Object.fromEntries(frames.map(f => [f.id, f])),
    frameEdges: {
      e1: { id: 'e1', from: 'why', to: 'translation' },
      e2: { id: 'e2', from: 'translation', to: 'eigen' },
      e3: { id: 'e3', from: 'eigen', to: 'example-frame' },
    },
    stories: {
      lecture: {
        id: 'lecture', title: 'Full lecture', steps: [
          { id: 'lecture-why', frameId: 'why', notes: 'Start with the textbook excerpt. Ask why the exponential basis is useful before showing the answer.', revealItems: ['p1'] },
          { id: 'lecture-translation', frameId: 'translation', notes: 'Use the shift x → x − a. Reveal the derivation after the question.', revealItems: ['derivation'] },
          { id: 'lecture-eigen', frameId: 'eigen', notes: 'Connect this calculation to the eigenfunction viewpoint.', revealItems: ['f3'] },
          { id: 'lecture-example', frameId: 'example-frame', notes: 'Finish with a concrete cosine wave.' },
        ],
      },
      review: {
        id: 'review', title: 'Quick review', steps: [
          { id: 'review-why', frameId: 'why' },
          { id: 'review-eigen', frameId: 'eigen' },
          { id: 'review-example', frameId: 'example-frame' },
        ],
      },
    },
  }
}
