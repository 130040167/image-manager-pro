import i18next from 'i18next'
import { useSyncExternalStore } from 'react'

type Values = Record<string, string | number>

export function editorText(source: string, values: Values = {}): string {
  const fallback = source.replace(/\{\{(\w+)\}\}/g, (match, key) => String(values[key] ?? match))
  if (!i18next.isInitialized)
    return fallback
  return String(i18next.t(`im.editor.${source}`, { ...values, defaultValue: fallback }))
}

function subscribe(listener: () => void) {
  i18next.on('languageChanged', listener)
  return () => {
    i18next.off('languageChanged', listener)
  }
}

export function useEditorLanguage() {
  return useSyncExternalStore(subscribe, () => i18next.resolvedLanguage ?? i18next.language ?? 'zh-CN', () => 'zh-CN')
}

export function useEditorTranslation() {
  useEditorLanguage()
  return editorText
}
