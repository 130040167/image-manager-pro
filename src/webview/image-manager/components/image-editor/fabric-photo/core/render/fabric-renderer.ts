import type { FabricObject, TPointerEventInfo } from 'fabric'
import type { BackgroundImage, EditorObject } from '../model/doc'
import type { EditorMode, EditorState, Viewport } from '../state/editor-state'
import type { Controller, ControllerContext } from './controllers/controller'
import type { Renderer } from './renderer'
import { ActiveSelection, Canvas, FabricImage, Point, util } from 'fabric'
import { ZOOM_MAX, ZOOM_MIN } from '../state/editor-state'
import { Transaction } from '../transform/transaction'
import { applyFiltersToImage } from './filters'
import { applyRotateSnap, createFabricObject, getCachedImage, getFpId, preloadImage, updateFabricObject } from './object-factory'

const DEFAULT_CSS_MAX_WIDTH = 700
const DEFAULT_CSS_MAX_HEIGHT = 400
/** 普通小图按真实像素显示；只有极小图才允许有限放大以免画面过小。 */
const TINY_IMAGE_MAX_EDGE = 256
const TINY_IMAGE_MAX_AUTO_SCALE = 2

/**
 * fit 缩放：大图等比放入 fit 盒；普通小图保持真实 1:1，避免“复位”后被放大失真。
 * 极小图允许有限放大，保证其仍然可操作。
 * fit 盒 = min(cssMax, 画布实际尺寸)：cssMax 是「最大显示尺寸」上限，但容器比 cssMax
 * 还窄时（窗口缩窄/侧栏撑开）必须按画布实际尺寸收缩，否则 zoom=1 时图像溢出可见区域。
 * 画布尚未测量（尺寸 ≤ 0，如挂载前）时回退 cssMax。
 * 纯函数以便单测；renderer 内所有 fit 计算（applyViewport / 滚轮不动点换算）共用此口径。
 */
export function computeFitScale(
  cssMaxWidth: number,
  cssMaxHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
): number {
  const fitWidth = canvasWidth > 0 ? Math.min(cssMaxWidth, canvasWidth) : cssMaxWidth
  const fitHeight = canvasHeight > 0 ? Math.min(cssMaxHeight, canvasHeight) : cssMaxHeight
  const fitScale = Math.min(fitWidth / imageWidth, fitHeight / imageHeight)
  const maxEdge = Math.max(imageWidth, imageHeight)
  if (maxEdge <= TINY_IMAGE_MAX_EDGE)
    return Math.min(fitScale, TINY_IMAGE_MAX_AUTO_SCALE)
  return Math.min(fitScale, 1)
}
/** 滚轮缩放停止多久后把整段合并补记一笔历史。 */
const WHEEL_HISTORY_DEBOUNCE_MS = 200

export interface FabricRendererOptions {
  container: HTMLElement
  cssMaxWidth?: number // 默认 700
  cssMaxHeight?: number // 默认 400
}

/**
 * fabric 6 渲染层实现。
 *
 * 渲染模型（架构决策补充 1/2，Figma 模式）：
 * - canvas 元素铺满 container（backstore = CSS = container 的 CSS 像素，1:1）；
 *   灰底由 container 的 CSS 负责
 * - doc 坐标系 = 背景图片像素坐标系；vpt = [s,0,0,s,tx,ty]，
 *   s = fitScale × zoom，tx/ty = 容器中心 − 图片中心 × s + pan；
 *   fitScale 的 fit 盒 = min(cssMax, 画布实际尺寸)，故容器 resize 后 zoom=1 仍完整适配可见区域
 * - 背景图以 center origin 放在 (bg.width/2, bg.height/2) 并带 angle，
 *   其外接框恰为 doc 坐标系的 [0,0,bg.width,bg.height]
 */
