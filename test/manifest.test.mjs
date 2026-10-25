import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const manifest = JSON.parse(read('package.json'))

test('the manifest is installable as a DSH bundle', () => {
  assert.equal(manifest.name, 'dsh-peak-hours')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, 'lib/index.js')
  assert.equal(manifest.exports['./client'].default, './lib/client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  // The badge reads the composer's model directory, owned by the model selector.
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-model-selection',
  ])

  for (const path of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
    assert.ok(existsSync(resolve(root, path)), `${path} exists`)
  }
})

test('the bundle patch inserts the plugin row', () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /id: peak-hours/)
  assert.match(patch, /name: dsh-peak-hours/)
})

test('the client bundle registers under the package name', () => {
  const client = read('lib/client.js')
  assert.match(client, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(client, /id: 'dsh-peak-hours'/)
  assert.match(client, /name: 'conversation\.input\.right'/)
})

test('the package has no runtime dependencies', () => {
  assert.equal(manifest.dependencies, undefined)
  assert.equal(manifest.peerDependencies, undefined)
})

test('every README image points at a shipped asset', () => {
  const readme = read('README.md')
  const sources = [...readme.matchAll(/src="(assets\/[^"]+)"/g)].map((match) => match[1])
  assert.ok(sources.includes('assets/banner.png'))
  assert.ok(sources.includes('assets/preview-dark.png'))
  for (const source of sources) {
    assert.ok(existsSync(resolve(root, source)), `${source} exists`)
  }
})
