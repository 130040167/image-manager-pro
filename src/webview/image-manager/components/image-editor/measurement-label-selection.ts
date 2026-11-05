import type { Editor, PathObject } from './fabric-photo/core'
import { useCallback, useSyncExternalStore } from 'react'
import { measurementLabelSettings, measurementMetricLabelSettings } from './measurement-label'

export type MeasurementLabelKind = 'general' | 'perimeter' | 'area'
type LabelSelection = { objectId: string, kind: MeasurementLabelKind } | null
type SelectionStore = { current: LabelSelection, listeners: Set<() => void> }

// Ephemeral, editor-scoped UI state; selecting a label must not enter undo/export data.
const stores = new WeakMap<Editor, SelectionStore>()

function selectionStore(editor: Editor): SelectionStore {
  let store = stores.get(editor)
  if (!store) {
    store = { current: null, listeners: new Set() }
    stores.set(editor, store)
  }
  return store
}

export function useMeasurementLabelSelection(editor: Editor) {
  const store = selectionStore(editor)
  const subscribe = useCallback((listener: () => void) => {
    store.listeners.add(listener)
    return () => {
      store.listeners.delete(listener)
    }
  }, [store])
  const getSnapshot = useCallback(() => store.current, [store])
  const selection = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const selectLabel = useCallback((objectId: string, kind: MeasurementLabelKind) => {
    if (store.current?.objectId === objectId && store.current.kind === kind)
      return
    store.current = { objectId, kind }
    for (const listener of store.listeners)
      listener()
  }, [store])
  return { selection, selectLabel }
}

/** Shared by the inspector and canvas outline, including name-only and hidden metrics. */
export function selectedMeasurementLabelKind(object: PathObject, selection: LabelSelection): MeasurementLabelKind {
  if ((object.measurementKind !== 'polygon' && object.measurementKind !== 'ellipse') || measurementLabelSettings(object).content === 'name')
    return 'general'
  if (selection?.objectId === object.id && selection.kind !== 'general')
    return selection.kind
  return measurementMetricLabelSettings(object, 'perimeter').visible ? 'perimeter' : 'area'
}
