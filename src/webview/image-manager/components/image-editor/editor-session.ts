import type { Props as ImageEditorProps } from '.'

type EditorSession = Omit<ImageEditorProps, 'closeEditor'>

type Listener = () => void

let session: EditorSession | null = null
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach(listener => listener())
}

export function getEditorSession() {
  return session
}

export function openEditorSession(next: EditorSession) {
  session = next
  emit()
}

export function closeEditorSession() {
  if (!session)
    return
  session = null
  emit()
}

export function subscribeEditorSession(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