export class FabricRenderer implements Renderer {
  private readonly containerEl: HTMLElement
  private cssMaxWidth: number
  private cssMaxHeight: number
  private readonly fabricCanvas: Canvas
  private readonly canvasEl: HTMLCanvasElement
  /** fpId → fabric 对象 */
  private readonly objectMap = new Map<string, FabricObject>()
  /** fpId → 上次同步用的 EditorObject 引用（不可变更新检测） */
  private readonly refMap = new Map<string, EditorObject>()
  private readonly pendingSrcs = new Set<string>()
  private bgRef: BackgroundImage | null | undefined // undefined = 从未同步
  private bgGeneration = 0
  private mode: EditorMode = 'normal'
  private readonly controllers = new Map<EditorMode, Controller>()
  private controllerContext: ControllerContext | undefined
  private activeController: Controller | undefined
  private lastState: EditorState | undefined
  private destroyed = false
  private canvasWidth = 0
  private canvasHeight = 0
  private pixelSampler: CanvasRenderingContext2D | null = null
  displayValueRange: [number, number] = [0, 255]
  /** 一段滚轮缩放开始时的 viewport（用于停止后补记历史）；null = 不在滚轮段中。 */
  private wheelBurstStart: Viewport | null = null
  private wheelFlushTimer: ReturnType<typeof setTimeout> | undefined

  constructor(options: FabricRendererOptions) {
    this.containerEl = options.container
    this.cssMaxWidth = options.cssMaxWidth ?? DEFAULT_CSS_MAX_WIDTH
    this.cssMaxHeight = options.cssMaxHeight ?? DEFAULT_CSS_MAX_HEIGHT
    this.canvasEl = document.createElement('canvas')
    this.containerEl.appendChild(this.canvasEl)
    this.fabricCanvas = new Canvas(this.canvasEl, { enableRetinaScaling: true, imageSmoothingEnabled: true })
    this.fabricCanvas.selection = true
    this.fabricCanvas.on('mouse:wheel', this.onWheel)
    this.syncCanvasSize()
  }

  /** 仅供 controllers 使用（Task 10 起）。 */
  get canvas(): Canvas {
    return this.fabricCanvas
  }

  /** Overlays must leave native selection handles reachable where nodes overlap them. */
  isSelectionControlAtPoint(x: number, y: number): boolean {
    const target = this.fabricCanvas.getActiveObject()
    if (!target?.hasControls)
      return false
    const pointer = new Point(x, y).transform(this.fabricCanvas.viewportTransform)
    return Object.entries(target.oCoords).some(([key, coord]) =>
      target.controls[key]?.shouldActivate(key, target, pointer, coord.corner),
    )
  }

  setDisplayValueRange(range: [number, number]): void {
    this.displayValueRange = range
    const image = this.fabricCanvas.backgroundImage as FabricImage | undefined
    if (image) {
      applyFiltersToImage(image, this.lastState?.doc.background?.filters, range)
      this.fabricCanvas.requestRenderAll()
    }
  }

