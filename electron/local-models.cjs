const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
let catalogPath = process.env.PET_MODEL_CATALOG || null
function setCatalogPath(file) { catalogPath = file }
function catalog() {
  if (!catalogPath) return { models: [], selected: '' }
  try {
    const data = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
    if (!Array.isArray(data.models)) throw new Error('本地模型目录格式无效')
    return data
  } catch (error) {
    if (error.code === 'ENOENT') return { models: [], selected: '' }
    throw error
  }
}
function save(data) {
  if (!catalogPath) throw new Error('本地模型目录未初始化')
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true })
  const temporary = catalogPath + '.' + crypto.randomUUID() + '.tmp'
  try { fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 }); fs.renameSync(temporary, catalogPath) }
  finally { fs.rmSync(temporary, { force: true }) }
}
function registerModel(file) {
  const resolved = fs.realpathSync(file)
  if (!fs.statSync(resolved).isFile()) throw new Error('请选择模型文件')
  const kind = /\.model3\.json$/i.test(resolved) ? 'live2d' : /\.vrm$/i.test(resolved) ? 'vrm' : null
  if (!kind) throw new Error('请选择 .model3.json 或 .vrm 文件')
  if (kind === 'live2d') {
    const manifest = JSON.parse(fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, ''))
    if (typeof manifest.FileReferences?.Moc !== 'string' || !Array.isArray(manifest.FileReferences.Textures)) throw new Error('Live2D 模型清单缺少 Moc 或 Textures')
    const refs = manifest.FileReferences
    const files = [refs.Moc, ...refs.Textures, refs.Physics, refs.Pose, refs.UserData, refs.DisplayInfo,
      ...(refs.Expressions || []).map(e => e.File),
      ...Object.values(refs.Motions || {}).flat().flatMap(m => [m.File, m.Sound])].filter(v => v != null)
    const base = path.dirname(resolved)
    for (const relative of files) {
      if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => p === '..' || p.includes(':'))) throw new Error('模型只能引用所在目录内的本地文件')
      const target = fs.realpathSync(path.resolve(base, relative)), rel = path.relative(base, target)
      if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.statSync(target).isFile()) throw new Error('模型引用的文件超出模型目录')
    }

  }
  const id = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 24)
  const data = catalog()
  const row = { id, kind, file: resolved, name: path.basename(resolved).replace(/\.model3\.json$|\.vrm$/i, '') }
  data.models = [...data.models.filter(m => m.id !== id), row]
  data.selected = id
  save(data)
  return id
}
function modelLocation(key) {
  const row = catalog().models.find(m => m.id === key && /^[a-f0-9]{24}$/.test(m.id))
  if (!row || typeof row.file !== 'string') return null
  return { folder: path.dirname(row.file), filename: path.basename(row.file), kind: row.kind, name: row.name }
}
function listModels() {
  return catalog().models.filter(m => typeof m.file === 'string' && fs.existsSync(m.file))
    .map(m => ({ id: m.id, name: m.name, kind: m.kind,
      url: `/assets/user-models/${m.id}/${m.kind === 'live2d' ? 'model.json' : 'model.vrm'}` }))
}
function selectedModel() { return catalog().selected || '' }
function selectModel(id) {
  if (!listModels().some(m => m.id === id)) throw new Error('本地模型不存在，请重新添加')
  const data = catalog(); data.selected = id; save(data)
}
function localFile(key, relative) {
  const location = modelLocation(key)
  if (!location || typeof relative !== 'string') return null
  try {
    if (location.kind === 'vrm') return relative === 'model.vrm' && fs.statSync(path.join(location.folder, location.filename)).isFile() ? path.join(location.folder, location.filename) : null
    if (relative.split(/[\\/]/).some(part => part === '..' || part.includes(':')) || path.isAbsolute(relative)) return null
    const base = fs.realpathSync(location.folder), candidate = fs.realpathSync(path.resolve(base, relative))
    const rel = path.relative(base, candidate)
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.statSync(candidate).isFile()) return null
    if (!/\.(json|moc3|png|jpg|jpeg|webp|wav|mp3|ogg)$/i.test(candidate)) return null
    return candidate
  } catch { return null }
}
function modelManifest(key) {
  const location = modelLocation(key)
  if (!location || location.kind !== 'live2d') return null
  const file = localFile(key, location.filename)
  if (!file) return null
  const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
  const json = read(file), refs = json.FileReferences
  const vtsFile = localFile(key, location.filename.replace('.model3.json', '.vtube.json'))
  const vts = vtsFile ? read(vtsFile) : {}
  const names = new Map((vts.Hotkeys || []).filter(h => h.Action === 'ToggleExpression').map(h => [h.File, h.Name]))
  const expressions = [...(refs.Expressions || [])]
  for (const sub of ['', 'expressions', 'Expressions']) {
    const dir = path.join(location.folder, sub)
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.exp3.json')) continue
      const relative = (sub ? sub + '/' : '') + name
      if (localFile(key, relative) && !expressions.some(e => e.File.toLowerCase() === relative.toLowerCase())) expressions.push({ Name: names.get(name) || name.replace('.exp3.json', ''), File: relative })
    }
  }
  refs.Expressions = expressions
  json.PetCompatibility = { parameterSettings: vts.ParameterSettings || [] }
  // Do not guess idle/wardrobe motions: many are one-shot transformations.
  // The served manifest is generated in memory; downloaded model files stay untouched.
  return json
}
module.exports = { setCatalogPath, registerModel, listModels, selectedModel, selectModel, modelLocation, localFile, modelManifest }
