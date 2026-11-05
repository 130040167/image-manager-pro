import type { Dispatch, SetStateAction } from 'react'
import type { CustomFormatSessionState } from './session'
import type { CustomFormatConfig, CustomImageDecodeOptions, CustomImageProbeResult } from '~/core/custom-format/types'
import { useMemoizedFn } from 'ahooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CmdToVscode } from '~/message/cmd'
import { useCustomFormats } from '~/webview/image-manager/stores/settings/hooks'
import { clearUnsupportedBase64Cache } from '~/webview/image-manager/utils/unsupported-image-cache'
import { vscodeApi } from '~/webview/vscode-api'
import {
  buildCustomFormatDecodeOptions,
  buildRawFolderPresetConfig,
  customFormatOptionsKey,

  getCustomFormatScopeKey,
  guessNpyLayoutForShape,
  isCustomFormatImageWithConfig,
  isCustomFormatLayoutCompatibleWithRank,
  isNpyImage,
  isRawLikeImage,
  resolveCustomFormatSessionFromConfig,
} from './session'

type ProbeResult = CustomImageProbeResult & {
  error?: string
}
type ProbeResponse = CustomImageProbeResult | { error: string } | null

function isProbeError(result: ProbeResponse): result is { error: string } {
  return !!result && 'error' in result
}

export type CustomFormatSessionController = {
  applyRawFolderPreset: (name: string) => void
  customFormats: CustomFormatConfig
  decodeOptions: CustomImageDecodeOptions
  isCustom: boolean
  isNpy: boolean
  isRawLike: boolean
  optionsKey: string
  probe: CustomImageProbeResult | null
  probeError: string
  probeLoading: boolean
  session: CustomFormatSessionState
  setCustomFormats: (value: CustomFormatConfig) => void
  setSession: Dispatch<SetStateAction<CustomFormatSessionState>>
}

export function useCustomFormatSession(image: ImageType | undefined): CustomFormatSessionController {
  const [customFormats, setCustomFormats] = useCustomFormats()
  const isCustom = isCustomFormatImageWithConfig(image, customFormats)
  const isNpy = isNpyImage(image, customFormats)
  const isRawLike = isRawLikeImage(image, customFormats)
  const scopeKey = getCustomFormatScopeKey(image)
  const [sessionByScope, setSessionByScope] = useState<Record<string, CustomFormatSessionState>>({})
  const [probe, setProbe] = useState<CustomImageProbeResult | null>(null)
  const [probeError, setProbeError] = useState('')
  const [probeLoading, setProbeLoading] = useState(false)
  const initializedScopeRef = useRef('')

  useEffect(() => {
    if (!image || !isCustom)
      return
    if (initializedScopeRef.current === scopeKey)
      return
    initializedScopeRef.current = scopeKey
    setSessionByScope(prev => ({
      ...prev,
      [scopeKey]: {
        ...resolveCustomFormatSessionFromConfig(customFormats, image),
        ...(prev[scopeKey] || {}),
      },
    }))
  }, [customFormats, image, isCustom, scopeKey])

  const session = sessionByScope[scopeKey] || {}
  const decodeOptions = useMemo(
    () => buildCustomFormatDecodeOptions(session, probe || undefined),
    [probe, session],
  )
  const optionsKey = useMemo(() => customFormatOptionsKey(decodeOptions), [decodeOptions])

  const setSession = useMemoizedFn((next: React.SetStateAction<CustomFormatSessionState>) => {
    if (!image)
      return
    setSessionByScope((prev) => {
      const current = prev[scopeKey] || {}
      const value = typeof next === 'function'
        ? (next as (prev: CustomFormatSessionState) => CustomFormatSessionState)(current)
        : next
      return {
        ...prev,
        [scopeKey]: value,
      }
    })
    clearUnsupportedBase64Cache(image.path)
  })

  useEffect(() => {
    if (!image || !isCustom)
      return
    let disposed = false
    setProbeLoading(true)
    setProbeError('')
    vscodeApi.postMessage({
      cmd: CmdToVscode.probe_custom_image,
      data: {
        filePath: image.path,
        options: decodeOptions,
      },
    }, (result: ProbeResponse) => {
      if (disposed)
        return
      setProbeLoading(false)
      if (!result || isProbeError(result)) {
        setProbe(null)
        setProbeError(isProbeError(result) ? result.error : 'Unable to probe custom image')
        return
      }
      setProbe(result)
      setSessionByScope((prev) => {
        const current = prev[scopeKey] || {}
        const rank = result.shape?.length
        const guessedLayout = isNpy ? guessNpyLayoutForShape(result.shape, current.layout) : result.layout
        const currentLayoutCompatible = isCustomFormatLayoutCompatibleWithRank(current.layout, rank)
        const shouldAutoLayout = !current.layoutLocked || !currentLayoutCompatible
        const nextLayout = shouldAutoLayout
          ? (guessedLayout || result.layout || current.layout)
          : current.layout
        const next = {
          ...current,
          layout: nextLayout,
          layoutLocked: currentLayoutCompatible ? current.layoutLocked : false,
          pageIndex: result.pageIndex,
        }
        if (current.layout === next.layout && current.layoutLocked === next.layoutLocked && current.pageIndex === next.pageIndex)
          return prev
        return {
          ...prev,
          [scopeKey]: next,
        }
      })
    })
    return () => {
      disposed = true
    }
  }, [decodeOptions, image?.path, isCustom, scopeKey])

  const applyRawFolderPreset = useMemoizedFn((name: string) => {
    if (!image)
      return
    const options = buildCustomFormatDecodeOptions(session, probe || undefined)
    setCustomFormats(buildRawFolderPresetConfig(customFormats, image, name, options))
    clearUnsupportedBase64Cache(image.path)
  })

  return {
    applyRawFolderPreset,
    customFormats,
    decodeOptions,
    isCustom,
    isNpy,
    isRawLike,
    optionsKey,
    probe,
    probeError,
    probeLoading,
    session,
    setCustomFormats,
    setSession,
  }
}
