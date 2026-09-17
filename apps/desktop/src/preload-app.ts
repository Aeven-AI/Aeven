/** Minimal marker that selects the desktop custom-protocol API carrier. */

import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('avnDesktop', { protocolVersion: 1 })
