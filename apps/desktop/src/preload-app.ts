/** Minimal marker that selects the desktop custom-protocol API carrier. */

import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('avnDesktop', { protocolVersion: 1 })

// The window hides its title bar and insets the traffic lights over the page,
// so the shell marks the document and the layout reserves that corner. Only
// this carrier sets it: the same client served over HTTP has no lights to clear.
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset['avnDesktop'] = ''
})
