import { Provider as JotaiProvider, useSetAtom } from 'jotai'
import { startTransition, Suspense, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { ErrorBoundary } from 'react-error-boundary'
import { DEFAULT_CONFIG } from '~/core/config/common'
import { DEFAULT_WORKSPACE_STATE } from '~/core/persist/workspace/common'
import { CmdToVscode } from '~/message/cmd'
import { FALLBACK_LANGUAGE, Language, ReduceMotion, Theme } from '~/meta'
import logger from '~/utils/logger'
import { getAppRoot, intelligentPickConfig } from '~/webview/utils'
import { vscodeApi } from '~/webview/vscode-api'
import ImageManager from '.'
import AntdConfigProvider from './components/antd-config-provider'
import Fallback from './components/fallback'
import { initI18n } from './i18n'
import { GlobalAtoms } from './stores/global/global-store'
import { VscodeAtomsHydrator } from './stores/vscode/vscode-store'
import './styles/index.css'
import './hmr'

function reportWebviewError(data: {
  message?: string
  stack?: string
  source?: string
  lineno?: number
  colno?: number
}) {
  try {
    vscodeApi.postMessage({
      cmd: CmdToVscode.webview_error,
      data,
    })
  }
  catch {
    // ignore: fallback to console only
  }
}

window.addEventListener('error', (event) => {
  reportWebviewError({
    colno: event.colno,
    lineno: event.lineno,
    message: event.message,
    source: event.filename,
    stack: event.error?.stack,
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  reportWebviewError({
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    source: 'unhandledrejection',
  })
})

function ensureAppRootVisible() {
  const root = getAppRoot()
  if (root) {
    root.style.visibility = ''
  }
}

let key = 0
const WEBVIEW_LANGUAGE_STATE_KEY = 'imageManagerLanguage'

type WebviewState = {
  [WEBVIEW_LANGUAGE_STATE_KEY]?: string
}

type BootstrapData = {
  config: {
    ext: typeof DEFAULT_CONFIG
    vscode: {
      language: Language
      reduceMotion: ReduceMotion
      theme: Theme
    }
  }
  workspaceState: typeof DEFAULT_WORKSPACE_STATE
  windowState: {
    __reveal_image_path__?: string
    __sharp_installed__?: boolean
  }
}

function isKnownLanguage(value: unknown): value is Language {
  return typeof value === 'string' && Object.values(Language).includes(value as Language)
}

function readPersistedLanguage() {
  const state = vscodeApi.getState() as WebviewState | undefined
  const language = state?.[WEBVIEW_LANGUAGE_STATE_KEY]
  return isKnownLanguage(language) && language !== Language.auto ? language : FALLBACK_LANGUAGE
}

function persistLanguage(language: Language) {
  const previous = vscodeApi.getState()
  const nextState = previous && typeof previous === 'object'
    ? {
        ...(previous as Record<string, unknown>),
        [WEBVIEW_LANGUAGE_STATE_KEY]: language,
      }
    : {
        [WEBVIEW_LANGUAGE_STATE_KEY]: language,
      }
  vscodeApi.setState(nextState)
}

function createDefaultBootstrapData(language: Language): BootstrapData {
  return {
    config: {
      ext: {
        ...DEFAULT_CONFIG,
        appearance: {
          ...DEFAULT_CONFIG.appearance,
          language,
        },
      },
      vscode: {
        language,
        reduceMotion: ReduceMotion.auto,
        theme: Theme.dark,
      },
    },
    workspaceState: DEFAULT_WORKSPACE_STATE,
    windowState: {
      __reveal_image_path__: undefined,
      __sharp_installed__: undefined,
    },
  }
}

const DEFAULT_BOOT_LANGUAGE = readPersistedLanguage()
const DEFAULT_BOOTSTRAP_DATA = createDefaultBootstrapData(DEFAULT_BOOT_LANGUAGE)

void initI18n({ lng: DEFAULT_BOOT_LANGUAGE })

function reactRoot() {
  ensureAppRootVisible()
  if (!window.__react_root__) {
    window.__react_root__ = ReactDOM.createRoot(getAppRoot())
  }
  return window.__react_root__
}

function AppShell(props: { children: JSX.Element, reload: boolean }) {
  const { children, reload } = props
  const [bootstrapData, setBootstrapData] = useState<BootstrapData>(DEFAULT_BOOTSTRAP_DATA)
  const setImageReveal = useSetAtom(GlobalAtoms.imageRevealAtom)
  const setSharpInstalled = useSetAtom(GlobalAtoms.sharpInstalledAtom)

  useEffect(() => {
    let disposed = false

    vscodeApi.postMessage(
      {
        cmd: CmdToVscode.on_webview_ready,
      },
      async (data: BootstrapData | undefined) => {
        if (!data || disposed) {
          return
        }

        logger.debug(CmdToVscode.on_webview_ready, { data, reload })
        const {
          config: { ext, vscode },
          windowState,
        } = data

        Object.keys(windowState || {}).forEach((key) => {
          window[key] = windowState[key]
        })
        setImageReveal(windowState?.__reveal_image_path__)
        setSharpInstalled(windowState?.__sharp_installed__)

        const config = intelligentPickConfig(ext, vscode)
        persistLanguage(config.appearance.language)
        await initI18n({ lng: config.appearance.language })

        if (!disposed) {
          setBootstrapData(data)
        }
      },
    )

    return () => {
      disposed = true
    }
  }, [reload])

  const {
    config: { ext, vscode },
    workspaceState,
  } = bootstrapData

  return (
    <VscodeAtomsHydrator extConfig={ext} vscodeConfig={vscode} workspaceState={workspaceState}>
      {children}
    </VscodeAtomsHydrator>
  )
}

function registerApp(children: JSX.Element, reload = false) {
  key = reload ? key + 1 : key

  ensureAppRootVisible()

  startTransition(() => {
    reactRoot().render(
      <div onContextMenu={e => e.preventDefault()} key={key}>
        <JotaiProvider>
          <AppShell reload={reload}>
            {children}
          </AppShell>
        </JotaiProvider>
      </div>,
    )
  })
}

function mount(reload?: boolean) {
  registerApp(
    <AntdConfigProvider>
      {/* Fallback依赖了antd provider */}
      <ErrorBoundary FallbackComponent={Fallback}>
        <Suspense fallback={<div className='p-4 text-ant-color-text-secondary'>Loading Image Manager...</div>}>
          <ImageManager />
        </Suspense>
      </ErrorBoundary>
    </AntdConfigProvider>,
    reload,
  )
}

window.mountApp = mount

mount()
