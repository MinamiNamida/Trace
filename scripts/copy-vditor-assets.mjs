import { cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const project = fileURLToPath(new URL('..', import.meta.url))
const source = join(project, 'node_modules', 'vditor', 'dist')
const target = join(project, 'public', 'vditor', 'dist')

mkdirSync(target, { recursive: true })
for (const directory of ['js', 'css', 'images']) {
  cpSync(join(source, directory), join(target, directory), { recursive: true, force: true })
}
