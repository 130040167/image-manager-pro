const IMAGE_SELECTOR = '.ant-image-preview-root:not([aria-hidden="true"]) .ant-image-preview-img, .rc-image-preview-root:not([aria-hidden="true"]) .rc-image-preview-img'

/** Read layout only after invalidation, or while the image/its ancestors are animating. */
export function observePreviewLayout(measure: (image: HTMLImageElement | null) => void) {
  let frame = 0
  let disposed = false
  let image: HTMLImageElement | null = null
  let ancestors: Element[] = []
  const resize = new ResizeObserver(() => request())

  function request() {
    if (!disposed && !frame)
      frame = requestAnimationFrame(read)
  }

  function read() {
    frame = 0
    if (disposed)
      return
    const next = document.querySelector<HTMLImageElement>(IMAGE_SELECTOR)
    if (next !== image) {
      resize.disconnect()
      image = next
      ancestors = []
      for (let node: Element | null = image; node; node = node.parentElement) {
        ancestors.push(node)
        resize.observe(node)
      }
    }
    measure(image)
    if (ancestors.some(node => node.getAnimations().some(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity)))
      request()
  }

  const mutations = new MutationObserver((records) => {
    if (records.some(record => record.type === 'childList'
      ? !image?.isConnected || [...record.addedNodes].some(node => node instanceof Element && (node.matches(IMAGE_SELECTOR) || node.querySelector(IMAGE_SELECTOR)))
      : ancestors.includes(record.target as Element))) {
      request()
    }
  })
  mutations.observe(document.body, { attributes: true, attributeFilter: ['style', 'class', 'src', 'aria-hidden'], childList: true, subtree: true })
  const onMotion = (event: Event) => {
    if (ancestors.includes(event.target as Element))
      request()
  }
  const events = ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel', 'load']
  for (const event of events)
    document.addEventListener(event, onMotion, true)
  window.addEventListener('resize', request)
  window.addEventListener('scroll', request, true)
  request()
  return {
    request,
    dispose() {
      disposed = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      for (const event of events)
        document.removeEventListener(event, onMotion, true)
      window.removeEventListener('resize', request)
      window.removeEventListener('scroll', request, true)
    },
  }
}
