/** A later request replaces the current scan only in its own panel. */
export class SimilarityRequests {
  private active = new Map<string, { controller: AbortController, requestId: string }>()

  start(panel: string, requestId: string) {
    this.cancel(panel)
    const controller = new AbortController()
    this.active.set(panel, { controller, requestId })
    return controller
  }

  cancel(panel: string, requestId?: string) {
    const current = this.active.get(panel)
    if (!current || (requestId && current.requestId !== requestId))
      return false
    current.controller.abort('Similarity search cancelled')
    this.active.delete(panel)
    return true
  }

  finish(panel: string, controller: AbortController) {
    if (this.active.get(panel)?.controller === controller)
      this.active.delete(panel)
  }
}
