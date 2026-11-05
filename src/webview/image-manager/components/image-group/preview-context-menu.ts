import type { ImageContextMenuType } from '../context-menus/components/image-context-menu/hooks/use-image-context-menu'

type EnableContextMenu = ImageContextMenuType['enableContextMenu']

export function isInPreviewRoot(target: EventTarget | null) {
  return target instanceof HTMLElement && !!target.closest('.ant-image-preview-root, .rc-image-preview-root')
}

export function resolvePreviewRootTarget(
  target: EventTarget | null,
  point?: { x: number, y: number },
) {
  if (target instanceof HTMLElement) {
    const matched = target.closest('.ant-image-preview-root, .rc-image-preview-root')
    if (matched instanceof HTMLElement)
      return matched
  }
  if (!point || typeof document === 'undefined' || typeof document.elementFromPoint !== 'function')
    return null
  const fallback = document.elementFromPoint(point.x, point.y)
  if (!(fallback instanceof HTMLElement))
    return null
  const matched = fallback.closest('.ant-image-preview-root, .rc-image-preview-root')
  return matched instanceof HTMLElement ? matched : null
}

export function buildThumbnailContextMenuEnable(base: EnableContextMenu): EnableContextMenu {
  return {
    ...base,
    preview: false,
  }
}

export function buildPreviewContextMenuEnable(base: EnableContextMenu): EnableContextMenu {
  return {
    ...base,
    reveal_in_viewer: true,
    transform: true,
    copy: false,
    rename: false,
    delete: false,
    cut: false,
    compress: true,
    crop: true,
    edit: true,
    find_similar_in_all: true,
    find_similar_in_same_level: true,
    format_conversion: true,
    preview: false,
  }
}
