import { openEditorSession } from '../../components/image-editor/editor-session'

type ImageEditorModule = typeof import('../../components/image-editor')

let imageEditorPromise: Promise<ImageEditorModule> | undefined

function loadImageEditor() {
  imageEditorPromise ||= import('../../components/image-editor')
  return imageEditorPromise
}

export function preloadImageEditor() {
  return loadImageEditor()
}

export default function useImageCropper() {
  return {
    showImageCropper: (props: { defaultTool?: 'crop' | 'select', image: ImageType | undefined }) => {
      void preloadImageEditor()
      openEditorSession({ ...props, defaultTool: props.defaultTool || 'crop' })
    },
  }
}
