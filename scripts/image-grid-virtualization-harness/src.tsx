import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getInclusiveIndexRange, IMAGE_GRID_GAP } from '../../src/webview/image-manager/components/image-group/row-virtualizer'
import useRowVirtualizer from '../../src/webview/image-manager/components/image-group/use-row-virtualizer'

const ITEM_COUNT = 10_000
const ITEM_HEIGHT = 110
const ITEM_WIDTH = 110
const harnessStart = performance.now()

function Harness() {
  const [virtualized, setVirtualized] = useState(false)
  const [anchor, setAnchor] = useState<number | null>(null)
  const [selectedCount, setSelectedCount] = useState(0)
  const [previewIndex, setPreviewIndex] = useState(-1)
  const [list, setList] = useState<HTMLDivElement | null>(null)
  const virtualizeStartRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const items = Array.from({ length: ITEM_COUNT }, (_, index) => index)
  const grid = useRowVirtualizer({
    container: scrollRef.current || document.documentElement,
    enabled: virtualized,
    itemCount: ITEM_COUNT,
    itemHeight: ITEM_HEIGHT,
    itemWidth: ITEM_WIDTH,
    list,
  })
  const rendered = virtualized ? items.slice(grid.startIndex, grid.endIndex) : items
  useEffect(() => {
    const stats = document.querySelector<HTMLElement>('#stats')
    if (!stats)
      return
    if (virtualized)
      stats.dataset.virtualizeMs = String(performance.now() - virtualizeStartRef.current)
    else
      stats.dataset.baselineMs = String(performance.now() - harnessStart)
  }, [virtualized])

  return (
    <main>
      <div id='stats' data-count={rendered.length} data-preview={previewIndex} data-selected={selectedCount} data-window={`${grid.startIndex}:${grid.endIndex}`}>
        {virtualized ? 'virtual' : 'baseline'}
      </div>
      <button
        id='toggle'
        onClick={() => {
          virtualizeStartRef.current = performance.now()
          setVirtualized(value => !value)
        }}
      >
        toggle
      </button>
      <button id='locate' onClick={() => grid.scrollToIndex(8_765)}>locate 8765</button>
      <div id='viewport' ref={scrollRef}>
        <div id='grid' ref={setList} style={{ height: virtualized ? grid.totalHeight : undefined, position: virtualized ? 'relative' : undefined }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: IMAGE_GRID_GAP, left: 0, position: virtualized ? 'absolute' : 'static', top: 0, transform: virtualized ? `translateY(${grid.offsetTop}px)` : undefined, width: '100%' }}>
            {rendered.map(index => (
              <button
                className='item'
                data-index={index}
                key={index}
                onClick={(event) => {
                  setPreviewIndex(index)
                  if (event.shiftKey && anchor !== null) {
                    setSelectedCount(getInclusiveIndexRange(anchor, index).length)
                  }
                  else {
                    setAnchor(index)
                    setSelectedCount(1)
                  }
                }}
              >
                {index}
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}

const style = document.createElement('style')
style.textContent = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: sans-serif; }
  main { width: 1000px; }
  #stats, #toggle, #locate { height: 30px; }
  #viewport { height: 700px; overflow: auto; width: 1000px; }
  #grid { width: 100%; }
  .item { flex: 0 0 ${ITEM_WIDTH}px; height: ${ITEM_HEIGHT}px; }
`
document.head.appendChild(style)
createRoot(document.getElementById('root')!).render(<Harness />)
