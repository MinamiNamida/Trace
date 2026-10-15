import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import 'highlight.js/styles/github.css'

Object.entries({ bash, c, cpp, csharp, css, go, java, javascript, json, markdown, plaintext, python, rust, sql, typescript, xml })
  .forEach(([name, grammar]) => hljs.registerLanguage(name, grammar))
const aliases: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', html: 'xml', 'c++': 'cpp', 'c#': 'csharp', rs: 'rust' }

/** Highlighted HTML for a fenced code block; unknown languages are shown as plain text. */
export function highlightCode(code: string, language?: string) {
  const name = language ? (aliases[language.toLowerCase()] ?? language.toLowerCase()) : 'plaintext'
  return hljs.highlight(code, { language: hljs.getLanguage(name) ? name : 'plaintext', ignoreIllegals: true }).value
}
