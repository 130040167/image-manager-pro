import type { Editor } from './fabric-photo/core'
import type { CustomImageDecodeOptions } from '~/core/custom-format/types'
import { useMemoizedFn } from 'ahooks'
import { useEffect, useRef, useState } from 'react'
import { fetchUnsupportedAsBase64, isUnsupportedImage, releaseUnsupportedDataUrls } from '../../utils/unsupported-image-cache'
import { copyImageAsBase64, EDITOR_IMAGE_LOAD_TIMEOUT_MS, loadImageData, normalizeImageName, withTimeout } from './editor-utils'
import { normalizeValueRange } from './histogram-range'

export function useEditorImage({ editor, image, customOptionsKey, customDecodeOptions, isCustom }: { editor: Editor | null, image: ImageType | undefined, customOptionsKey: string, customDecodeOptions: CustomImageDecodeOptions | undefined, isCustom: boolean }) {
  const sourceSeqRef = useRef(0)
  const rangeBaseSrcRef = useRef('')
  const rangeBaseImageDataRef = useRef<ImageData | null>(null)
  const pixelLoadSeqRef = useRef(0)
  const filteredSignatureRef = useRef('')
  const [sourceSrc, setSourceSrc] = useState('')
  const [rawImageData, setRawImageData] = useState<ImageData | null>(null)
  const [displayImageData, setDisplayImageData] = useState<ImageData | null>(null)
  const [editorLoading, setEditorLoading] = useState(true)
  const [editorError, setEditorError] = useState('')
  const [valueRange, setValueRange] = useState<[number, number]>([0, 255])
  const imageName = normalizeImageName(image)
  const resolveImageSrc = useMemoizedFn(async (currentImage: ImageType) => {
    if (isUnsupportedImage(currentImage) || isCustom) {
      return fetchUnsupportedAsBase64(currentImage.path, {
        decodeOptions: isCustom ? customDecodeOptions : undefined,
        delivery: 'uri',
        forceCustomDecode: isCustom,
        priority: 'high',
      })
    }
    return currentImage.vscodePath
  })

  const syncFilteredDisplay = useMemoizedFn(() => {
    const base = rangeBaseImageDataRef.current
    if (!editor || !base)
      return
    const range = normalizeValueRange(editor.state.doc.background?.valueRange ?? [0, 255])
    setValueRange(current => current[0] === range[0] && current[1] === range[1] ? current : range)
    const filters = editor.state.doc.background?.filters
    const signature = JSON.stringify({ filters: filters ?? null, range, src: rangeBaseSrcRef.current })
    if (signature === filteredSignatureRef.current)
      return
    const rendered = editor.getBackgroundImageData()
    if (!rendered)
      return
    filteredSignatureRef.current = signature
    setDisplayImageData(rendered)
  })

  const refreshDisplay = useMemoizedFn(async (src: string) => {
    const seq = ++pixelLoadSeqRef.current
    rangeBaseSrcRef.current = src
    rangeBaseImageDataRef.current = null
    filteredSignatureRef.current = ''
    const data = await loadImageData(src)
    if (seq !== pixelLoadSeqRef.current || src !== rangeBaseSrcRef.current)
      return
    rangeBaseImageDataRef.current = data
    setRawImageData(data)
    setDisplayImageData(data)
    syncFilteredDisplay()
  })

  useEffect(() => {
    if (!image)
      return
    const seq = ++sourceSeqRef.current
    let disposed = false
    setEditorLoading(true)
    setEditorError('')
    setSourceSrc('')
    setRawImageData(null)
    rangeBaseImageDataRef.current = null
    rangeBaseSrcRef.current = ''
    filteredSignatureRef.current = ''
    pixelLoadSeqRef.current++
    setDisplayImageData(null)
    setValueRange([0, 255])
    resolveImageSrc(image)
      .then((src) => {
        if (disposed || seq !== sourceSeqRef.current)
          return
        if (!src)
          throw new Error('Image source is empty')
        setSourceSrc(src)
      })
      .catch((err) => {
        if (!disposed) {
          setEditorLoading(false)
          setEditorError(err instanceof Error ? err.message : String(err))
        }
      })
    return () => {
      disposed = true
      pixelLoadSeqRef.current++
      rangeBaseImageDataRef.current = null
      rangeBaseSrcRef.current = ''
      releaseUnsupportedDataUrls()
    }
  }, [customOptionsKey, image?.path, resolveImageSrc])

  useEffect(() => {
    if (!editor || !sourceSrc)
      return
    let disposed = false
    const loadSeq = ++sourceSeqRef.current
    const load = async () => {
      const candidates = [() => Promise.resolve(sourceSrc), ...(image && !isUnsupportedImage(image) ? [() => copyImageAsBase64(image.path)] : [])]
      let lastError: unknown
      for (const candidate of candidates) {
        if (disposed || loadSeq !== sourceSeqRef.current)
          return
        try {
          const src = await candidate()
          if (!src || disposed || loadSeq !== sourceSeqRef.current)
            continue
          await withTimeout(editor.loadImageFromURL(src, imageName), EDITOR_IMAGE_LOAD_TIMEOUT_MS, 'fabric-photo load image')
          if (disposed || loadSeq !== sourceSeqRef.current)
            return
          await refreshDisplay(src)
          if (disposed || loadSeq !== sourceSeqRef.current)
            return
          setEditorLoading(false)
          return
        }
        catch (err) {
          lastError = err
        }
      }
      if (!disposed) {
        setEditorLoading(false)
        setEditorError(lastError instanceof Error ? lastError.message : String(lastError ?? 'Unable to load image'))
      }
    }
    void load()
    return () => {
      disposed = true
    }
  }, [editor, image?.path, imageName, refreshDisplay, sourceSrc])

  const setEditorValueRange = useMemoizedFn((nextRange: [number, number], options: { mergeKey?: string } = {}) => {
    editor?.setDisplayValueRange(nextRange, options)
  })

  useEffect(() => {
    if (!editor)
      return
    return editor.subscribe(() => {
      const current = editor.state.doc.background?.src
      if (current && current !== rangeBaseSrcRef.current)
        void refreshDisplay(current).catch(() => undefined)
      syncFilteredDisplay()
    })
  }, [editor, refreshDisplay, syncFilteredDisplay])
  return { sourceSrc, rawImageData, displayImageData, valueRange, setEditorValueRange, editorLoading, editorError }
}
