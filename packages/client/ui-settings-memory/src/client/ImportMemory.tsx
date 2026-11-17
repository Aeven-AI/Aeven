/**
 * Import memory: the row at the top of Settings → Memory. Its button takes one file and hands it to Æven in a new
 * conversation, which reads it with its own tools and saves what is worth remembering.
 */
import { useRef, useState } from 'react'
import { Button, SettingsRow, Spinner } from '@aeven/client-ui-primitives'
import type { ImportUploadStage } from './import-upload.ts'
import type { MemorySectionProps } from './MemorySection.tsx'
import type { MemoryLocaleKey } from './locales.ts'
import css from './MemorySection.module.css'

type Translate = MemorySectionProps['t']

/** File types the picker offers; any export or saved conversation in these forms is read by the agent. */
const ACCEPT = '.zip,.json,.jsonl,.md,.markdown,.txt,.html,.csv'

/** Failure codes the Host or the upload gives, with their copy. */
const FAILURE: Record<string, MemoryLocaleKey> = {
  FILE_TOO_LARGE: 'import.tooLarge',
  NO_TEXT: 'import.noText',
  FILE_EMPTY: 'import.noText',
  UNSUPPORTED_FILE_TYPE: 'import.unsupported',
}

/**
 * Render the Import memory row.
 * @param props - copy, the import operation, and the Settings close action.
 * @returns the row.
 */
export function ImportMemory({ t, importFile, close }: {
  readonly t: Translate
  readonly importFile: (file: File, onStage: (stage: ImportUploadStage) => void) => Promise<void>
  readonly close: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<ImportUploadStage>()
  const [failure, setFailure] = useState<string>()

  const start = async (file: File): Promise<void> => {
    setFailure(undefined)
    try {
      await importFile(file, setStage)
      close()
    } catch (error) {
      const code = (error as { code?: string }).code
      setFailure(t((code === undefined ? undefined : FAILURE[code]) ?? 'import.failed'))
    } finally {
      setStage(undefined)
    }
  }

  return (
    <SettingsRow
      title={t('import.title')}
      description={stage !== undefined
        ? <span className={css.status}><Spinner /> {t(stage === 'preparing' ? 'import.preparing' : 'import.uploading')}</span>
        : failure !== undefined
          ? <span className={css.failure}>{failure}</span>
          : t('import.description')}
      control={(
        <>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className={css.fileInput}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file !== undefined) void start(file)
            }}
          />
          <Button variant="outline" disabled={stage !== undefined} onClick={() => { input.current?.click() }}>{t('import.button')}</Button>
        </>
      )}
    />
  )
}
