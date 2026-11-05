/**
 * Browser half of the workspace naming surface: fills ui-workspace's two
 * directory-flow holes with a dialog that creates a Workspace with no
 * directory under the title the reader types. A composition mounts it in
 * place of a directory picker when its Host gives Workspaces no folder.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the SlotMap merge declaring the directory-flow holes.
import type {} from '@aeven/client-ui-workspace/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@aeven/client-ui-renderer/client'
import type { NameFlowInjected } from './NameWorkspaceFlow.tsx'
import { NameWorkspaceFlow } from './NameWorkspaceFlow.tsx'

/** Locale namespace owning the dialog's copy. */
const LOCALE_NS = 'workspace-name'

/** Required services (cordis fiber inject): the slot registry and locale. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dialog's dictionaries and the naming flow
 * into both directory-flow holes through `slots.inject()`, because the
 * ui-workspace entries may activate later or replace their declarations.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const disposers: (() => void)[] = []
    const dictionaries: [locale: string, dict: Record<string, string>][] = [
      ['en', {
        'name.title': 'New workspace',
        'name.hint': 'A workspace keeps related conversations, and what Aeven learns about the project, together.',
        'name.label': 'Workspace name',
        'name.placeholder': 'Workspace name',
        'name.create': 'Create',
        'name.cancel': 'Cancel',
      }],
      ['zh', {
        'name.title': '新建工作区',
        'name.hint': '工作区把相关的对话以及 Aeven 对该项目的了解放在一起。',
        'name.label': '工作区名称',
        'name.placeholder': '工作区名称',
        'name.create': '创建',
        'name.cancel': '取消',
      }],
      ['es', {
        'name.title': 'Nuevo espacio de trabajo',
        'name.hint': 'Un espacio de trabajo reúne conversaciones relacionadas y lo que Aeven aprende del proyecto.',
        'name.label': 'Nombre del espacio de trabajo',
        'name.placeholder': 'Nombre del espacio de trabajo',
        'name.create': 'Crear',
        'name.cancel': 'Cancelar',
      }],
    ]
    try {
      for (const [locale, dict] of dictionaries) disposers.push(ctx.locale.register(LOCALE_NS, locale, dict))
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers) dispose() }
  }, 'workspace-name: dialog dictionaries')

  const injected = (): NameFlowInjected => ({ t: ctx.locale.bind(LOCALE_NS) })
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.header.action.directoryFlow', function* () {
      yield ctx.slots.register({
        name: 'conversation.hero.workspace.directoryFlow', inject: injected,
      }, NameWorkspaceFlow)
      yield ctx.slots.register({
        name: 'sidebar.header.action.directoryFlow', inject: injected,
      }, NameWorkspaceFlow)
    }))
}
