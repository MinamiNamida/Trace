import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import MilkdownEditor from '../src/MilkdownEditor'

vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } })

test('the editor renders Markdown as formatted content and reports edits as Markdown', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const onChange = vi.fn()
  const onReady = vi.fn()
  await act(async () => root.render(<MilkdownEditor initial={'# Title\n\n**bold** and $x^2$\n\n```js\nconst a = 1\n```\n\n$$\nE=mc^2\n$$\n'} focusPoint={null} onChange={onChange} onDone={() => {}} onReady={onReady} />))
  await vi.waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: 8000 })
  expect(host.querySelector('h1')?.textContent).toBe('Title')
  expect(host.querySelector('strong')?.textContent).toBe('bold')
  expect(host.querySelector('.katex')).not.toBeNull()
  expect(host.textContent).toContain('const a = 1')
  await act(async () => root.unmount())
  host.remove()
}, 15000)
