import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Editor } from '../core'
import { EditorProvider } from './provider'
import { ZoomControls } from './zoom-controls'

// —— 真实无头 Editor（不触碰 fabric）：ZoomControls 通过 EditorProvider 注入，
// spy 直接打在实例方法上验证委托路径。 ——

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

// vitest 未开 globals，testing-library 自动清理未注册；getBy* 绑定 document.body，需手动清理
afterEach(() => {
  cleanup()
})

function renderWithEditor(editor: Editor): ReturnType<typeof render> {
  return render(
    <EditorProvider editor={editor}>
      <ZoomControls />
    </EditorProvider>,
  )
}

function button(utils: ReturnType<typeof render>, name: string): HTMLButtonElement {
  return utils.getByRole('button', { name }) as HTMLButtonElement
}

function zoomInput(utils: ReturnType<typeof render>): HTMLInputElement {
  return utils.getByRole('spinbutton', { name: '缩放百分比' }) as HTMLInputElement
}

describe('zoomControls', () => {
  it('点击放大 → setZoom 收到约 1.2（初始 1 + 0.2），百分比文案更新为 120%', () => {
    const editor = new Editor()
    const zoomSpy = vi.spyOn(editor, 'setZoom')
    const utils = renderWithEditor(editor)

    expect(zoomInput(utils).value).toBe('100')
    fireEvent.click(button(utils, '放大'))
    expect(zoomSpy).toHaveBeenCalledTimes(1)
    expect(zoomSpy.mock.calls[0][0]).toBeCloseTo(1.2)
    expect(zoomInput(utils).value).toBe('120')
    editor.destroy()
  })

  it('点击缩小 → setZoom 收到约 0.8（初始 1 - 0.2）', () => {
    const editor = new Editor()
    const zoomSpy = vi.spyOn(editor, 'setZoom')
    const utils = renderWithEditor(editor)

    fireEvent.click(button(utils, '缩小'))
    expect(zoomSpy).toHaveBeenCalledTimes(1)
    expect(zoomSpy.mock.calls[0][0]).toBeCloseTo(0.8)
    editor.destroy()
  })

  it('点击百分比复位：缩放回到 1 且平移归零', () => {
    const editor = new Editor()
    editor.dispatch(editor.newTransaction().setViewport({ zoom: 2, panX: 40, panY: -20 }).setMeta('addToHistory', false))
    const utils = renderWithEditor(editor)

    fireEvent.click(button(utils, '重置缩放并居中'))
    expect(editor.state.viewport).toEqual({ zoom: 1, panX: 0, panY: 0 })
    editor.destroy()
  })

  it('手动输入百分比并按 Enter 提交，通过 setZoom 限制范围', () => {
    const editor = new Editor()
    const zoomSpy = vi.spyOn(editor, 'setZoom')
    const utils = renderWithEditor(editor)
    const input = zoomInput(utils)

    act(() => input.focus())
    fireEvent.change(input, { target: { value: '250' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(zoomSpy).toHaveBeenCalledWith(2.5)
    expect(input.value).toBe('250')

    act(() => input.focus())
    fireEvent.change(input, { target: { value: '99999' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(editor.getZoom()).toBe(50)
    expect(input.value).toBe('5000')
    editor.destroy()
  })

  it('空输入失焦保持当前缩放，Esc 恢复当前百分比', () => {
    const editor = new Editor()
    editor.setZoom(1.8)
    const zoomSpy = vi.spyOn(editor, 'setZoom')
    const utils = renderWithEditor(editor)
    const input = zoomInput(utils)

    act(() => input.focus())
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(zoomSpy).not.toHaveBeenCalled()
    expect(input.value).toBe('180')

    act(() => input.focus())
    fireEvent.change(input, { target: { value: '240' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(zoomSpy).not.toHaveBeenCalled()
    expect(input.value).toBe('180')
    editor.destroy()
  })
})
