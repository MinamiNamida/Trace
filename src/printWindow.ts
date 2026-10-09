// Open during the click event, before lazy imports or asset loading can consume user activation.
export function openPrintWindow(): Window {
  const target = window.open('', '_blank')
  if (!target) throw new Error('Allow pop-ups for Trace, then try exporting PDF again.')
  target.opener = null
  target.document.title = 'Preparing PDF…'
  target.document.body.textContent = 'Preparing PDF…'
  return target
}
