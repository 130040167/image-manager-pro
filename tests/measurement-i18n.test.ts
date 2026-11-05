import type { PathObject } from '~/webview/image-manager/components/image-editor/fabric-photo/core/model/doc'
import i18next from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import { measurementCanvasLabelLayouts, measurementDisplayName, measurementLabelSettings, measurementValueDetails } from '~/webview/image-manager/components/image-editor/measurement-label'

function measurement(): PathObject {
  return {
    id: 'i18n-measurement',
    kind: 'path',
    tool: 'measurement',
    path: '',
    left: 0,
    top: 0,
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    stroke: '#000000',
    strokeWidth: 1,
    fill: '',
    measurementKind: 'polygon',
    measurementName: '测量-多边形1',
    measurementPoints: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }],
  }
}

beforeAll(async () => {
  await i18next.init({
    lng: 'en',
    resources: {
      'en': {
        translation: {
          im: {
            editor: {
              '测量-多边形{{index}}': 'Measurement-Polygon {{index}}',
              '周长': 'Perimeter',
              '面积': 'Area',
            },
          },
        },
      },
      'zh-CN': { translation: {} },
    },
  })
})

describe('measurement translations', () => {
  it('changes default labels with language while keeping metric geometry and stored names stable', async () => {
    await i18next.changeLanguage('en')
    const object = measurement()
    object.measurementLabel = { ...measurementLabelSettings(object), visible: true, content: 'both' }
    expect(measurementDisplayName(object)).toBe('Measurement-Polygon 1')
    expect(measurementValueDetails(object).map(row => row.label)).toEqual(['Perimeter', 'Area'])
    expect(measurementCanvasLabelLayouts(object).map(box => [box.kind, box.lines])).toEqual([
      ['perimeter', ['Perimeter', '120.00']],
      ['area', ['Area', '600.00']],
    ])
    await i18next.changeLanguage('zh-CN')
    expect(measurementDisplayName(object)).toBe('测量-多边形1')
    expect(measurementCanvasLabelLayouts(object).map(box => box.lines[0])).toEqual(['周长', '面积'])
    expect(object.measurementName).toBe('测量-多边形1')
  })

  it('preserves custom measurement and metric names across languages', async () => {
    await i18next.changeLanguage('en')
    const object = measurement()
    object.measurementLabel = {
      ...measurementLabelSettings(object),
      visible: true,
      content: 'both',
      nameMode: 'custom',
      customName: '自定义边界',
      metricLabels: { perimeter: { nameMode: 'custom', customName: '自定义周长' } },
    }
    expect(measurementDisplayName(object)).toBe('自定义边界')
    expect(measurementCanvasLabelLayouts(object)[0].lines[0]).toBe('自定义周长')
    object.measurementName = 'Sample boundary'
    object.measurementLabel.nameMode = 'default'
    expect(measurementDisplayName(object)).toBe('Sample boundary')
  })
})
