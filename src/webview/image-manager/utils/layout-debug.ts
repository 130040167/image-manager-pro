import { vscodeApi } from '~/webview/vscode-api'

function roundIfNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : value
}

function rectSnapshot(target: Element | null | undefined) {
  if (!target || typeof (target as Element).getBoundingClientRect !== 'function')
    return null
  const rect = target.getBoundingClientRect()
  return {
    bottom: roundIfNumber(rect.bottom),
    height: roundIfNumber(rect.height),
    left: roundIfNumber(rect.left),
    right: roundIfNumber(rect.right),
    top: roundIfNumber(rect.top),
    width: roundIfNumber(rect.width),
    x: roundIfNumber(rect.x),
    y: roundIfNumber(rect.y),
  }
}

function styleValue(target: HTMLElement | null | undefined, key: string) {
  if (!target)
    return undefined
  return getComputedStyle(target).getPropertyValue(key)?.trim() || undefined
}

export function snapshotLayoutDebug(extra?: Record<string, unknown>) {
  const root = document.querySelector<HTMLElement>('#root')
  const layout = document.querySelector<HTMLElement>('[data-im-layout-root]')
  const viewerCard = document.querySelector<HTMLElement>('[data-im-viewer-card]')
  const stickyHeader = document.querySelector<HTMLElement>('.ant-card-head')
  const previewImg = document.querySelector<HTMLElement>(
    '.ant-image-preview-root:not([aria-hidden="true"]) .ant-image-preview-img, '
    + '.rc-image-preview-root:not([aria-hidden="true"]) .rc-image-preview-img, '
    + '.ant-image-preview-img, .rc-image-preview-img',
  )

  const rootFontSize = document.documentElement.style.fontSize || styleValue(document.documentElement, 'font-size')

  return {
    bodyRect: rectSnapshot(document.body),
    devicePixelRatio: roundIfNumber(window.devicePixelRatio),
    documentClient: {
      height: document.documentElement.clientHeight,
      width: document.documentElement.clientWidth,
    },
    htmlRect: rectSnapshot(document.documentElement),
    layoutRect: rectSnapshot(layout),
    previewRect: rectSnapshot(previewImg),
    rootFontSize,
    rootRect: rectSnapshot(root),
    rootScroll: root
      ? {
          scrollHeight: root.scrollHeight,
          scrollLeft: root.scrollLeft,
          scrollTop: root.scrollTop,
          scrollWidth: root.scrollWidth,
        }
      : null,
    stickyHeaderRect: rectSnapshot(stickyHeader),
    viewerCardRect: rectSnapshot(viewerCard),
    visibility: document.visibilityState,
    viewport: {
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      outerHeight: window.outerHeight,
      outerWidth: window.outerWidth,
    },
    ...extra,
  }
}

export function logLayoutDebug(message: string, extra?: Record<string, unknown>) {
  vscodeApi.log('debug', message, snapshotLayoutDebug(extra))
}
