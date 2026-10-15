import { expect, test } from 'vitest'
import { isBlankMarkdown, markdownForCode, migrateLegacyBoard, migrateLegacyItem, type LegacyBlock } from '../src/model'
import { highlightCode } from '../src/highlight'
import { parseClip } from '../src/boardClipboard'
import { blank } from './fixtures'

const transform = { x: 1, y: 2, width: 300, height: 100 }

test('legacy code and formula items become Markdown notes that keep their identity, place and grouping', () => {
  const code = migrateLegacyItem({ id: 'c', type: 'code', code: 'let a = 1', language: 'javascript', transform, groupIds: ['g'], frameId: 'f' } as LegacyBlock)
  expect(code).toMatchObject({ id: 'c', type: 'text', markdown: true, text: '```javascript\nlet a = 1\n```', transform, groupIds: ['g'], frameId: 'f' })
  expect(code).not.toHaveProperty('code')
  const formula = migrateLegacyItem({ id: 'f', type: 'formula', latex: 'a^2+b^2=c^2', transform } as LegacyBlock)
  expect(formula).toMatchObject({ type: 'text', markdown: true, text: '$$\na^2+b^2=c^2\n$$' })
})

test('plain text language is dropped and code containing fences gets a longer fence', () => {
  expect(markdownForCode('x', '')).toBe('```\nx\n```')
  const fenced = markdownForCode('a\n```\nb', 'md')
  expect(fenced.startsWith('````md\n') && fenced.endsWith('\n````')).toBe(true)
})

test('migrating a board without legacy items returns the same object', () => {
  const board = blank('plain')
  expect(migrateLegacyBoard(board)).toBe(board)
})

test('a note holding only empty fences counts as blank', () => {
  expect(isBlankMarkdown('')).toBe(true)
  expect(isBlankMarkdown('```\n```')).toBe(true)
  expect(isBlankMarkdown('```js\n\n```')).toBe(true)
  expect(isBlankMarkdown('$$\n$$')).toBe(true)
  expect(isBlankMarkdown('```\nx\n```')).toBe(false)
  expect(isBlankMarkdown('hello')).toBe(false)
})

test('pasted legacy blocks arrive as Markdown notes', () => {
  const clip = parseClip(JSON.stringify({ kind: 'trace/selection', version: 1, frames: [], edges: [], items: [{ id: 'c', type: 'code', code: 'print(1)', language: 'python', transform }] }))
  expect(clip?.items[0]).toMatchObject({ type: 'text', text: '```python\nprint(1)\n```' })
})

test('code is highlighted with aliases and falls back to plain text', () => {
  expect(highlightCode('const x = 1', 'js')).toContain('hljs-keyword')
  expect(highlightCode('<b>', 'nonsense')).toBe('&lt;b&gt;')
})
