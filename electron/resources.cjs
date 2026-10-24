const path = require('node:path')
const fs = require('node:fs')

// Only packaged UI and an explicitly supplied Cubism Core are exposed. Models use the user registry.
function resourcePath(urlPath, root, assetRoot, vendorRoot) {
  let decoded
  try { decoded = decodeURIComponent(urlPath) } catch { return null }
  let base = root, relative = decoded.replace(/^\/+/, '') || 'index.html'
  if (decoded.startsWith('/assets/live2d/') || decoded.startsWith('/assets/models/')) return null
  if (decoded.startsWith('/vendor/')) {
    if (decoded !== '/vendor/live2dcubismcore.min.js') return null
    base = vendorRoot; relative = 'live2dcubismcore.min.js'
  } else if (decoded.startsWith('/api/')) return null
  const resolved = path.resolve(base, relative)
  const rel = path.relative(base, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  try {
    const real = fs.realpathSync(resolved), realBase = fs.realpathSync(base)
    const check = path.relative(realBase, real)
    return !check.startsWith('..') && !path.isAbsolute(check) && fs.statSync(real).isFile() ? real : null
  } catch { return null }
}
module.exports = { resourcePath }
