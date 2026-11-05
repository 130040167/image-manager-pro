import { Spin } from 'antd'
import { lazy, memo, Suspense, useSyncExternalStore } from 'react'
import { closeEditorSession, getEditorSession, subscribeEditorSession } from './editor-session'

const ImageEditor = lazy(() => import('.'))

function ImageEditorHost() {
  const session = useSyncExternalStore(subscribeEditorSession, getEditorSession, getEditorSession)

  if (!session)
    return null

  return (
    <div className='fixed inset-0 z-[10020] bg-[#111]'>
      <Suspense
        fallback={(
          <div className='flex h-screen w-screen items-center justify-center bg-[#111]'>
            <Spin />
          </div>
        )}
      >
        <ImageEditor {...session} closeEditor={closeEditorSession} />
      </Suspense>
    </div>
  )
}

export default memo(ImageEditorHost)
