import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { clientBuildEnvironmentDefines } from '../../scripts/client-build-environment.ts'

const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))
const STANDALONE_ERROR = 'apps/web is not a standalone application: bare Vite cannot inject window.__AVN_BOOT__. '
  + 'From a repository checkout, run `pnpm avn web`; an installed package uses `avn web`. '
  + 'For client-plugin HMR, run `pnpm avn web` together with `pnpm run dev:web`.'
const DEFAULT_CLIENT_TITLE = 'Æven'

/** Escape build-time text before placing it in the HTML title element. */
function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Project the public build title into the initial HTML document.
 *
 * Matches the title element rather than the placeholder text it happens to
 * carry: a literal here stops applying the moment `index.html`'s title is
 * edited, and this is the only thing that makes `AVN_CLIENT_TITLE` and the
 * default reach a reader before the client sets the document title.
 */
function clientDocumentTitle(): Plugin {
  const title = escapeHtmlText(process.env.AVN_CLIENT_TITLE ?? DEFAULT_CLIENT_TITLE)
  return {
    name: 'avn-client-document-title',
    transformIndexHtml(html) {
      if (!html.includes('<title>')) {
        throw new Error('avn-client-document-title: apps/web/index.html must carry a <title> element')
      }
      return html.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    },
  }
}

/** Fail before a Vite dev or preview server can expose the boot-manifest-free shell. */
function rejectStandaloneServe(): Plugin {
  return {
    name: 'avn-reject-standalone-web-serve',
    config(_config, env) {
      if (env.command === 'serve') throw new Error(STANDALONE_ERROR)
    },
  }
}

/**
 * Inline the first-paint preloader stylesheet so the browser can paint it from
 * the document bytes. Vite would otherwise fold that file into the combined
 * application CSS and hold first paint on the full payload.
 */
function inlinePreloaderCss(): Plugin {
  const cssPath = src('./src/preloader.css')
  const sourceTag = '<link rel="stylesheet" href="/src/preloader.css" />'
  return {
    name: 'avn-inline-preloader-css',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!html.includes(sourceTag)) {
          throw new Error('vite: index.html lost its preloader stylesheet link')
        }
        const css = readFileSync(cssPath, 'utf8')
        if (css.includes('</style')) throw new Error('vite: preloader.css cannot contain </style')
        return html.replace(sourceTag, `<style>${css}</style>`)
      },
    },
  }
}

/**
 * Load Vite's remaining stylesheets without render-blocking first paint. The
 * inlined preloader CSS already covers the loading page; application CSS is
 * promoted from preload once it arrives.
 */
function destageBuiltStylesheets(): Plugin {
  return {
    name: 'avn-destage-built-stylesheets',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'asset' || !item.fileName.endsWith('.html') || typeof item.source !== 'string') continue
        item.source = item.source.replace(
          /<link rel="stylesheet"([^>]+)>/g,
          '<link rel="preload" as="style"$1 onload="this.onload=null;this.rel=\'stylesheet\'">\n    <noscript><link rel="stylesheet"$1></noscript>',
        )
      }
    },
  }
}

/**
 * Font files the application paints its own text in, by asset stem. KaTeX
 * ships faces too; those are wanted only where math renders and are left to
 * the stylesheet that asks for them.
 */
const APPLICATION_FONT_STEMS: readonly string[] = [
  'google-sans-flex-latin-wght-normal',
  'google-sans-code-latin-wght-normal',
]

/**
 * Start the application's own faces with the document.
 *
 * Every stylesheet here is destaged, so a browser discovers the `@font-face`
 * rules only once the application CSS has arrived and starts the font later
 * still. These hints issue both requests with the document, at low priority so
 * they do not take an HTTP connection from the sign-in shell. The full
 * application waits for the faces before mounting.
 */
function preloadApplicationFonts(): Plugin {
  return {
    name: 'avn-preload-application-fonts',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const fonts = Object.keys(bundle).filter(fileName =>
        APPLICATION_FONT_STEMS.some(stem => fileName.includes(`/fonts/${stem}-`)))
      if (fonts.length !== APPLICATION_FONT_STEMS.length) {
        throw new Error(`vite: expected ${String(APPLICATION_FONT_STEMS.length)} application font assets, found ${String(fonts.length)}`)
      }
      const links = fonts
        .map(fileName => `<link rel="preload" as="font" type="font/woff2" crossorigin fetchpriority="low" href="./${fileName}">`)
        .join('\n    ')
      for (const item of Object.values(bundle)) {
        if (item.type !== 'asset' || !item.fileName.endsWith('.html') || typeof item.source !== 'string') continue
        const anchor = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />'
        if (!item.source.includes(anchor)) throw new Error('vite: index.html lost its viewport meta')
        item.source = item.source.replace(anchor, `${anchor}\n    ${links}`)
      }
    },
  }
}

/**
 * Emit preview.html beside index.html: the built index page with one module
 * script — the worker bootstrap entry — spliced ahead of its entry tag. Both
 * pages share every chunk; the extra tag is the only difference, so the
 * static worker deployment ships the served page verbatim plus its
 * bootstrap.
 */
