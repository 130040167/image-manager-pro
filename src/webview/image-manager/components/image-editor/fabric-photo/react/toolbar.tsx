import type { JSX } from 'react'
import type { IconType } from 'react-icons'
import type { ToolId } from './tool-settings'
import {
  FiCrop,
  FiEdit3,
  FiMousePointer,
  FiMove,
  FiRotateCw,
  FiType,
} from 'react-icons/fi'
import { useEditorTranslation } from '../../editor-i18n'
import { useEditor, useEditorState, useToolSettings } from './hooks'
import { activateTool, modeToTool } from './tool-settings'

export interface ToolDef {
  id: ToolId
  icon: IconType
  label: string
  shortcut?: string // T8 快捷键展示用
}

const MeasureToolIcon: IconType = ({ size = 18, ...props }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7' strokeLinejoin='round' {...props}><path d='M3 16 L16 3 L21 8 L8 21 Z M7 12 L10 15 M11 8 L14 11 M15 4 L18 7' /></svg>
)

const ShapesToolIcon: IconType = ({ size = 18, ...props }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round' {...props}>
    <path d='M12 2.5 L18 10.5 H6 Z' />
    <rect x='3' y='14' width='7' height='7' rx='1' />
    <circle cx='17.5' cy='17.5' r='3.5' />
  </svg>
)

const MosaicToolIcon: IconType = ({ size = 18, ...props }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='currentColor' {...props}>
    <rect x='3' y='3' width='5' height='5' rx='.7' opacity='.95' />
    <rect x='10' y='3' width='4' height='4' rx='.6' opacity='.55' />
    <rect x='16' y='3' width='5' height='6' rx='.7' opacity='.8' />
    <rect x='3' y='10' width='6' height='5' rx='.7' opacity='.5' />
    <rect x='11' y='9' width='5' height='6' rx='.7' opacity='.9' />
    <rect x='18' y='11' width='3' height='4' rx='.5' opacity='.45' />
    <rect x='3' y='17' width='5' height='4' rx='.6' opacity='.85' />
    <rect x='10' y='17' width='4' height='4' rx='.6' opacity='.45' />
    <rect x='16' y='17' width='5' height='4' rx='.6' opacity='.7' />
  </svg>
)

/** 工具栏定义（渲染顺序即数组顺序）；rotate 是动作按钮，不产生 active 态。 */
export const TOOLS: ToolDef[] = [
  { id: 'select', icon: FiMousePointer, label: '选择', shortcut: 'V' },
  { id: 'crop', icon: FiCrop, label: '裁剪', shortcut: 'C' },
  { id: 'rotate', icon: FiRotateCw, label: '旋转', shortcut: 'R' },
  { id: 'freedraw', icon: FiEdit3, label: '画笔', shortcut: 'P' },
  { id: 'shape', icon: ShapesToolIcon, label: '形状', shortcut: 'S' },
  { id: 'text', icon: FiType, label: '文字', shortcut: 'T' },
  { id: 'mosaic', icon: MosaicToolIcon, label: '马赛克', shortcut: 'M' },
  { id: 'measure', icon: MeasureToolIcon, label: '测量' },
  { id: 'pan', icon: FiMove, label: '平移', shortcut: 'H' },
]

/**
 * 左侧工具栏：每个工具一个图标按钮。active = modeToTool(当前 mode) === tool.id；
 * rotate 是动作（rotate 90°）无 active 态。点击 mode 工具 → activateTool；
 * 再次点击已激活的 mode 工具 → editor.endAll() 回 normal。
 */
export function Toolbar(props: { className?: string, measureActive?: boolean }): JSX.Element {
  const et = useEditorTranslation()
  const editor = useEditor()
  const { toolSettings } = useToolSettings()
  const activeTool = useEditorState(state => modeToTool(state.mode))

  const handleClick = (tool: ToolDef): void => {
    const shapesActive = tool.id === 'shape' && (activeTool === 'shape' || activeTool === 'line' || activeTool === 'arrow')
    if (tool.id === 'measure' ? props.measureActive : tool.id !== 'rotate' && !props.measureActive && (activeTool === tool.id || shapesActive)) {
      editor.endAll()
      document.dispatchEvent(new CustomEvent('image-editor-end-measure'))
      return
    }
    activateTool(editor, tool.id, toolSettings)
  }

  const rootClassName = props.className === undefined ? 'fp-toolbar' : `fp-toolbar ${props.className}`
  return (
    <div className={rootClassName}>
      {TOOLS.map((tool) => {
        const shapesActive = tool.id === 'shape' && (activeTool === 'shape' || activeTool === 'line' || activeTool === 'arrow')
        const isActive = tool.id === 'measure' ? props.measureActive : tool.id !== 'rotate' && !props.measureActive && (activeTool === tool.id || shapesActive)
        const btnClassName = isActive ? 'fp-tool-btn fp-tool-btn-active' : 'fp-tool-btn'
        // lucide-react 0.344 的类型基于 React 18 JSX 命名空间，与 @types/react 19
        // 的 ReactNode 不兼容；运行时是标准 FC，渲染处收窄为 JSX.ElementType
        const Icon = tool.icon as unknown as JSX.ElementType
        return (
          <button
            key={tool.id}
            type='button'
            className={btnClassName}
            title={tool.shortcut === undefined ? et(tool.label) : `${et(tool.label)} (${tool.shortcut})`}
            aria-pressed={isActive}
            onClick={() => handleClick(tool)}
            onContextMenu={(event) => {
              event.preventDefault()
              if (tool.id !== 'rotate') {
                editor.endAll()
                document.dispatchEvent(new CustomEvent('image-editor-end-measure'))
              }
            }}
          >
            <Icon size={18} aria-hidden />
            <span className='fp-tool-btn-label'>{et(tool.label)}</span>
          </button>
        )
      })}
    </div>
  )
}
