import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

// Editing one rule with a broad regex once welded selectors together and silently removed the selection frame.
test('selection chrome keeps its own, intact rules', () => {
  expect(css).toMatch(/(^|[}\n])\.selection-box\{[^}]*border:1px solid[^}]*\}/)
  expect(css).toMatch(/(^|[}\n])\.resize-handle\{[^}]*cursor:nwse-resize[^}]*\}/)
  expect(css).toMatch(/(^|[}\n])\.frame-handle,\.frame-dot\{[^}]*\}/)
})
