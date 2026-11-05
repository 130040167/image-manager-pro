import { describe, expect, it } from 'vitest'
import { Editor } from '~/webview/image-manager/components/image-editor/fabric-photo/core/editor'
import { SetBackground } from '~/webview/image-manager/components/image-editor/fabric-photo/core/steps/doc-steps'

describe('editor unified range history', () => {
  it('undoes ranges and filters in operation order and compacts one drag to one step', () => {
    const editor = new Editor()
    editor.dispatch(editor.newTransaction().addStep(new SetBackground({ src: 'data:,x', name: 'x', width: 800, height: 600, angle: 0 })))
    editor.clearUndoStack()
    for (let i = 1; i <= 100; i++)
      editor.setDisplayValueRange([i, 255], { mergeKey: 'first-gesture' })
    expect(editor.history.undoSize).toBe(1)
    const entry = editor.history.popUndo()!
    expect(entry.redo).toHaveLength(1)
    expect(entry.inverse).toHaveLength(1)
    editor.history.pushUndo(entry)
    editor.setBackgroundFilters({ brightness: 0.2 })
    editor.setDisplayValueRange([110, 230], { mergeKey: 'second-gesture' })
    editor.undo()
    expect(editor.state.doc.background?.valueRange).toEqual([100, 255])
    expect(editor.state.doc.background?.filters?.brightness).toBe(0.2)
    editor.undo()
    expect(editor.state.doc.background?.filters).toBeUndefined()
    editor.undo()
    expect(editor.state.doc.background?.valueRange).toBeUndefined()
    editor.redo()
    editor.redo()
    editor.redo()
    expect(editor.state.doc.background?.valueRange).toEqual([110, 230])
    expect(editor.state.doc.background?.filters?.brightness).toBe(0.2)
  })
})