  /** Read the actual filtered image, so histogram/pixel inspection agree with Fabric's filter backend. */
  getBackgroundImageData(): ImageData | null {
    const image = this.fabricCanvas.backgroundImage as FabricImage | undefined
    if (!image)
      return null
    const element = image.getElement()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context)
      return null
    context.drawImage(element, 0, 0, canvas.width, canvas.height)
    return context.getImageData(0, 0, canvas.width, canvas.height)
  }

  /** Sample the composite at source resolution, independent of viewport zoom and selection UI. */
  getCompositePixel(x: number, y: number): { r: number, g: number, b: number, a: number } | null {
    const image = this.fabricCanvas.backgroundImage as FabricImage | undefined
    if (!image || x < 0 || y < 0 || x >= image.width || y >= image.height)
      return null
    if (!this.pixelSampler) {
      const tile = document.createElement('canvas')
      tile.width = tile.height = 1
      this.pixelSampler = tile.getContext('2d', { willReadFrequently: true })
    }
    const ctx = this.pixelSampler
    if (!ctx)
      return null
    const inverse = util.invertTransform(image.calcTransformMatrix())
    if (!inverse.every(Number.isFinite))
      return null
    const canvas = this.fabricCanvas
    ctx.save()
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, 1, 1)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(image.getElement(), x, y, 1, 1, 0, 0, 1, 1)
      ctx.translate(image.width / 2 - x, image.height / 2 - y)
      ctx.transform(...inverse)
      for (const object of canvas.getObjects()) {
        const id = getFpId(object)
        // Draft tools and crop/selection overlays are not image pixels.
        if (!id || !this.objectMap.has(id) || object.isNotVisible())
          continue
        // Screen caches (especially freehand strokes) are rasterized at viewport
        // zoom. Render native geometry directly without invalidating those caches.
        ctx.save()
        try {
          ctx.globalCompositeOperation = object.globalCompositeOperation
          object.transform(ctx)
          ctx.globalAlpha *= object.getObjectOpacity()
          object.drawObject(ctx, false, {})
        }
        finally {
          ctx.restore()
        }
      }
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      return { r, g, b, a }
    }
    finally {
      ctx.restore()
    }
  }

  /** 按 fpId 取 fabric 对象（保持入参序，未知 id 跳过）；仅内核内部使用（exporter）。 */
  getObjectsByIds(ids: readonly string[]): FabricObject[] {
    const result: FabricObject[] = []
    for (const id of ids) {
      const fObj = this.objectMap.get(id)
      if (fObj !== undefined) {
        result.push(fObj)
      }
    }
    return result
  }

  get container(): HTMLElement {
    return this.containerEl
  }

  get cssMax(): { width: number, height: number } {
    return { width: this.cssMaxWidth, height: this.cssMaxHeight }
  }

  /**
   * resizeCanvasDimension 的 DOM 侧：更新 fit 上限 + container 样式尺寸 + canvas 尺寸。
   * refit（viewport 归位）由 Editor 以事务完成。
   */
  setCssMaxDimension(dimension: { width?: number, height?: number }): void {
    if (dimension.width !== undefined) {
      this.cssMaxWidth = dimension.width
      this.containerEl.style.width = `${dimension.width}px`
    }
    if (dimension.height !== undefined) {
      this.cssMaxHeight = dimension.height
      this.containerEl.style.height = `${dimension.height}px`
    }
    this.syncCanvasSize()
  }

  /** fit 盒 = min(cssMax, 画布实际尺寸) 的等比 fit（见 computeFitScale）；无图返回 1。 */
  fitScale(state: EditorState): number {
    const bg = state.doc.background
    if (bg === null) {
      return 1
    }
    return computeFitScale(this.cssMaxWidth, this.cssMaxHeight, this.canvasWidth, this.canvasHeight, bg.width, bg.height)
  }

  syncState(state: EditorState, prev: EditorState): void {
    if (this.destroyed) {
      return
    }
    this.lastState = state
    this.displayValueRange = state.doc.background?.valueRange ?? [0, 255]
    this.syncCanvasSize()
    if (state.doc.background !== this.bgRef) {
      const previous = this.bgRef
      const next = state.doc.background
      const samePixels = previous != null && next != null && previous.src === next.src
      if (samePixels && this.fabricCanvas.backgroundImage) {
        this.bgRef = next
        this.fabricCanvas.backgroundImage.set({ originX: 'center', originY: 'center', left: next.width / 2, top: next.height / 2, angle: next.angle })
        applyFiltersToImage(this.fabricCanvas.backgroundImage as FabricImage, next.filters, this.displayValueRange)
      }
      else {
        this.syncBackground(state)
      }
    }
    if (state.doc.objects !== prev.doc.objects) {
      this.syncObjects(state)
    }
    this.syncSelection(state)
    this.applyViewport(state)
    this.fabricCanvas.requestRenderAll()
  }

  /**
   * 注册 mode 对应的 controller；若与当前 mode 一致且上下文已注入则立即激活
   * （覆盖初始 mode 'normal' 的 select controller 激活路径）。
   */
  registerController(controller: Controller): void {
    this.controllers.set(controller.mode, controller)
    if (controller.mode === this.mode && this.controllerContext !== undefined && !this.destroyed) {
      controller.activate(this.controllerContext)
      this.activeController = controller
    }
  }

  /** 注入 controller 运行上下文（Editor 接管 renderer 时调用一次）。 */
  setControllerContext(ctx: ControllerContext): void {
    this.controllerContext = ctx
  }

  /** mode 切换：先 deactivate 旧 controller，再切交互开关，最后 activate 新 controller。 */
  setMode(mode: EditorMode, _prevMode: EditorMode): void {
    this.mode = mode
    this.activeController?.deactivate()
    this.activeController = undefined
    const interactive = mode === 'normal'
    this.fabricCanvas.selection = interactive
    if (!interactive) {
      this.fabricCanvas.discardActiveObject()
    }
    for (const [id, fObj] of this.objectMap) {
      this.applyInteractivity(fObj, this.lastState?.getObject(id))
    }
    const next = this.controllers.get(mode)
    if (next !== undefined && this.controllerContext !== undefined) {
      next.activate(this.controllerContext)
      this.activeController = next
    }
    // dispatch 顺序是 syncState → setMode：回到 normal 时把选中态补回来
    if (this.lastState !== undefined) {
      this.syncSelection(this.lastState)
    }
    this.fabricCanvas.requestRenderAll()
  }

  /**
   * 容器尺寸变化后的无状态重排：重读容器尺寸 + 按 lastState 重算 vpt（画布 backstore
   * 随容器 1:1 重设保证清晰不拉伸；fit 盒随画布实际尺寸收缩 → zoom=1 仍完整适配；
   * 居中随新尺寸，zoom/pan 保持，不触碰 state.viewport）+ 请求重绘。
   * 尚未同步过 state 时仅同步尺寸。
   */
  notifyResize(): void {
    if (this.destroyed) {
      return
    }
    this.syncCanvasSize()
    if (this.lastState !== undefined) {
      this.applyViewport(this.lastState)
    }
    this.fabricCanvas.requestRenderAll()
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.activeController?.deactivate()
    this.activeController = undefined
    if (this.wheelFlushTimer !== undefined) {
      clearTimeout(this.wheelFlushTimer)
      this.wheelFlushTimer = undefined
    }
    this.wheelBurstStart = null
    this.bgGeneration++ // 使进行中的背景加载失效
    this.fabricCanvas.destroy()
    this.canvasEl.remove()
    this.objectMap.clear()
    this.refMap.clear()
    this.pendingSrcs.clear()
    this.pixelSampler = null
  }

  // —— 内部 ——

  /** canvas 铺满 container；尺寸变化时同步 backstore 与 CSS（1:1）。 */
  private syncCanvasSize(): void {
    const width = this.containerEl.clientWidth
    const height = this.containerEl.clientHeight
    if (width <= 0 || height <= 0) {
      return
    }
    if (width === this.canvasWidth && height === this.canvasHeight) {
      return
    }
    this.canvasWidth = width
    this.canvasHeight = height
    this.fabricCanvas.setDimensions({ width, height })
  }

  private syncBackground(state: EditorState): void {
    const bg = state.doc.background
    this.bgRef = bg
    const generation = ++this.bgGeneration
    if (bg === null) {
      this.fabricCanvas.backgroundImage = undefined
      return
    }
    void preloadImage(bg.src)
      .then((imgEl) => {
        if (this.destroyed || generation !== this.bgGeneration) {
          return
        }
        // 背景和标注共享文档中心；0° 时源像素边界仍从 (0,0) 开始。
        const img = new FabricImage(imgEl, {
          originX: 'center',
          originY: 'center',
          left: bg.width / 2,
          top: bg.height / 2,
          angle: bg.angle,
          imageSmoothing: this.fabricCanvas.imageSmoothingEnabled,
          objectCaching: false,
        })
        applyFiltersToImage(img, bg.filters, this.displayValueRange)
        this.fabricCanvas.backgroundImage = img
        this.fabricCanvas.requestRenderAll()
      })
      .catch(() => {
        // 加载失败静默跳过；错误通道由 Task 9 图片加载流程统一处理
      })
  }

  private syncObjects(state: EditorState): void {
    const canvas = this.fabricCanvas
    const seen = new Set<string>()
    for (const obj of state.doc.objects) {
      seen.add(obj.id)
      const fObj = this.objectMap.get(obj.id)
      if (fObj === undefined) {
        if (obj.kind === 'image' && getCachedImage(obj.src) === undefined) {
          this.ensureImageAndRefresh(obj.src)
          continue // 加载完成后统一补齐
        }
        const created = createFabricObject(obj)
        this.applyInteractivity(created, obj)
        canvas.add(created)
        this.objectMap.set(obj.id, created)
        this.refMap.set(obj.id, obj)
      }
      else if (this.refMap.get(obj.id) !== obj) {
        if (obj.kind === 'image' && getCachedImage(obj.src) === undefined) {
          this.ensureImageAndRefresh(obj.src)
          continue
        }
        updateFabricObject(fObj, obj)
        // locked/hidden 变化经 UpdateObject 走更新路径，需重算可交互性
        this.applyInteractivity(fObj, obj)
        this.refMap.set(obj.id, obj)
      }
    }
    // state 无 canvas 有 → 移除
    for (const [id, fObj] of [...this.objectMap]) {
      if (!seen.has(id)) {
        canvas.remove(fObj)
        this.objectMap.delete(id)
        this.refMap.delete(id)
      }
    }
    // z 序 = state.doc.objects 数组序
    state.doc.objects.forEach((obj, index) => {
      const fObj = this.objectMap.get(obj.id)
      if (fObj !== undefined) {
        canvas.moveObjectTo(fObj, index)
      }
    })
  }

  /** 图片 src 未入缓存时异步加载，完成后基于 lastState 重同步。 */
  private ensureImageAndRefresh(src: string): void {
    if (this.pendingSrcs.has(src)) {
      return
    }
    this.pendingSrcs.add(src)
    void preloadImage(src)
      .then(() => {
        this.pendingSrcs.delete(src)
        if (this.destroyed || this.lastState === undefined) {
          return
        }
        this.syncObjects(this.lastState)
        this.syncSelection(this.lastState)
        this.applyViewport(this.lastState)
        this.fabricCanvas.requestRenderAll()
      })
      .catch(() => {
        this.pendingSrcs.delete(src)
      })
  }

  private syncSelection(state: EditorState): void {
    const canvas = this.fabricCanvas
    // 非 normal 模式不呈现选中态（selection 数据仍保留在 state 里）
    const targets: FabricObject[] = []
    if (this.mode === 'normal') {
      for (const id of state.selection) {
        // locked/hidden 对象不呈现画布选中态（面板选中仅存在于 state.selection）
        const obj = state.getObject(id)
        if (obj === undefined || obj.locked === true || obj.hidden === true) {
          continue
        }
        const fObj = this.objectMap.get(id)
        if (fObj !== undefined) {
          targets.push(fObj)
        }
      }
    }
    // fpInternal 标记的渲染层内部对象（cropzone）不参与选中态同步：
    // 非 normal 模式 targets 恒为空，不豁免会被 discardActiveObject 打掉激活态
    const current = canvas
      .getActiveObjects()
      .filter(fObj => (fObj as Partial<{ fpInternal: string }>).fpInternal === undefined)
    // 按集合比较：ActiveSelection 成员序与 state.selection 序可能不同，避免反复重建
    if (current.length === targets.length && current.every(fObj => targets.includes(fObj))) {
      return
    }
    if (targets.length === 0) {
      canvas.discardActiveObject()
    }
    else if (targets.length === 1) {
      canvas.setActiveObject(targets[0])
    }
    else {
      // 多选旋转同样享受 Shift 15° 吸附（ActiveSelection 是独立实例，controls 不共享）
      const activeSelection = new ActiveSelection(targets, { canvas })
      applyRotateSnap(activeSelection)
      canvas.setActiveObject(activeSelection)
    }
  }

  /** vpt = [s,0,0,s,tx,ty]；s = fitScale × zoom；tx/ty = 容器居中 + pan。 */
  private applyViewport(state: EditorState): void {
    if (this.canvasWidth <= 0 || this.canvasHeight <= 0) {
      return
    }
    const { s, tx, ty } = this.viewportParams(state)
    // Smooth normal viewing, but use nearest-neighbour before pixels are large
    // enough for the inspector grid. Geometry and source sampling stay unchanged.
    const smooth = s < 4
    this.fabricCanvas.imageSmoothingEnabled = smooth
    this.fabricCanvas.getContext().imageSmoothingQuality = 'high'
    const background = this.fabricCanvas.backgroundImage
    if (background instanceof FabricImage)
      background.imageSmoothing = smooth
    for (const object of this.objectMap.values()) {
      if (object instanceof FabricImage)
        object.imageSmoothing = smooth
    }
    this.fabricCanvas.setViewportTransform([s, 0, 0, s, tx, ty])
  }

  /**
   * 由 state 计算 vpt 参数（applyViewport 与滚轮不动点换算共用，保证同一公式）。
   * 无图语义：fit = 1，以容器中心为原点，避免清背景后残留旧 vpt。
   */
  private viewportParams(state: EditorState): { s: number, tx: number, ty: number } {
    const bg = state.doc.background
    if (bg === null) {
      const s = state.viewport.zoom
      return {
        s,
        tx: this.canvasWidth / 2 + state.viewport.panX,
        ty: this.canvasHeight / 2 + state.viewport.panY,
      }
    }
    const s = this.fitScale(state) * state.viewport.zoom
    return {
      s,
      tx: this.canvasWidth / 2 - (bg.width / 2) * s + state.viewport.panX,
      ty: this.canvasHeight / 2 - (bg.height / 2) * s + state.viewport.panY,
    }
  }

  /**
   * 滚轮缩放：以指针为不动点解析计算新 pan（state 是事实源，不借 canvas.zoomToPoint 改画布）。
   * 滚动中以 addToHistory:false 连续更新；停止 200ms 后 flushWheelHistory 补记一笔历史。
   */
  private readonly onWheel = (event: TPointerEventInfo<WheelEvent>): void => {
    const ctx = this.controllerContext
    if (this.destroyed || ctx === undefined || this.canvasWidth <= 0 || this.canvasHeight <= 0) {
      return
    }
    event.e.preventDefault()
    const state = ctx.getState()
    this.wheelBurstStart ??= { ...state.viewport }
    const oldZoom = state.viewport.zoom
    const zoom = this.steppedZoom(oldZoom, event.e.deltaY)
    if (zoom !== oldZoom) {
      const pan = this.panForPointerZoom(state, zoom, event.viewportPoint.x, event.viewportPoint.y)
      ctx.dispatch(
        new Transaction(state).setViewport({ zoom, panX: pan.panX, panY: pan.panY }).setMeta('addToHistory', false),
      )
    }
    this.scheduleWheelFlush()
  }

  /**
   * 指针不动点换算：doc 点 d = (p − t)/s 在缩放前后应映射到同一指针位置 p，
   * 即 t' = p − d·s'；pan' = t' − 居中项。返回新 panX/panY。
   */
  zoomAtPointer(zoom: number, pointerX: number, pointerY: number): void {
    const ctx = this.controllerContext
    if (ctx === undefined || this.destroyed)
      return
    const state = ctx.getState()
    const nextZoom = Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX)
    if (nextZoom === state.viewport.zoom)
      return
    const pan = this.panForPointerZoom(state, nextZoom, pointerX, pointerY)
    ctx.dispatch(new Transaction(state).setViewport({ zoom: nextZoom, panX: pan.panX, panY: pan.panY }))
  }

  /** Ctrl+滚轮按现有编辑器档位跳一档，而不是连续乘一个很小的系数。 */
  private steppedZoom(currentZoom: number, deltaY: number): number {
    const currentPercent = currentZoom * 100
    const ladder = [10, 25, 40, 50, 60, 72, 86, 100, 125, 150, 195, 200, 280, 400, 640, 800, 1440, 1600, 2240, 2880, 3200, 4000, 5000]
    const direction = deltaY < 0 ? 1 : -1
    const eps = 0.5
    let next = currentPercent
    if (direction === 1) {
      next = ladder.find(value => value > currentPercent + eps) ?? ladder[ladder.length - 1]
    }
    else {
      for (let index = ladder.length - 1; index >= 0; index--) {
        if (ladder[index] < currentPercent - eps) {
          next = ladder[index]
          break
        }
      }
      if (next === currentPercent)
        next = ladder[0]
    }
    return Math.min(Math.max(next / 100, ZOOM_MIN), ZOOM_MAX)
  }

  private panForPointerZoom(
    state: EditorState,
    newZoom: number,
    pointerX: number,
    pointerY: number,
  ): { panX: number, panY: number } {
    const cur = this.viewportParams(state)
    const docX = (pointerX - cur.tx) / cur.s
    const docY = (pointerY - cur.ty) / cur.s
    const bg = state.doc.background
    const sNew = (bg === null ? 1 : this.fitScale(state)) * newZoom
    const baseTx = bg === null ? this.canvasWidth / 2 : this.canvasWidth / 2 - (bg.width / 2) * sNew
    const baseTy = bg === null ? this.canvasHeight / 2 : this.canvasHeight / 2 - (bg.height / 2) * sNew
    return { panX: pointerX - docX * sNew - baseTx, panY: pointerY - docY * sNew - baseTy }
  }

  private scheduleWheelFlush(): void {
    if (this.wheelFlushTimer !== undefined) {
      clearTimeout(this.wheelFlushTimer)
    }
    this.wheelFlushTimer = setTimeout(() => {
      this.flushWheelHistory()
    }, WHEEL_HISTORY_DEBOUNCE_MS)
  }

  /**
   * 滚轮段结束补记历史：先瞬态回到段起点（addToHistory:false），再以带历史事务走到终点，
   * 使这一段滚轮缩放恰好产生一笔历史（before = 段起点，after = 最终值），undo 一次整体回退。
   */
  private flushWheelHistory(): void {
    this.wheelFlushTimer = undefined
    const start = this.wheelBurstStart
    this.wheelBurstStart = null
    const ctx = this.controllerContext
    if (start === null || ctx === undefined || this.destroyed) {
      return
    }
    const finalViewport = ctx.getState().viewport
    if (
      finalViewport.zoom === start.zoom
      && finalViewport.panX === start.panX
      && finalViewport.panY === start.panY
    ) {
      return
    }
    ctx.dispatch(new Transaction(ctx.getState()).setViewport(start).setMeta('addToHistory', false))
    ctx.dispatch(new Transaction(ctx.getState()).setViewport(finalViewport))
  }

  /**
   * 可交互性投影：normal 模式且对象未锁定、未隐藏时才 selectable/evented。
   * locked/hidden 对象因此不可点选、不可拖拽/缩放/旋转，也不计入框选
   * （fabric 框选只命中 selectable 对象）。
   */
  private applyInteractivity(fObj: FabricObject, obj?: EditorObject): void {
    const interactive = this.mode === 'normal' && obj?.locked !== true && obj?.hidden !== true
    fObj.set({ selectable: interactive, evented: interactive })
  }
}
