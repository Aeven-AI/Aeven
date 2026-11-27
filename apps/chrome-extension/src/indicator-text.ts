/**
 * The indicator's and notifications' copy in the extension's three languages:
 * English, Simplified Chinese, and Spanish, picked from the browser's interface
 * language and falling back to English.
 */

/** Copy for one language. */
interface IndicatorCopy {
  /** The tag while the agent acts, given the current step. */
  readonly working: (step: string) => string
  /** The step names, by engine operation; `default` names any other. */
  readonly steps: Readonly<Record<string, string>> & { readonly default: string }
  /** The tag and notification title while a step waits for the person. */
  readonly input: string
  /** The tag and notification title when the agent finished. */
  readonly done: string
}

const EN: IndicatorCopy = {
  working: step => `Æven · ${step}`,
  steps: {
    default: 'Working', navigate: 'Opening a page', back: 'Going back', forward: 'Going forward', reload: 'Reloading',
    click: 'Clicking', hover: 'Pointing', drag: 'Dragging', type: 'Typing', press: 'Typing', select: 'Filling in',
    check: 'Filling in', scroll: 'Scrolling', upload: 'Uploading files', wait: 'Waiting for the page',
    read: 'Reading the page', content: 'Reading the page', snapshot: 'Reading the page', screenshot: 'Looking at the page',
  },
  input: 'Æven needs your input',
  done: 'Æven finished',
}

const ZH: IndicatorCopy = {
  working: step => `Æven · ${step}`,
  steps: {
    default: '正在工作', navigate: '正在打开页面', back: '正在后退', forward: '正在前进', reload: '正在刷新',
    click: '正在点击', hover: '正在指向', drag: '正在拖动', type: '正在输入', press: '正在输入', select: '正在填写',
    check: '正在填写', scroll: '正在滚动', upload: '正在上传文件', wait: '正在等待页面',
    read: '正在阅读页面', content: '正在阅读页面', snapshot: '正在阅读页面', screenshot: '正在查看页面',
  },
  input: 'Æven 需要你来操作',
  done: 'Æven 已完成',
}

const ES: IndicatorCopy = {
  working: step => `Æven · ${step}`,
  steps: {
    default: 'Trabajando', navigate: 'Abriendo una página', back: 'Volviendo atrás', forward: 'Avanzando', reload: 'Recargando',
    click: 'Haciendo clic', hover: 'Señalando', drag: 'Arrastrando', type: 'Escribiendo', press: 'Escribiendo', select: 'Rellenando',
    check: 'Rellenando', scroll: 'Desplazándose', upload: 'Subiendo archivos', wait: 'Esperando a la página',
    read: 'Leyendo la página', content: 'Leyendo la página', snapshot: 'Leyendo la página', screenshot: 'Mirando la página',
  },
  input: 'Æven necesita tu ayuda',
  done: 'Æven terminó',
}

/**
 * The copy for the browser's interface language.
 * @returns English, Chinese, or Spanish copy.
 */
export function indicatorCopy(): IndicatorCopy {
  const language = chrome.i18n.getUILanguage().toLowerCase()
  if (language.startsWith('zh')) return ZH
  if (language.startsWith('es')) return ES
  return EN
}
