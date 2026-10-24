const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { resourcePath } = require('../electron/resources.cjs')

test('only packaged UI and user-supplied Core are readable; model roots are not exposed', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-resource-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const root = path.join(temp, 'dist'), assets = path.join(temp, 'assets'), vendor = path.join(temp, 'vendor')
  for (const name of ['dist/index.html', 'dist/assets/ui.js', 'assets/models/vrm/model.vrm', 'assets/live2d/model.model3.json', 'vendor/live2dcubismcore.min.js', 'secret.txt']) {
    const file = path.join(temp, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'test')
  }
  const resolve = p => resourcePath(p, root, assets, vendor)
  for (const p of ['/assets/models/vrm/model.vrm', '/assets/live2d/model.model3.json']) assert.equal(resolve(p), null)
  for (const p of ['/index.html', '/assets/ui.js', '/vendor/live2dcubismcore.min.js']) assert.ok(resolve(p), p)
  for (const p of ['/../secret.txt', '/%2e%2e%5csecret.txt', '/%2e%2e/secret.txt', '/assets/live2d/Other/model.json', '/assets/live2d/model/../../../../secret.txt', '/vendor/../secret.txt', '/api/settings', '/%E0%A4%A']) assert.equal(resolve(p), null, p)
})
