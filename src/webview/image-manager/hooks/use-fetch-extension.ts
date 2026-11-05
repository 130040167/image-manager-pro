import { useAsyncEffect } from 'ahooks'
import { useSetAtom } from 'jotai'
import { name, publisher } from '~root/package.json'
import logger from '~/utils/logger'
import { GlobalAtoms } from '../stores/global/global-store'

async function getExtensionLatestVersion(extensionName: string) {
  const url = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery'
  const body = {
    filters: [
      {
        criteria: [{ filterType: 7, value: extensionName }],
      },
    ],
    flags: 103,
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json;api-version=6.1-preview.1',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch extension info: ${response.statusText}`)
  }

  const data = await response.json()
  const extension = data.results[0]?.extensions[0]
  if (!extension) {
    throw new Error('Extension not found')
  }

  return extension as {
    publisher: {
      publisherName: string
    }
    versions: {
      version: string
    }[]
  }
}

/**
 * 获取插件信息
 */
export default function useFetchExtension(enabled = true) {
  const setExtLastetInfo = useSetAtom(GlobalAtoms.extLatestInfoAtom)
  useAsyncEffect(async () => {
    if (!enabled) {
      logger.debug('skip extension marketplace fetch: directory-only debug mode')
      return
    }
    try {
      const ext = await getExtensionLatestVersion(`${publisher}.${name}`)
      logger.debug(
        {
          author: ext.publisher.publisherName,
          version: ext.versions[0].version,
        },
        'ext info',
      )
      setExtLastetInfo({
        author: ext.publisher.publisherName,
        version: ext.versions[0].version,
      })
    }
    catch {}
  }, [])
}
