import { expect, test } from 'vite-plus/test'
import { type Item, buildLibrary } from './library'
import { candidates } from './search'

const item = (i: number): Item => ({
  id: `i${i}`,
  note: false,
  name: `photo-${i}`,
  project: null,
  group: null,
  tags: [],
  moved: 0,
  hue: 0,
  sat: 0,
  ratio: 1,
  ext: 'png',
  memo: '',
})

test('同じ拡張子が 1 万件あっても、種類の候補を 100ms 以内に作る', () => {
  const lib = buildLibrary(
    Array.from({ length: 10_000 }, (_, i) => item(i)),
    [],
    new Date(),
  )
  const started = performance.now()
  const found = candidates(lib, { kind: 'ext', text: 'png', raw: '.png', at: 0 }, [])
  const took = performance.now() - started
  expect(found.map((c) => c.n)).toEqual([10_000])
  expect(took).toBeLessThan(100)
})
