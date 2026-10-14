/**
 * Model providers settings section: the configured provider rows joined from
 * the configurable directory, settings namespaces, and credential states,
 * with one editor card at a time. No provider is configured by default; the
 * add flow is a card carrying the select of every dormant provider, and a
 * switchable whole-section provider (one whose section declares `enabled`)
 * is added by switching it on and removed by switching it off. Rows expose
 * only confirmed API-key state through accessible solid configured or missing
 * dots. Each card kind owns its own open state, so closing one never discards
 * a draft in another. Every mutation writes through the wire, while a
 * provider removal first requires confirmation; the page re-renders from
 * pushed invalidations or the post-apply reload.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { SettingsNamespaceView, SettingsPathOpView } from '@aeven/api-remotes/client'
import {
  Button, IconPlusOutline16, Modal, ProviderRow as ProviderRowCard, ProviderRowButton, ProviderRowList, SectionHeader,
} from '@aeven/client-ui-primitives'
import type { InjectFace, PropsRenderSlots } from '@aeven/client-ui-slots'
// Type-only: pulls this package's SlotMap merge (the two Models child slots).
import type {} from './slot-contract.ts'
import { CustomProviderCard } from './CustomProviderCard.tsx'
import { deriveKeyRef, ENABLED_FIELD, protocolChoices } from './store.ts'
import type { ModelsSettingsStore, ProviderRow } from './store.ts'
import type { ModelsOperations } from './operations.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import { ProviderPicker } from './ProviderPicker.tsx'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Injected dependencies of {@link ModelsSection} (slot `inject`). */
export interface ModelsSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: ModelsSettingsStore
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: ModelsSettingsStore['store']
  }
  /** The Host operations the section and its cards invoke. */
  operations: ModelsOperations
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/** The child slots this section declares and dispatches (see ./slot-contract.ts). */
type ModelsChildSlots = 'settings.models.provider-card' | 'settings.models.footer'

/** The child-slot dispatch function the renderer binds for the section. */
type ModelsRenderSlot = PropsRenderSlots<ModelsChildSlots>['renderSlot']

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call) plus the child-slot
 * dispatch seat. The seat is required: the renderer binds it at the render
 * call itself — unlike the inject face it is never absent at runtime — and a
 * direct render that forgets it fails to compile instead of mounting nothing.
 */
export type ModelsSectionProps = Partial<InjectFace<ModelsSectionInjected>> & PropsRenderSlots<ModelsChildSlots>

type ModelsSectionFace = InjectFace<ModelsSectionInjected>

/** Provider identity shared by row actions and confirmation copy. */
export interface ProviderIdentity {
  /** Stable provider route id. */
  provider: string
  /** Human-facing provider name. */
  displayName: string
}

/** One existing row or dormant directory entry addressed by an editor action. */
interface EditorTarget extends ProviderIdentity {
  settingsNs: string
  settingsPath: readonly string[]
  /** Writable credential identified under this page's conventional reference. */
  credentialRef?: string
  /** The adapter reports this route as one it does not ship (see {@link ProviderEditorProps.declared}). */
  declared?: boolean
  /** The whole-section provider is added and removed through its `enabled` field. */
  switchable?: boolean
}

/**
 * The settings ops that take one provider off the page. A keyed profile is
 * unset by name rather than rebuilding its namespace from a partial view. A
 * switchable whole-section provider drops every user-layer field and ends
 * switched off, so adding it again starts from the composition's values.
 * @param target - the provider's settings address.
 * @param namespace - the owning namespace view.
 * @param schema - settings schema and immutable path callbacks.
 * @returns the ordered path ops.
 */
export function removalOps(
  target: Pick<EditorTarget, 'settingsPath' | 'switchable'>,
  namespace: SettingsNamespaceView,
  schema: SettingsSchemaOperations,
): SettingsPathOpView[] {
  if (target.switchable !== true) return [{ op: 'unset', path: [...target.settingsPath] }]
  const user = namespace.user
  const keys = typeof user === 'object' && user !== null && !Array.isArray(user) ? Object.keys(user) : []
  const baseOff = schema.getPath(namespace.base, [ENABLED_FIELD]) === false
  const ops: SettingsPathOpView[] = keys
    .filter(key => baseOff || key !== ENABLED_FIELD)
    .map(key => ({ op: 'unset', path: [key] }))
  if (!baseOff) ops.push({ op: 'set', path: [ENABLED_FIELD], value: false })
  return ops
}

