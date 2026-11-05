import type { EditorUIState } from './context'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Editor } from '../core'
import { useToolSettings } from './hooks'
import { EditorProvider } from './provider'
import { Toolbar, TOOLS } from './toolbar'

// —— 真实无头 Editor（不触碰 fabric）：Toolbar 通过 EditorProvider 注入，
// spy 直接打在实例原型方法上验证委托路径。 ——

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

// vitest 未开 globals，testing-library 自动清理未注册；getBy* 绑定 document.body，需手动清理
afterEach(() => {
  cleanup()
})

/** 探针：把 UI 层 toolSettings 暴露给断言。 */
function makeSettingsProbe(): { Probe: () => null, read: () => EditorUIState } {
  let current: EditorUIState | null = null
  function Probe(): null {
    current = useToolSettings()
    return null
  }
  return {
    Probe,
    read: () => {
      if (current === null) {
        throw new Error('probe not mounted')
      }
      return current
    },
  }
}

function renderWithEditor(editor: Editor): ReturnType<typeof render> & { readSettings: () => EditorUIState } {
  const { Probe, read } = makeSettingsProbe()
  const utils = render(
    <EditorProvider editor={editor}>
      <Toolbar />
      <Probe />
    </EditorProvider>,
  )
  return { ...utils, readSettings: read }
}

function toolButton(utils: ReturnType<typeof render>, label: string): HTMLElement {
  return utils.getByText(label).closest('button') as HTMLElement
}

describe('toolbar', () => {
  it('将直线和箭头合并到形状入口，并保留其余工具顺序', () => {
    const editor = new Editor()
    const utils = renderWithEditor(editor)

    const buttons = utils.container.querySelectorAll('.fp-toolbar .fp-tool-btn')
    expect(buttons).toHaveLength(9)
    const labels = Array.from(buttons).map(btn => btn.textContent)
    expect(labels).toEqual(TOOLS.map(t => t.label))
    expect(labels).toEqual(['选择', '裁剪', '旋转', '画笔', '形状', '文字', '马赛克', '测量', '平移'])
    expect(utils.queryByText('直线')).toBeNull()
    expect(utils.queryByText('箭头')).toBeNull()

    expect(toolButton(utils, '选择').className).toContain('fp-tool-btn-active')
    editor.destroy()
  })

  it('快捷键进入 line/arrow mode 时，侧栏形状入口保持 active', () => {
    const editor = new Editor()
    const utils = renderWithEditor(editor)

    act(() => editor.startLineDrawing())
    expect(toolButton(utils, '形状').className).toContain('fp-tool-btn-active')
    act(() => editor.startArrowDrawing())
    expect(toolButton(utils, '形状').className).toContain('fp-tool-btn-active')
    editor.destroy()
  })

  it('点击「画笔」进入 freedraw 且按钮 active；再点回 normal（endAll）', () => {
    const editor = new Editor()
    const utils = renderWithEditor(editor)

    fireEvent.click(toolButton(utils, '画笔'))
    expect(editor.getCurrentState()).toBe('freedraw')
    expect(toolButton(utils, '画笔').className).toContain('fp-tool-btn-active')
    expect(toolButton(utils, '选择').className).not.toContain('fp-tool-btn-active')

    fireEvent.click(toolButton(utils, '画笔'))
    expect(editor.getCurrentState()).toBe('normal')
    expect(toolButton(utils, '画笔').className).not.toContain('fp-tool-btn-active')
    expect(toolButton(utils, '选择').className).toContain('fp-tool-btn-active')
    editor.destroy()
  })

  it('点击「旋转」调 rotate(90)（动作按钮，无 active 态残留）', () => {
    const editor = new Editor()
    const spy = vi.spyOn(editor, 'rotate')
    const utils = renderWithEditor(editor)

    fireEvent.click(toolButton(utils, '旋转'))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(90)
    expect(editor.getCurrentState()).toBe('normal')
    expect(toolButton(utils, '旋转').className).not.toContain('fp-tool-btn-active')
    expect(toolButton(utils, '选择').className).toContain('fp-tool-btn-active')
    editor.destroy()
  })
})
