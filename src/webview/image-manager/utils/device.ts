const platform = typeof navigator === 'undefined'
  ? ''
  : navigator.platform || navigator.userAgent
const isMac = /Mac|iPhone|iPad|iPod/i.test(platform)

export const OS = {
  isMac,
  isWindows: !isMac,
}
