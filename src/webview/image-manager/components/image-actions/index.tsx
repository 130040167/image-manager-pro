import { memo, useEffect } from 'react'
import { preloadImageFilter } from '../../hooks/use-image-filter/use-image-filter'
import { preloadImageSearch } from '../../hooks/use-image-search/use-image-search'
import Filter from './components/filter'
import HideEmptyDirs from './components/hide-empty-dirs'
import More from './components/more'
import Refresh from './components/refresh'
import Search from './components/search'

function ImageActions() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      preloadImageFilter()
      preloadImageSearch()
    }, 500)
    return () => {
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <div className='flex items-center gap-x-2'>
      {/* Filter */}
      <Filter />
      {/* Hide known empty folders */}
      <HideEmptyDirs />
      {/* Refresh images */}
      <Refresh />
      {/* Search */}
      <Search />
      {/* Action */}
      <More />
    </div>
  )
}

export default memo(ImageActions)