function emitPreviewPage(): Plugin {
  let bootstrapFile: string | undefined
  return {
    name: 'avn-emit-preview-page',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk' && item.isEntry && item.name === 'bootstrap') bootstrapFile = item.fileName
      }
      if (bootstrapFile === undefined) throw new Error('vite: preview bootstrap entry missing from the bundle')
    },
    async closeBundle() {
      // A build that failed before generateBundle has no page to splice.
      if (bootstrapFile === undefined) return
      const page = await readFile(src('./dist/index.html'), 'utf8')
      const anchor = page.indexOf('<script type="module"')
      if (anchor === -1) throw new Error('vite: built index.html lost its module entry tag')
      const tag = `<script type="module" crossorigin src="./${bootstrapFile}"></script>`
      await writeFile(src('./dist/preview.html'), `${page.slice(0, anchor)}${tag}${page.slice(anchor)}`)
    },
  }
}

/**
 * Named render-family chunks, by npm package identity. Math, highlight, and
 * the markdown parse pipeline change on different dependency bumps, so each
 * family is its own file: a KaTeX upgrade must not bust the highlighter cache.
 * The parse pipeline is named `mdast` so it cannot collide with a lazy
 * highlight.js language whose rollup name is `markdown`.
 * Explicit manual-chunk membership leaves unrelated dependencies in
 * Rollup-owned shared chunks, so naming a rendering family cannot pull its
 * full closure onto the sign-in path. The mdast and micromark package families
 * stay together because their extension packages import each other in both
 * directions. Mermaid is a dynamic `import()` from the diagram plugin, so
 * Rollup already emits it as on-demand chunks; listing it here would fold
 * those back onto the application graph.
 *
 * Every member must be React-free. A package that
 * imports react/jsx-runtime must never be listed — rollup folds a module
 * shared between the entry and a manual chunk into the manual chunk, so one
 * react-importing member would drag the single shared react copy out of
 * index. The React side of markdown/math rendering is workspace code and
 * rides index.
 */
const RENDER_CHUNKS: Readonly<Record<string, 'katex' | 'hljs' | 'xterm'>> = {
  katex: 'katex',
  'highlight.js': 'hljs',
  lowlight: 'hljs',
  '@xterm/xterm': 'xterm',
  '@xterm/addon-fit': 'xterm',
}

/** Render-family chunk for one npm package, when it has an explicit owner. */
function renderChunkForPackage(pkg: string): 'katex' | 'hljs' | 'xterm' | 'mdast' | undefined {
  if (pkg === 'micromark' || pkg.startsWith('micromark-') || pkg.startsWith('mdast-util-')) return 'mdast'
  return RENDER_CHUNKS[pkg]
}

const NAMED_RENDER_CHUNKS: ReadonlySet<string> = new Set([
  'index', 'auth', 'react', 'primitives', 'hypermarkdown', 'katex', 'hljs', 'xterm', 'mdast',
])

/**
 * Path fragments that identify mermaid and the diagram engines it lazy-loads.
 * Used only to name already-split async chunks; they must not enter
 * {@link RENDER_CHUNKS}.
 */
const MERMAID_PATHS: readonly string[] = [
  'node_modules/mermaid',
  'node_modules/cytoscape',
  'node_modules/cytoscape-cose-bilkent',
  'node_modules/cytoscape-fcose',
  'node_modules/cose-bilkent',
  'node_modules/dagre',
  'node_modules/d3',
  'node_modules/dompurify',
  'node_modules/roughjs',
  'node_modules/khroma',
  'node_modules/@braintree/sanitize-url',
  'node_modules/@iconify',
  'node_modules/@mermaid-js/parser',
  'node_modules/ts-dedent',
  'node_modules/dayjs',
]

/** Font asset extensions routed to assets/fonts/ (KaTeX's woff2/woff/ttf faces). */
const FONT_EXTENSIONS: readonly string[] = ['.woff2', '.woff', '.ttf']

/**
 * npm package name of a resolved module id: the segment after the last
 * `node_modules/`. pnpm nests the real package under an inner node_modules.
 */
function npmPackageOf(id: string): string | undefined {
  const parts = id.split('/node_modules/')
  if (parts.length === 1) return undefined
  const [first, second] = parts[parts.length - 1].split('/')
  if (first.startsWith('.')) return undefined // .pnpm store segment, not a package
  if (first.startsWith('@')) return second === undefined ? undefined : `${first}/${second}`
  return first
}

