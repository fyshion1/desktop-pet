const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '..')
function excluded(name) {
 return /\.(vrm|fbx|glb|gltf|moc3|model3\.json|motion3\.json|exp3\.json)$/i.test(name)
  || /(^|\/)(models|vendor|CubismSamples)\//i.test(name)
  || /live2dcubismcore/i.test(path.basename(name))
}
test('tracked plugin source does not bundle character models or proprietary Core', () => {
 const files = execFileSync('git', ['ls-files', '-z', '--', '.'], {cwd:root}).toString().split('\0').filter(Boolean)
 assert.deepEqual(files.filter(excluded), [])
})
test('built plugin has no model payloads or proprietary Core', t => {
 const dist = path.join(root, 'dist')
 if (!fs.existsSync(dist)) return t.skip('build output not present')
 function files(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory() ? files(path.join(dir,e.name)) : [path.join(dir,e.name)]) }
 assert.deepEqual(files(dist).filter(excluded), [])
})
