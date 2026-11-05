import { Button, Tooltip } from 'antd'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { VscFolderActive, VscFolderOpened } from 'react-icons/vsc'
import { useHideKnownEmptyDirs } from '~/webview/image-manager/stores/settings/hooks'

function HideEmptyDirs() {
  const { t } = useTranslation()
  const [hideKnownEmptyDirs, setHideKnownEmptyDirs] = useHideKnownEmptyDirs()

  return (
    <Tooltip title={t('im.hide_known_empty_dirs')} arrow={false} placement='bottom'>
      <Button
        type={hideKnownEmptyDirs ? 'primary' : 'text'}
        icon={(
          <div className='flex items-center text-xl'>
            {hideKnownEmptyDirs ? <VscFolderActive /> : <VscFolderOpened />}
          </div>
        )}
        onClick={() => {
          setHideKnownEmptyDirs(!hideKnownEmptyDirs)
        }}
      />
    </Tooltip>
  )
}

export default memo(HideEmptyDirs)