export default defineConfig({
  // Relative asset URLs: preview.html mounts the same output under any base
  // directory, and the served index resolves identically from the site root.
  base: './',
  plugins: [
    rejectStandaloneServe(), clientDocumentTitle(), inlinePreloaderCss(), react(), destageBuiltStylesheets(),
    preloadApplicationFonts(), emitPreviewPage(),
  ],
  build: {
    // The worker bootstrap holds its page at top-level await; Vite's default
    // `modules` target (es2020-era) rejects that syntax.
    target: 'es2022',
    // Mermaid's two largest diagram-engine chunks are lazy and stay off every
    // session that does not render a diagram. Keep size warnings above their
    // current sub-700 kB range for unexpected eager or dependency growth.
    chunkSizeWarningLimit: 700,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: src('./index.html'),
        // Standalone entry, not an index.html script tag: Vite folds every
        // module tag of one page into a single synthetic entry, and only a
        // separate input keeps the shared page chunks bootstrap-free.
        bootstrap: src('./src/preview.ts'),
      },
      output: {
        // A manually named async family contains only the modules selected
        // below. Pulling its dependency closure into that chunk can create a
        // static edge back from the sign-in entry and defeat the async split.
        onlyExplicitManualChunks: true,
        // The worker-preview surface groups under dist/preview/ (the page
        // itself stays at dist/preview.html), so the published payload can
        // exclude it as one directory.
        entryFileNames(chunk): string {
          return chunk.name === 'bootstrap' ? 'preview/[name]-[hash].js' : 'assets/[name]-[hash].js'
        },
        // Output layout: named shell and rendering chunks stay at assets/ root; a language
        // grammar that is only dynamically imported groups under
        // assets/langs/; mermaid's async diagram engines group as m-core /
        // m-asset; fonts (KaTeX faces) group under assets/fonts/. Sourcemaps
        // need no arrangement: rollup writes each .map next to its js and
        // references it by bare relative filename.
        chunkFileNames(chunk): string {
          if (!NAMED_RENDER_CHUNKS.has(chunk.name)
            && chunk.moduleIds.some(id => id.includes('/highlight.js/lib/languages/'))) {
            return 'assets/langs/[name]-[hash].js'
          }
          if (NAMED_RENDER_CHUNKS.has(chunk.name)) return 'assets/[name]-[hash].js'
          const isMermaidChunk = chunk.moduleIds.some(id => MERMAID_PATHS.some(part => id.includes(part)))
          if (isMermaidChunk) {
            return chunk.name.startsWith('mermaid.core')
              ? 'assets/m-core-[hash].js'
              : 'assets/m-asset-[hash].js'
          }
          return 'assets/[name]-[hash].js'
        },
        assetFileNames(asset): string {
          const fileName = asset.names[0] ?? ''
          const isFont = FONT_EXTENSIONS.some(ext => fileName.endsWith(ext))
          return isFont ? 'assets/fonts/[name]-[hash][extname]' : 'assets/[name]-[hash][extname]'
        },
        manualChunks(id: string): string | undefined {
          const pkg = npmPackageOf(id)
          if (id.includes('/packages/client/ui-auth-aeven/')) return 'auth'
          if (id.includes('/packages/client/ui-primitives/')) return 'primitives'
          // The Markdown engine is a workspace library like the two above, so
          // the npm-package attribution below cannot name it: without this its
          // bytes fall into the index chunk and stop being cached apart.
          if (id.includes('/packages/client/hypermarkdown/')) return 'hypermarkdown'
          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'react'
          if (pkg === undefined) return undefined // workspace + vendored cordis: index
          // Language grammars stay unassigned so a dynamic `import()` keeps its
          // own on-demand chunk. Grammars HyperMarkdown already static-imports
          // through lowlight/common still land in `hljs` with their importer.
          if (pkg === 'highlight.js' && id.includes('/languages/')) return undefined
          return renderChunkForPackage(pkg)
        },
      },
    },
  },
  worker: {
    // The preview worker rides dist/preview/ with the rest of that surface.
    rollupOptions: { output: { entryFileNames: 'preview/[name]-[hash].js' } },
  },
  resolve: {
    // One instance per shared npm identity: a bare specifier otherwise resolves
    // from the importer's directory, so a diverging range ships a second React
    // and splits hook and element identity. Entries are package ids — they cover
    // react/jsx-runtime and react-dom/client — and resolve from this package's
    // node_modules, so react must stay a devDependency here and any watcher must
    // run vite from this directory (scripts/dev-web.ts). Workspace packages need
    // no entry: pnpm links each of them to a single directory.
    dedupe: ['react', 'react-dom'],
    // Workspace packages are consumed as built lib products: each resolves
    // through its own package.json exports from the importer's directory, and
    // CSS still rides Vite's pipeline because the client build preset emits it
    // beside the bundle. Plugin packages never enter this graph; they arrive as
    // runtime bundles through the client module system. The remaining alias
    // browserizes the vendored Cordis Loader's only Node import.
    alias: [
      { find: /^node:module$/, replacement: src('./src/node-module-stub.ts') },
    ],
  },
  define: {
    ...clientBuildEnvironmentDefines(process.env),
    // vendored loader internal.ts: fromInternal() probes the Node major —
    // "0.0.0" takes neither branch, returning undefined (exactly the empty
    // internal slot the shell boot fills with the client module loader).
    'process.versions.node': '"0.0.0"',
    'process.execArgv': '[]',
    // vendored loader index.ts: envData falls to its default branch.
    'process.env.CORDIS_SHARED': 'undefined',
  },
})
