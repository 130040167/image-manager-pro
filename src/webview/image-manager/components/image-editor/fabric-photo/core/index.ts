export const VERSION = '0.1.0'

export { Editor } from './editor'
export type { EditorOptions, ExportImageOptions, ViewportInfo } from './editor'

export type { EditorEventMap } from './events'
export { cloneDoc, createDoc, DEFAULT_FILTERS, docFromJSON, docToJSON } from './model/doc'

export type {
  BackgroundImage,
  BaseObject,
  Doc,
  EditorObject,
  FilterSettings,
  ImageObject,
  MosaicObject,
  MosaicRect,
  PathObject,
  ShapeObject,
  TextObject,
} from './model/doc'

export { createId } from './model/id'
export { History } from './plugins/history'
export type { HistoryEntry, HistorySizes } from './plugins/history'
export type { Plugin } from './plugins/plugin'
export { EditorState, StepError } from './state/editor-state'
export type { EditorMode, EditorStateConfig, Viewport } from './state/editor-state'
export { RestoreDoc, SetBackground, TransformDoc } from './steps/doc-steps'
export { SetFilters } from './steps/filter-steps'

export { AddObject, ClearObjects, RemoveObject, RestoreObject, UpdateObject } from './steps/object-steps'
export type { ObjectAttrs } from './steps/object-steps'
export { computeReorderedIds, ReorderObjects } from './steps/reorder-objects-step'

export type { ReorderAction } from './steps/reorder-objects-step'
export { Step } from './steps/step'
export type { StepResult } from './steps/step'

export { Transaction } from './transform/transaction'
