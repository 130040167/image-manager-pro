import type { PropsWithChildren } from 'react'
import { useUpdateEffect } from 'ahooks'
import { Button, Tooltip } from 'antd'
import { toLower } from 'es-toolkit/compat'
import { useAtomValue, useSetAtom } from 'jotai'
import { memo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { IoSettingsOutline } from 'react-icons/io5'
import { homepage } from '~root/package.json'
import logo from '~root/assets/logo.webp?base64'
import { logLayoutDebug } from '~/webview/image-manager/utils/layout-debug'
import { getCssVar, setHtmlTheme } from '~/webview/image-manager/utils/theme'
import { createViewportStabilityState, isRestoreViewportCollapsed, isTinyViewport, readViewportSize, shouldRestoreViewportOnVisible } from '~/webview/image-manager/utils/viewport-restore'
import useSettings from '../../hooks/use-settings/use-settings'
import { GlobalAtoms } from '../../stores/global/global-store'
import { useViewportStable } from '../../stores/global/hooks'
import { useLanguage, useTheme } from '../../stores/settings/hooks'

const RESTORE_STABLE_FRAME_COUNT = 4

function Layout(props: PropsWithChildren) {
  const { children } = props
  const { i18n } = useTranslation()

  const [theme] = useTheme()
  const [language] = useLanguage()
  const viewportStable = useViewportStable()
  const viewportState = useAtomValue(GlobalAtoms.viewportStabilityAtom)
  const setViewportState = useSetAtom(GlobalAtoms.viewportStabilityAtom)

  const { t } = useTranslation()

  const domRef = useRef<HTMLDivElement>(null)
  const restoreRafRef = useRef<number>()
  const restoreTimeoutRef = useRef<number>()
  const restorePendingRef = useRef(true)
  const stableFramesRef = useRef(viewportState.stable ? RESTORE_STABLE_FRAME_COUNT : 0)
  const viewportStateRef = useRef(viewportState)
  const viewportLogKeyRef = useRef('')
  viewportStateRef.current = viewportState
  useEffect(() => {
    const fontSize = getCssVar('--ant-font-size', domRef.current!).split('px')[0]
    document.documentElement.style.fontSize = `${fontSize}px`
    logLayoutDebug('layout mounted', {
      antFontSize: fontSize,
    })
  }, [])

  useEffect(() => {
    const clearRestoreChecks = () => {
      if (restoreRafRef.current) {
        window.cancelAnimationFrame(restoreRafRef.current)
        restoreRafRef.current = undefined
      }
      if (restoreTimeoutRef.current) {
        window.clearTimeout(restoreTimeoutRef.current)
        restoreTimeoutRef.current = undefined
      }
    }

    const commitViewportState = (
      source: string,
      nextState: typeof viewportState,
      extra?: Record<string, unknown>,
    ) => {
      viewportStateRef.current = nextState
      setViewportState((previous) => {
        if (
          previous.stable === nextState.stable
          && previous.visible === nextState.visible
          && previous.reason === nextState.reason
          && previous.viewport.width === nextState.viewport.width
          && previous.viewport.height === nextState.viewport.height
          && previous.lastStableViewport?.width === nextState.lastStableViewport?.width
          && previous.lastStableViewport?.height === nextState.lastStableViewport?.height
        ) {
          return previous
        }
        return nextState
      })

      const logKey = [
        source,
        nextState.visible ? 'visible' : 'hidden',
        nextState.stable ? 'stable' : 'unstable',
        nextState.reason,
        `${nextState.viewport.width}x${nextState.viewport.height}`,
        `${nextState.lastStableViewport?.width || 0}x${nextState.lastStableViewport?.height || 0}`,
      ].join('|')

      if (logKey !== viewportLogKeyRef.current) {
        viewportLogKeyRef.current = logKey
        logLayoutDebug('layout viewport guard state', {
          lastStableViewport: nextState.lastStableViewport,
          reason: nextState.reason,
          restoring: restorePendingRef.current,
          source,
          stable: nextState.stable,
          stableFrames: stableFramesRef.current,
          visible: nextState.visible,
          ...extra,
        })
      }
    }

    const markStable = (source: string, viewport = readViewportSize()) => {
      restorePendingRef.current = false
      stableFramesRef.current = RESTORE_STABLE_FRAME_COUNT
      commitViewportState(source, createViewportStabilityState({
        stable: true,
        visible: true,
        reason: 'stable',
        viewport,
        lastStableViewport: viewport,
      }))
    }

    const markUnstable = (
      source: string,
      reason: 'hidden' | 'restore-collapsed',
      viewport = readViewportSize(),
      extra?: Record<string, unknown>,
    ) => {
      stableFramesRef.current = 0
      commitViewportState(source, createViewportStabilityState({
        stable: false,
        visible: document.visibilityState !== 'hidden',
        reason,
        viewport,
        lastStableViewport: viewportStateRef.current.lastStableViewport,
      }), extra)
    }

    const evaluateViewport = (source: string) => {
      const visible = document.visibilityState !== 'hidden'
      const viewport = readViewportSize()

      if (!visible) {
        restorePendingRef.current = true
        clearRestoreChecks()
        markUnstable(source, 'hidden', viewport)
        return
      }

      const lastStableViewport = viewportStateRef.current.lastStableViewport
      const firstMeasure = !lastStableViewport
      const shouldTreatAsCollapsedOnBoot = firstMeasure && isTinyViewport(viewport)
      const collapsed = isRestoreViewportCollapsed({
        viewport,
        restoring: restorePendingRef.current,
        lastStableViewport,
      }) || shouldTreatAsCollapsedOnBoot

      if (collapsed) {
        restorePendingRef.current = true
        markUnstable(source, 'restore-collapsed', viewport, {
          firstMeasure,
          lastStableViewport,
          shouldTreatAsCollapsedOnBoot,
        })
        clearRestoreChecks()
        restoreRafRef.current = window.requestAnimationFrame(() => {
          evaluateViewport(`${source}:raf`)
        })
        restoreTimeoutRef.current = window.setTimeout(() => {
          evaluateViewport(`${source}:timeout`)
        }, 120)
        return
      }

      if (restorePendingRef.current) {
        stableFramesRef.current += 1
        if (stableFramesRef.current < RESTORE_STABLE_FRAME_COUNT) {
          commitViewportState(source, createViewportStabilityState({
            stable: false,
            visible: true,
            reason: 'restore-collapsed',
            viewport,
            lastStableViewport,
          }), {
            requiredStableFrames: RESTORE_STABLE_FRAME_COUNT,
            waitingStableFrames: RESTORE_STABLE_FRAME_COUNT - stableFramesRef.current,
          })
          clearRestoreChecks()
          restoreRafRef.current = window.requestAnimationFrame(() => {
            evaluateViewport(`${source}:settle`)
          })
          return
        }
      }

      clearRestoreChecks()
      markStable(source, viewport)
    }

    const logVisibility = () => {
      logLayoutDebug('layout visibility change', {
        activeElement: document.activeElement instanceof HTMLElement ? document.activeElement.tagName : undefined,
      })
      if (document.visibilityState === 'visible') {
        const viewport = readViewportSize()
        const lastStableViewport = viewportStateRef.current.lastStableViewport
        const shouldEnterRestore = shouldRestoreViewportOnVisible({
          viewport,
          lastStableViewport,
        }) || (!lastStableViewport && isTinyViewport(viewport))

        restorePendingRef.current = shouldEnterRestore
        stableFramesRef.current = shouldEnterRestore ? 0 : RESTORE_STABLE_FRAME_COUNT
        evaluateViewport('visibility:visible')
        window.requestAnimationFrame(() => {
          logLayoutDebug('layout visibility restore raf#1')
          evaluateViewport('visibility:raf#1')
          window.requestAnimationFrame(() => {
            logLayoutDebug('layout visibility restore raf#2')
            evaluateViewport('visibility:raf#2')
          })
        })
      }
      else {
        evaluateViewport('visibility:hidden')
      }
    }

    const logResize = () => {
      logLayoutDebug('layout window resize')
      evaluateViewport('resize')
    }

    evaluateViewport('mount')
    document.addEventListener('visibilitychange', logVisibility)
    window.addEventListener('resize', logResize)
    return () => {
      clearRestoreChecks()
      document.removeEventListener('visibilitychange', logVisibility)
      window.removeEventListener('resize', logResize)
    }
  }, [setViewportState])

  useEffect(() => {
    document.body.classList.toggle('im-viewport-restoring', !viewportState.stable)
    document.body.dataset.imViewportState = viewportState.reason
    return () => {
      document.body.classList.remove('im-viewport-restoring')
      delete document.body.dataset.imViewportState
    }
  }, [viewportState.reason, viewportState.stable])

  // every time the theme changes, update the html theme (for tailwindcss)
  useEffect(() => {
    setHtmlTheme(theme)
  }, [theme])

  useUpdateEffect(() => {
    i18n.changeLanguage(language)
  }, [language])

  const { showSettings } = useSettings()

  return (
    <div
      className='min-h-full w-full space-y-2 p-4'
      ref={domRef}
      data-im-layout-root
      data-im-viewport-stable={viewportStable ? 'true' : 'false'}
      style={viewportStable ? undefined : { visibility: 'hidden' }}
    >
      <header className='mb-4 flex items-center justify-between'>
        <a href={homepage} target='_blank' rel='noreferrer noopener'>
          <img src={logo} alt='Image Manager Pro' className='h-9 w-9 object-contain' />
        </a>

        <Tooltip title={toLower(t('im.settings'))} arrow={false} placement='bottom'>
          <Button
            type='text'
            icon={(
              <div className='flex items-center text-2xl'>
                <IoSettingsOutline />
              </div>
            )}
            onClick={showSettings}
          >
          </Button>
        </Tooltip>
      </header>
      {children}
    </div>
  )
}

export default memo(Layout)
