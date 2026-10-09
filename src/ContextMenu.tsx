import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'

export type MenuAction = { label: string; icon?: LucideIcon; shortcut?: string; disabled?: boolean; danger?: boolean; run: () => void } | 'separator'
export function ContextMenu({ x, y, actions, onClose }: { x: number; y: number; actions: MenuAction[]; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })
  useLayoutEffect(() => {
    const rect = menu.current!.getBoundingClientRect()
    setPosition({ x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) })
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [x, y])
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) onClose() }
    const close = () => onClose()
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('wheel', close, true)
    return () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', close); window.removeEventListener('blur', close); window.removeEventListener('wheel', close, true) }
  }, [onClose])
  return <div ref={menu} className="canvas-context-menu" role="menu" aria-label="画板右键菜单" style={{ left: position.x, top: position.y }} onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Tab'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      if (event.key === 'Escape' || event.key === 'Tab') { onClose(); return }
      const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }
  }}>{actions.map((action, index) => action === 'separator' ? <div className="context-menu-rule" role="separator" key={index} /> : <button key={action.label} role="menuitem" disabled={action.disabled} className={action.danger ? 'danger' : ''} onClick={() => { onClose(); action.run() }}>{action.icon ? <action.icon size={15} /> : <span className="menu-icon-space" />}<span>{action.label}</span>{action.shortcut && <kbd>{action.shortcut}</kbd>}</button>)}</div>
}
