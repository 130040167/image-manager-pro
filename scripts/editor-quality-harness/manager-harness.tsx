import { getDefaultStore } from 'jotai'
import { useMemo, useState } from 'react'
import { CmdToVscode } from '../../src/message/cmd'
import { Compressed } from '../../src/meta'
import ImageGroup from '../../src/webview/image-manager/components/image-group'
import useImageOperation from '../../src/webview/image-manager/hooks/use-image-operation'
import { GlobalAtoms } from '../../src/webview/image-manager/stores/global/global-store'
import { vscodeApi } from '../../src/webview/vscode-api'

const store = getDefaultStore()
store.set(GlobalAtoms.viewerPageSizeAtom, 10_000)
store.set(GlobalAtoms.viewportStabilityAtom, { ...store.get(GlobalAtoms.viewportStabilityAtom), stable: true })
store.set(GlobalAtoms.imagePlaceholderSizeAtom, { width: 140, height: 165 })
const searches: any[] = []
const cancellations: string[] = []
Object.assign(window, { __managerSearches: searches, __managerCancellations: cancellations, __managerMeasure: () => {
  const item = document.querySelector('[data-image-grid-item]')!.getBoundingClientRect()
  store.set(GlobalAtoms.imagePlaceholderSizeAtom, { width: item.width, height: item.height })
} })
vscodeApi.log = () => {}
vscodeApi.postMessage = ((message: any, reply: any) => {
  if (message.cmd === CmdToVscode.find_similar_images) {
    searches.push({ ...message.data, reply })
  }
  else if (message.cmd === CmdToVscode.cancel_find_similar_images) {
    cancellations.push(message.data.requestId)
  }
  else if (message.cmd === CmdToVscode.save_edited_image) {
    ;(window as any).__savedImage = message.data
    reply?.({ filename: 'test.png', path: 'C:/quality/test.png' })
  }
}) as typeof vscodeApi.postMessage

export function ManagerHarness({ src, similarity }: { src: string, similarity: boolean }) {
  const [count, setCount] = useState(20)
  const [selected, setSelected] = useState<ImageType[]>([])
  const { beginFindSimilarProcess } = useImageOperation()
  const images = useMemo(() => Array.from({ length: 10_000 }, (_, i) => ({
    absDirPath: 'C:/quality',
    absWorkspaceFolder: 'C:/',
    basename: `pattern-${i}.png`,
    dirPath: 'quality',
    extname: 'png',
    info: { compressed: Compressed.unknown, gitStaged: false, metadata: { width: 8, height: 6 } },
    key: `image-${i}`,
    name: `pattern-${i}`,
    path: `C:/quality/pattern-${i}.png`,
    relativePath: `quality/pattern-${i}.png`,
    stats: { size: 1000, mtimeMs: 1 },
    vscodePath: `${src}#${i}`,
    workspaceFolder: 'quality',
  })) as ImageType[], [src])
  return (
    <>
      <div className='sticky top-0 z-10 bg-white' data-manager-stats data-selected={selected.length}>
        <button type='button' data-manager-large onClick={() => setCount(10_000)}>10,000</button>
        <button type='button' data-manager-small onClick={() => setCount(20)}>20</button>
        <button type='button' data-manager-reveal onClick={() => store.set(GlobalAtoms.imageRevealAtom, images[8765].path)}>reveal</button>
        <button type='button' data-manager-search onClick={() => void beginFindSimilarProcess(images[0], images, { algorithm: 'dhash' })}>search</button>
      </div>
      {!similarity && <ImageGroup images={images.slice(0, count)} enableMultipleSelect selectedImages={selected} onSelectedImagesChange={setSelected} lazyImageProps={{ lazy: false }} inViewer />}
    </>
  )
}