/**
 * Remove one provider and its page-managed credential. Credential removal
 * comes first so a second-step failure leaves the provider row visible and
 * the whole operation safely retryable; every op is idempotent.
 * @param operations - the page's Host operations.
 * @param controller - the page store to refresh.
 * @param target - the owning namespace, its removal ops, and optional managed credential.
 * @returns the failure message, or undefined once the write and reload landed.
 */
export async function removeProviderProfile(
  operations: ModelsOperations,
  controller: ModelsSettingsStore,
  target: { settingsNs: string; ops: readonly SettingsPathOpView[]; credentialRef?: string },
): Promise<string | undefined> {
  if (target.credentialRef !== undefined) {
    const credential = await operations.removeCredential(target.credentialRef)
    if (credential !== undefined) return credential
  }
  const written = await operations.writeSettings(target.settingsNs, [...target.ops], undefined)
  if (written.kind !== 'written') return written.message
  await controller.load()
  return undefined
}

/**
 * The provider-card seat's credential fact: the reference this page would use
 * for the row — the profile's `apiKeyEnv`, or the page's derived
 * `<ROUTE>_API_KEY` while the profile names none — confirmed configured. The
 * derived half is what keeps the seat consistent with the editor on the
 * add-provider draft, whose dormant row names no reference yet.
 */
function keyConfiguredOf(row: ProviderRow): boolean {
  return row.apiKeyEnv !== undefined
    ? row.credential?.configured === true
    : row.derivedCredential?.configured === true
}

function targetOf(row: ProviderRow): EditorTarget {
  // A switchable section's own reference is the one its card writes keys
  // through; a keyed profile's is the page's derived `<ROUTE>_API_KEY`.
  const managedRef = row.switchable ? row.apiKeyEnv : deriveKeyRef(row.entry.provider)
  const credentialRef = managedRef !== undefined
    && row.apiKeyEnv === managedRef
    && row.credential?.configured === true
    && row.credential.writable
    ? managedRef
    : undefined
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    ...credentialRef === undefined ? {} : { credentialRef },
    // Only declared routes may expose route-owned fields.
    ...row.entry.declared === true ? { declared: true } : {},
    ...row.switchable ? { switchable: true } : {},
  }
}

/**
 * Order add-select candidates by the name a person scans for, so no adapter
 * family is listed first by registration order alone.
 */
function byDisplayName(left: ProviderRow, right: ProviderRow): number {
  return left.entry.displayName.localeCompare(right.entry.displayName, undefined, { numeric: true, sensitivity: 'base' })
    || left.entry.provider.localeCompare(right.entry.provider)
}

/**
 * Drop a multi-provider catalog route that a dedicated adapter also offers
 * under the same name: the dedicated adapter's whole-section route (an empty
 * settings path) is the one built for that provider, and listing both shows
 * one provider twice.
 * @param rows - addable rows.
 * @returns the rows without the shadowed catalog routes.
 */
function withoutShadowedRoutes(rows: readonly ProviderRow[]): ProviderRow[] {
  const dedicated = new Set(rows
    .filter(row => row.entry.settingsPath.length === 0)
    .map(row => row.entry.displayName.toLowerCase()))
  return rows.filter(row => row.entry.settingsPath.length === 0 || !dedicated.has(row.entry.displayName.toLowerCase()))
}

/** Stable visible and accessible identity for one provider target. */
export function providerTargetLabel(target: ProviderIdentity): string {
  return target.provider === target.displayName
    ? target.provider
    : `${target.displayName} (${target.provider})`
}

/** Replace the one provider placeholder in localized destructive-action copy. */
export function providerCopy(template: string, target: ProviderIdentity): string {
  return template.replace('{provider}', () => providerTargetLabel(target))
}

