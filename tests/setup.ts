import 'fake-indexeddb/auto'
import { vi } from 'vitest'
import { webcrypto } from 'node:crypto'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
vi.stubGlobal('crypto', webcrypto)

// fake-indexeddb uses Node's structuredClone, which supports Node blobs rather than jsdom blobs.
import { Blob as NodeBlob } from 'node:buffer'
vi.stubGlobal('Blob', NodeBlob)
vi.stubGlobal('FileReader', class {
  result = ''
  error: unknown
  onload?: () => void
  onerror?: () => void
  readAsDataURL(blob: NodeBlob) {
    void blob.arrayBuffer().then(buffer => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`
      this.onload?.()
    }).catch(error => { this.error = error; this.onerror?.() })
  }
})