/**
 * Render the Models section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function ModelsSection(props: ModelsSectionProps): ReactNode {
  const { controller, useSnapshot, operations, schema, t, renderSlot } = props
  if (
    controller === undefined || useSnapshot === undefined || operations === undefined
    || schema === undefined || t === undefined
  ) return null
  return <Loaded injected={{ controller, useSnapshot, operations, schema, t }} renderSlot={renderSlot} />
}

function Loaded({ injected, renderSlot }: { injected: ModelsSectionFace; renderSlot: ModelsRenderSlot }): ReactNode {
  const { controller, operations, schema, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [editing, setEditing] = useState<EditorTarget | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<EditorTarget | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailure, setDeleteFailure] = useState<string | undefined>(undefined)
  const [savedTarget, setSavedTarget] = useState<ProviderIdentity | undefined>(undefined)
  const [declaring, setDeclaring] = useState(false)

  const announceSaved = (target: ProviderIdentity): void => {
    // Announced only once the refreshed directory is in the snapshot the
    // notice reads its name from: an apply can rename the route, and the
    // target captured when the card opened still carries the old name.
    void controller.load().then(() => { setSavedTarget(target) })
  }

  const closeEditor = (changed: boolean, target: ProviderIdentity): void => {
    setEditing(undefined)
    setAdding(false)
    setDeclaring(false)
    if (changed) announceSaved(target)
  }

  const closeDelete = (): void => {
    if (deleting) return
    setDeleteTarget(undefined)
    setDeleteFailure(undefined)
  }

  const confirmDelete = (): void => {
    /* v8 ignore next -- the action only renders with a target and is disabled while a deletion is pending */
    if (deleteTarget === undefined || deleting) return
    const namespace = state.namespaces.get(deleteTarget.settingsNs)
    /* v8 ignore next -- a removable row always resolved its namespace */
    if (namespace === undefined) return
    setDeleting(true)
    setDeleteFailure(undefined)
    void removeProviderProfile(operations, controller, {
      settingsNs: deleteTarget.settingsNs,
      ops: removalOps(deleteTarget, namespace, schema),
      ...deleteTarget.credentialRef === undefined ? {} : { credentialRef: deleteTarget.credentialRef },
    })
      .then((failure) => {
        if (failure !== undefined) {
          setDeleteFailure(failure)
          return
        }
        setDeleteTarget(undefined)
      })
      .finally(() => { setDeleting(false) })
  }

  if (state.status === 'idle') void controller.load()
  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
    const errorText = state.error ?? ''
    return (
      <div className={styles['section']}>
        <SectionHeader title={t('title')} description={t('intro')} />
        <p className={styles['error']}>{`${t('loadFailed')}: ${errorText}`}</p>
        <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  // The saved provider as the directory currently names it. The route id is
  // what the apply cannot change, so it is what the notice is keyed by; a row
  // the same apply removed keeps the captured identity, since nothing newer
  // exists to name it with.
  const savedRow = savedTarget === undefined
    ? undefined
    : state.rows.find(row => row.entry.provider === savedTarget.provider)
  const savedIdentity = savedRow === undefined
    ? savedTarget
    : { provider: savedRow.entry.provider, displayName: savedRow.entry.displayName }

  const configured = state.rows.filter(row => row.configured)
  // A dormant keyed profile is added by writing it; a dormant whole-section
  // provider only when its section can switch it on.
  const addable = withoutShadowedRoutes(state.rows
    .filter(row => !row.configured && row.entry.settingsNs !== ''
      && (row.entry.settingsPath.length > 0 || row.switchable)))
    .sort(byDisplayName)
  // Two adapter families may ship a route under the same name; the route id
  // tells their options apart.
  const addLabel = (row: ProviderRow): string =>
    addable.some(other => other !== row && other.entry.displayName === row.entry.displayName)
      ? providerTargetLabel(row.entry)
      : row.entry.displayName
  const addTarget = adding ? editing : undefined
  const cancelAdd = (): void => {
    setAdding(false)
    setEditing(undefined)
  }
  const addNamespace = addTarget === undefined ? undefined : state.namespaces.get(addTarget.settingsNs)
  // The draft's directory row, for the card extension seat. A refresh can drop
  // the row mid-draft (the route was adopted or withdrawn elsewhere); the
  // draft card stays while the seat simply has no row to dispatch.
  const addRow = addTarget === undefined
    ? undefined
    : state.rows.find(row => row.entry.provider === addTarget.provider)
  // Hand-declared routes live in the pi-ai namespace, which is also the only
  // one whose schema names the protocols one may speak; without it mounted
  // there is nothing to declare and the entry point stays disabled.
  const protocols = protocolChoices(state.namespaces.get('llm-pi-ai'), schema)

  return (
    <div className={styles['section']}>
      <SectionHeader title={t('title')} description={t('intro')} />
      {!state.writable && state.status === 'ready' ? <p className={styles['notice']}>{t('readOnly')}</p> : null}
      {savedIdentity === undefined
        ? null
        : (
          <p className={styles['savedNotice']} role="status" aria-live="polite">
            {providerCopy(t('savedProvider'), savedIdentity)}
          </p>
        )}
      {configured.length === 0 && state.status === 'ready'
        ? <p className={styles['empty']}>{t('empty')}</p>
        : null}
      <div className={configured.length === 0 ? undefined : styles['rows']}>
        <ProviderRowList>
          {configured.map((row) => {
            const target = targetOf(row)
            const namespace = state.namespaces.get(target.settingsNs)
            /* v8 ignore next -- the join marks a row configured only when its namespace resolved */
            if (namespace === undefined) return null
            const open = !adding && editing?.provider === row.entry.provider
            const credentialConfigured = row.credential?.configured === true
            const credentialMissing = !credentialConfigured
              && row.apiKeyEnv !== undefined
              && row.credential?.configured === false
            return (
              <ProviderRowCard
                key={row.entry.provider}
                name={row.entry.displayName}
                // Only the adapter can tell a hand-declared route from a
                // shipped one it also has a stored profile for, so the tag
                // follows its answer and stays off when it gives none.
                tag={row.entry.declared === true ? t('customTag') : undefined}
                status={credentialConfigured
                  ? { tone: 'ok', label: t('credentialConfigured') }
                  : credentialMissing
                    ? { tone: 'missing', label: t('credentialMissing') }
                    : undefined}
                actions={(
                  <>
                    <ProviderRowButton
                      aria-label={providerCopy(t('editProvider'), target)}
                      onClick={() => {
                        setSavedTarget(undefined)
                        // One card at a time: leaving `declaring` set would show
                        // the create card beside this editor, and closing either
                        // one discards the other's draft.
                        setDeclaring(false)
                        setAdding(false)
                        setEditing(open ? undefined : target)
                      }}
                    >
                      {t('edit')}
                    </ProviderRowButton>
                    {row.removable
                      ? (
                        <ProviderRowButton
                          tone="danger"
                          aria-label={providerCopy(t('removeProvider'), target)}
                          disabled={!state.writable}
                          onClick={() => {
                            setSavedTarget(undefined)
                            setDeleteFailure(undefined)
                            setDeleteTarget(target)
                          }}
                        >
                          {t('remove')}
                        </ProviderRowButton>
                      )
                      : null}
                  </>
                )}
              >
                {renderSlot(
                  'settings.models.provider-card',
                  { provider: row.entry, configured: row.configured, keyConfigured: keyConfiguredOf(row) },
                  { entryKey: row.entry.settingsNs },
                )}
                {open
                  ? (
                    <ProviderEditor
                      provider={target.provider}
                      displayName={target.displayName}
                      settingsPath={target.settingsPath}
                      {...target.declared === true ? { declared: true } : {}}
                      namespace={namespace}
                      schema={schema}
                      operations={operations}
                      t={t}
                      readOnly={!state.writable}
                      onClose={(changed) => { closeEditor(changed, target) }}
                    />
                  )
                  : null}
              </ProviderRowCard>
            )
          })}
        </ProviderRowList>
      </div>
      <div className={styles['addBlock']}>
        {adding
          ? (
            <div className={styles['addCard']}>
              <div className={styles['field']}>
                <span className={styles['fieldLabel']}>{t('provider')}</span>
                <ProviderPicker
                  options={addable.map(row => ({ id: row.entry.provider, label: addLabel(row) }))}
                  value={addTarget?.provider}
                  label={t('chooseProvider')}
                  searchLabel={t('searchProviders')}
                  emptyLabel={t('noProviderMatches')}
                  defaultOpen={addTarget === undefined}
                  disabled={!state.writable}
                  onChange={(id) => {
                    const row = addable.find(candidate => candidate.entry.provider === id)
                    /* v8 ignore next -- the picker only lists addable rows */
                    if (row === undefined) return
                    setEditing(targetOf(row))
                  }}
                  // Closing the list before any choice abandons the add.
                  onDismiss={() => { if (addTarget === undefined) cancelAdd() }}
                />
              </div>
              {addTarget !== undefined && addNamespace !== undefined
                ? (
                  <ProviderEditor
                    key={addTarget.provider}
                    provider={addTarget.provider}
                    displayName={addTarget.displayName}
                    hideTitle
                    namespace={addNamespace}
                    schema={schema}
                    settingsPath={addTarget.settingsPath}
                    operations={operations}
                    t={t}
                    readOnly={!state.writable}
                    {...addTarget.switchable === true ? { activate: true } : {}}
                    // Switching a keyed route on without a key would only add
                    // models that fail on first use.
                    {...addTarget.switchable === true && addRow?.credential?.configured !== true
                      ? { credentialRequired: true }
                      : {}}
                    onClose={(changed) => { closeEditor(changed, addTarget) }}
                  />
                )
                : null}
              {addRow === undefined
                ? null
                : renderSlot(
                  'settings.models.provider-card',
                  { provider: addRow.entry, configured: addRow.configured, keyConfigured: keyConfiguredOf(addRow) },
                  { entryKey: addRow.entry.settingsNs },
                )}
            </div>
          )
          : declaring
            ? (
              <div className={styles['addCard']}>
                <CustomProviderCard
                  taken={state.rows.map(row => row.entry.provider)}
                  protocols={protocols}
                  /* v8 ignore next -- the card only opens from a button disabled without this namespace */
                  revision={state.namespaces.get('llm-pi-ai')?.revision ?? 0}
                  operations={operations}
                  t={t}
                  readOnly={!state.writable}
                  onClose={(changed) => {
                    setDeclaring(false)
                    if (changed) void controller.load()
                  }}
                />
              </div>
            )
            : (
              // The two ways to gain a provider: adopt one the adapter already
              // knows (the common path, so the primary button), or declare one
              // it does not.
              <div className={styles['addActions']}>
                <button
                  type="button"
                  className={`${styles['addButton']} ${styles['addButtonPrimary']}`}
                  disabled={addable.length === 0 || !state.writable}
                  onClick={() => {
                    setSavedTarget(undefined)
                    setDeclaring(false)
                    setAdding(true)
                    setEditing(undefined)
                  }}
                >
                  <IconPlusOutline16 size={14} />
                  {t('add')}
                </button>
                <button
                  type="button"
                  className={styles['addButton']}
                  disabled={protocols.length === 0 || !state.writable}
                  onClick={() => {
                    setSavedTarget(undefined)
                    setAdding(false)
                    setEditing(undefined)
                    setDeclaring(true)
                  }}
                >
                  <IconPlusOutline16 size={14} />
                  {t('customAdd')}
                </button>
              </div>
            )}
      </div>
      {renderSlot('settings.models.footer', {})}
      <Modal
        open={deleteTarget !== undefined}
        onClose={closeDelete}
        title={deleteTarget === undefined ? '' : providerCopy(t('deleteTitle'), deleteTarget)}
        closeLabel={t('close')}
        description={deleteTarget === undefined
          ? ''
          : providerCopy(
            deleteTarget.credentialRef === undefined
              ? t('deleteDescription')
              : t('deleteDescriptionWithCredential'),
            deleteTarget,
          )}
        className={styles['deleteDialog'] as string}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={deleting} onClick={closeDelete}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={styles['deleteConfirm']}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {deleteTarget === undefined
                ? ''
                : providerCopy(deleting ? t('deleting') : t('deleteConfirm'), deleteTarget)}
            </Button>
          </>
        )}
      >
        {deleteFailure === undefined ? null : <p className={styles['error']}>{deleteFailure}</p>}
      </Modal>
    </div>
  )
}
