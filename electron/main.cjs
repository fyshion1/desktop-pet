const { app, BrowserWindow, ipcMain, protocol, net, screen, Tray, Menu, nativeImage, shell, globalShortcut, powerMonitor, Notification, dialog } = require('electron')
const fs = require('node:fs')
const WebSocket = require('ws')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { resourcePath } = require('./resources.cjs')
const { fitBounds, taskbarEdge } = require('./geometry.cjs')
const { placeCompanion } = require('./placement.cjs')
const { setCatalogPath, registerModel, listModels, selectedModel, selectModel, localFile, modelManifest } = require('./local-models.cjs')
const presence = require('./presence.cjs')
if (process.env.PET_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.PET_USER_DATA_DIR))
app.setName('Desktop Pet')
setCatalogPath(process.env.PET_MODEL_CATALOG || path.join(app.getPath('userData'), 'models.json'))
if (process.platform === 'win32') app.setAppUserModelId('shionarium.desktop-pet')

const root = path.resolve(__dirname, '..')
const project = process.env.SHIONARIUM_CORE_DIR ? path.resolve(process.env.SHIONARIUM_CORE_DIR) : path.resolve(root, '..', '..')
const assetRoot = process.env.PET_ASSET_ROOT || path.join(project, 'assets')
const vendorRoot = path.join(project, 'frontend', 'public', 'vendor')
const brain = new URL(process.env.PET_BRAIN_URL || process.env.SHIONARIUM_BACKEND_URL || 'http://127.0.0.1:8000')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(brain.hostname) || !['http:', 'https:'].includes(brain.protocol)) throw new Error('桌宠大脑地址必须是本机 HTTP 服务')
protocol.registerSchemesAsPrivileged([{ scheme: 'pet', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
let win, tray, timer, drag = null, hit = true, settings = {}, quitting = false, lastConfigAt = 0
let speechController, sendController, sending = false, settingsWrite = Promise.resolve(), dockEdge = null, folded = false, lastNear = Date.now(), engaged = false
let reminderTimer, remindersLoading = false
let placement = null, actorAnchor = null, bubbleOpen = true, actorRatio = .52
let speechVisible = false
function currentActor() {
  if (placement) { const b = win.getBounds(); return { ...placement.actor, x: b.x + placement.actor.x, y: b.y + placement.actor.y } }
  const b = win.getBounds()
  return actorAnchor || { x: b.x + b.width * .55 - 110, y: b.y + b.height - 450, width: 220, height: 420 }
}
// 拖动跟随：固定节拍 + 低通平滑。
// 触摸上报的屏幕坐标带高频噪声，直接在 pointermove 里 setPosition 会把噪声原样放大
// （实测比 33ms 采样还抖）；完全按定时器采样又会滞后一帧。折中是 60fps 节拍 + 平滑系数。
const DRAG_TICK_MS = 16
const DRAG_SMOOTH = 0.55          // 0=完全不动，1=完全跟手；0.55 兼顾跟手与稳定
let dragTimer = null

function startDragLoop() {
  if (dragTimer) return
  dragTimer = setInterval(() => {
    if (!drag) { stopDragLoop(); return }
    moveDrag()
  }, DRAG_TICK_MS)
}

function stopDragLoop() {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null }
}

function moveDrag() {
  if (!drag || !win || win.isDestroyed()) return
  // 鼠标拖动没有触点坐标，用全局光标当输入源（和原来一致）。
  if (!drag.pointer) drag.last = screen.getCursorScreenPoint()
  const at = drag.last || drag.origin
  const targetX = drag.bounds.x + at.x - drag.origin.x
  const targetY = drag.bounds.y + at.y - drag.origin.y
  const [cx, cy] = win.getPosition()
  // 指数平滑：每拍只走剩余距离的一部分，噪声被摊平，观感是"顺"而不是"跳"。
  const nx = Math.round(drag.pointer ? cx + (targetX - cx) * DRAG_SMOOTH : targetX)
  const ny = Math.round(drag.pointer ? cy + (targetY - cy) * DRAG_SMOOTH : targetY)
  // 死区：亚像素位移不处理。
  if (Math.abs(nx - cx) >= 1 || Math.abs(ny - cy) >= 1) win.setPosition(nx, ny)
}

function arrange(recover = false) {
  if (!win || win.isDestroyed() || drag) return placement
  const previous = currentActor(), area = screen.getDisplayMatching(previous).workArea
  const height = 420 * Math.max(.15, Math.min(3, Number(settings.scale) || 1))
  const width = height * actorRatio
  actorAnchor = { x: previous.x + (previous.width - width) / 2, y: previous.y + previous.height - height, width, height }
  if (dockEdge === 'left') actorAnchor.x = area.x + 8
  if (dockEdge === 'right') actorAnchor.x = area.x + area.width - width - 8
  if (dockEdge === 'top') actorAnchor.y = area.y + 8
  if (dockEdge === 'bottom') actorAnchor.y = area.y + area.height - height - 36
  placement = placeCompanion(actorAnchor, area, { width: Number(settings.bubble_width) || 488, height: Number(settings.bubble_height) || 360 }, bubbleOpen, recover, speechVisible)
  win.setBounds(placement.bounds)
  win.webContents.send('pet:placement', placement)
  return placement
}
let voiceSocket = null
let wakeSocket = null, socialTimer, socialLoading = false
async function pollSocial(ack = '') {
  if (socialLoading || !win || win.isDestroyed()) return
  const p = publishPresence()
  if (!p.allowed || !win.isVisible() || sending || engaged || voiceSocket) return
  socialLoading = true
  try {
    const s = await history()
    const payload = { character_id: settings.character, mode: settings.session, session_id: s.session_id,
      persona_id: s.persona_id, permitted: true, available_until: p.mode === 'warm' ? Date.now() + 3600000 : p.until, buffer_until: p.bufferUntil, ack }
    const data = await request('/api/pet/companion/social', payload)
    if (data.status === 'ready' && publishPresence().allowed && !sending && !engaged && !voiceSocket && win.isVisible()) {
      const current = await history()
      if (current.session_id !== s.session_id || current.persona_id !== s.persona_id) return
      // Commit once before presentation; failed responses are recovered by the normal history refresh.
      const receipt = await request('/api/pet/companion/social', { ...payload, ack: data.item.id })
      if (receipt.status === 'delivered' && publishPresence().allowed) {
        win.webContents.send('pet:social', { session_id: s.session_id, persona_id: s.persona_id })
      }
    }
  } catch (error) {
    console.warn('桌宠主动招呼未完成:', error.message)
    win.webContents.send('pet:social-error', '这次主动招呼暂时没接通，稍后再陪你；不会重复扣费重试。')
  } finally { socialLoading = false }
}
let presenceState = {}, presenceTimer, presenceSignature = ''
function presencePath() { return path.join(app.getPath('userData'), 'presence.json') }
function publishPresence() {
  const current = presence.evaluate(presenceState)
  const signature = JSON.stringify(current)
  if (signature !== presenceSignature) {
    presenceSignature = signature
    if (win && !win.isDestroyed()) win.webContents.send('pet:presence', current)
    tray?.setToolTip(`桌宠 · ${current.label}`)
  }
  return current
}
const notifiedReminders = new Set()
async function pollReminders() {
  if (remindersLoading || !win || win.isDestroyed()) return
  remindersLoading = true
  try {
    const data = await request('/api/reminders/due')
    const items = Array.isArray(data.items) ? data.items : []
    win.webContents.send('pet:reminders', { items: items.map(item => ({ id: item.id, title: item.title, due_at: item.due_at })) })
    for (const item of items) {
      const key = `${data.persona_id}:${item.id}:${item.revision}`
      if (notifiedReminders.has(key)) continue
      notifiedReminders.add(key)
      if (Notification.isSupported() && process.env.PET_SUPPRESS_NOTIFICATIONS !== '1') {
        const notice = new Notification({ title: '桌宠 · 到提醒时间了', body: item.title, silent: false })
        notice.on('click', () => { void shell.openExternal('http://localhost:5173/#tool-center') })
        notice.show()
      }
    }
  } catch { /* Backend may be restarting; the next poll recovers pending reminders. */ }
  finally { remindersLoading = false }
}
function fold(value) {
  if (folded === value) return
  folded = value; win.webContents.send('pet:fold', { folded: value, edge: dockEdge })
  hit = !value; win.setIgnoreMouseEvents(value, { forward: true })
}
const defaults = { character: '', session: 'single', model: '', scale: 1, always_on_top: true, auto_memory: true }

async function request(endpoint, body, method) {
  const r = await fetch(new URL(endpoint, brain), {
    method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json',
      ...(endpoint.startsWith('/api/tools/network/') ? { 'X-Exploration-Dashboard': '1' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180000),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `应用暂时未能响应（${r.status}）`)
  return data
}
async function config(force = false) {
  if (force || !lastConfigAt || Date.now() - lastConfigAt > 4000) {
    const data = await request('/api/nest/features/desktop_pet/settings')
    settings = { ...defaults, ...data.values, model: selectedModel() }; lastConfigAt = Date.now()
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!settings.always_on_top)
  }
  return settings
}
async function history() {
  const s = await config()
  return request(`/api/chat/session?feature_id=desktop_pet&character_id=${encodeURIComponent(s.character)}&mode=${encodeURIComponent(s.session)}`)
}
function updateSettings(values) {
  const work = settingsWrite.then(async () => {
    const current = await request('/api/nest/features/desktop_pet/settings')
    const saved = await request('/api/nest/features/desktop_pet/settings', { values: { ...current.values, ...values } }, 'PUT')
    settings = { ...defaults, ...saved.values, model: selectedModel() }; lastConfigAt = Date.now()
    return settings
  })
  settingsWrite = work.catch(() => {})
  return work
}
function fitBubble(width, height) {
  const area = screen.getDisplayMatching(currentActor()).workArea
  width = Math.round(Math.max(340, Math.min(760, width, area.width - 40)))
  height = Math.round(Math.max(260, Math.min(620, height, area.height - 280)))
  Object.assign(settings, { bubble_width: width, bubble_height: height })
  arrange()
  return { bubble_width: width, bubble_height: height }
}
async function bootstrapData() {
  const [s, chars] = await Promise.all([config(true), request('/api/characters')])
  const character = chars.find(c => c.id === s.character)
  const activeCharacter = character || { id: '', name: '请先创建或选择助手', emoji: '', avatar: '' }
  const profiles = await request('/api/profiles').catch(() => null)
  const persona = profiles?.profiles?.find(p => p.id === profiles.active_id)
  fitBubble(Number(s.bubble_width) || 488, Number(s.bubble_height) || 360)
  return { models: listModels(), placement, dockEdge, presence: publishPresence(), settings: s, persona: persona ? { name: persona.name, emoji: persona.emoji, avatar: persona.avatar } : null, character: { id: activeCharacter.id, name: activeCharacter.name, emoji: activeCharacter.emoji, avatar: activeCharacter.avatar }, characters: chars.map(c => ({ id: c.id, name: c.name, emoji: c.emoji, avatar: c.avatar })), session: character ? await history() : { session_id: '', mode: 'single', items: [], configured: false } }
}
function trusted(event) { return event.sender === win?.webContents && event.senderFrame?.url.startsWith('pet://app/') }
function open() { if (win && !win.isDestroyed()) { lastNear = Date.now(); fold(false); win.show(); win.focus(); win.webContents.send('pet:open') } }
function clamp(bounds) {
  const area = screen.getDisplayMatching(bounds).workArea
  return fitBounds(bounds, area)
}
function recoverDisplay() {
  if (!win || win.isDestroyed()) return
  drag = null
  dockEdge = null; fold(false)
  arrange(true)
  win.webContents.send('pet:display')
  saveBounds()
}
function saveBounds() {
  if (!win || win.isDestroyed()) return
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(path.join(app.getPath('userData'), 'window.json'), JSON.stringify({ ...win.getBounds(), dockEdge, actor: currentActor() }))
}
function shutdown() { if (quitting) return; quitting = true; clearInterval(timer); globalShortcut.unregisterAll(); saveBounds(); tray?.destroy(); app.quit() }

if (!app.requestSingleInstanceLock()) { app.quit() } else {
  app.on('second-instance', open)
  app.whenReady().then(async () => {
    try { presenceState = presence.normalize(JSON.parse(fs.readFileSync(presencePath(), 'utf8'))) }
    catch (error) { if (error.code !== 'ENOENT') console.warn('在场状态读取失败，已回到安静模式') }
    protocol.handle('pet', req => {
      const url = new URL(req.url)
      if (url.host !== 'app') return new Response('Not found', { status: 404 })
      if (url.pathname.startsWith('/assets/user-models/')) {
        let parts
        try { parts = decodeURIComponent(url.pathname).slice('/assets/user-models/'.length).split('/') } catch { return new Response('Bad path', { status: 400 }) }
        const key = parts.shift(), relative = parts.join('/')
        if (relative === 'model.json') {
          try { const data = modelManifest(key); return data ? new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }) : new Response('Model missing', { status: 404 }) } catch { return new Response('Model manifest invalid', { status: 422 }) }
        }
        const file = localFile(key, relative)
        return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 })
      }
      if (url.pathname === '/voice-capture.js') return net.fetch(pathToFileURL(path.join(project, 'frontend/public/voice-capture.js')).toString())
      if (url.pathname.startsWith('/api/files/') && !url.pathname.includes('..')) return net.fetch(new URL(url.pathname, brain).toString())
      const file = resourcePath(url.pathname, path.join(root, 'dist'), assetRoot, vendorRoot)
      return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 })
    })
    const area = screen.getPrimaryDisplay().workArea
    const width = Math.min(540, area.width), height = Math.min(800, area.height)
    let position = { x: area.x + area.width - width - 18, y: area.y + area.height - height }
    try { const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'window.json'), 'utf8')); position = { ...position, ...saved }; dockEdge = ['left', 'right', 'top', 'bottom'].includes(saved.dockEdge) ? saved.dockEdge : null } catch {}
    position = clamp({ x: position.x, y: position.y, width: Number(position.width) || width, height: Number(position.height) || height })
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'window.json'), 'utf8'))
      if (saved.actor && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(saved.actor[k])) && saved.actor.width > 0 && saved.actor.height > 0) actorAnchor = saved.actor
    } catch {}
    win = new BrowserWindow({ width, height, ...position, transparent: true, frame: false, resizable: false,
      backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(contents === win.webContents && contents.getURL().startsWith('pet://app/') && permission === 'media' && !(details.mediaTypes || []).includes('video'))
    })
    win.webContents.session.setPermissionCheckHandler((contents, permission, origin) => contents === win.webContents && permission === 'media' && origin.startsWith('pet://app'))
    win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('pet://app/')) event.preventDefault() })
    win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide() } })
    win.on('hide', () => { drag = null; win.webContents.send('pet:visibility', false) })
    win.on('show', () => win.webContents.send('pet:visibility', true))
    screen.on('display-removed', recoverDisplay)
    screen.on('display-added', recoverDisplay)
    screen.on('display-metrics-changed', recoverDisplay)
    powerMonitor.on('resume', recoverDisplay)
    ipcMain.handle('pet:bootstrap', async event => {
      if (!trusted(event)) throw new Error('Invalid frame')
      return bootstrapData()
    })
    ipcMain.on('pet:bubble-open', (event, value) => { if (trusted(event)) { bubbleOpen = !!value; arrange() } })
    ipcMain.on('pet:speech-visible', (event, value) => { if (trusted(event) && speechVisible !== (value === true)) { speechVisible = value === true; arrange() } })
    ipcMain.handle('pet:poke-model', async (event, value) => {
      if (!trusted(event) || typeof value !== 'boolean') throw new Error('触碰设置不正确')
      return updateSettings({ poke_to_chat: value })
    })
    ipcMain.on('pet:actor-ratio', (event, value) => {
      if (trusted(event) && Number.isFinite(value) && value > .1 && value < 3 && Math.abs(actorRatio - value) > .001) { actorRatio = value; arrange() }
    })
    ipcMain.handle('pet:presence-set', (event, value) => {
      if (!trusted(event)) throw new Error('Invalid frame')
      const next = presence.transition(presenceState, value?.mode, value?.minutes)
      fs.mkdirSync(app.getPath('userData'), { recursive: true })
      fs.writeFileSync(`${presencePath()}.tmp`, JSON.stringify(next), 'utf8')
      fs.renameSync(`${presencePath()}.tmp`, presencePath())
      presenceState = next
      return publishPresence()
    })
    ipcMain.handle('pet:voice-config', async event => {
      if (!trusted(event)) throw new Error('Invalid frame')
      return request('/api/voice/call/config')
    })
    ipcMain.handle('pet:voice-open', async (event, options) => {
      if (!trusted(event) || sending || !['call', 'dictate'].includes(options?.kind)) throw new Error('当前无法开始录音')
      voiceSocket?.close()
      wakeSocket?.close(); wakeSocket = null
      const [s, session, caps] = await Promise.all([config(), history(), request('/api/voice/call/config')])
      if (!caps.local_asr_ready) throw new Error('本地语音识别未就绪')
      const provider = options.kind === 'dictate' ? 'fish' : options.provider
      if (!['fish', 'piper', 'cosyvoice', 'kokoro'].includes(provider)) throw new Error('无效音色服务')
      if (options.kind === 'call' && provider === 'fish') throw new Error('桌宠当前仅使用本地语音，请选择本地音色')
      const url = new URL('/api/voice/call/ws', brain); url.protocol = brain.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = voiceSocket = new WebSocket(url, { origin: brain.origin, maxPayload: 16 * 1024 * 1024 })
      const emit = data => { if (voiceSocket === socket && win && !win.isDestroyed()) win.webContents.send('pet:voice', data) }
      socket.on('open', () => {
        if (voiceSocket !== socket) { socket.close(); return }
        socket.send(JSON.stringify({ character_id: s.character, session_id: session.session_id, persona_id: session.persona_id,
          mode: s.session, feature_id: 'desktop_pet', auto_memory: !!s.auto_memory, asr_provider: 'local',
          tts_provider: provider, voice_id: options.voice || '', cosyvoice_playback: options.playback === 'stream' ? 'stream' : 'smooth', input_only: options.kind === 'dictate' }))
        emit({ type: 'open' })
      })
      socket.on('message', (data, binary) => emit({ type: 'message', binary, data: binary ? new Uint8Array(data) : data.toString() }))
      socket.on('error', () => emit({ type: 'error' }))
      socket.on('close', () => emit({ type: 'close' }))
      return true
    })
    ipcMain.on('pet:voice-data', (event, data) => {
      if (!trusted(event) || voiceSocket?.readyState !== WebSocket.OPEN) return
      if (data instanceof Uint8Array && data.length <= 32000) {
        if (voiceSocket.bufferedAmount > 64000) { voiceSocket.close(); return }
        voiceSocket.send(data)
      } else if (typeof data === 'string' && data.length <= 18000) {
        try { const value = JSON.parse(data); if (['played', 'text', 'interrupt', 'hangup'].includes(value.type)) voiceSocket.send(data) } catch {}
      }
    })
    ipcMain.on('pet:voice-close', event => { if (trusted(event)) { const socket = voiceSocket; voiceSocket = null; socket?.close() } })
    ipcMain.handle('pet:wake-config', event => { if (!trusted(event)) throw new Error('Invalid frame'); return request('/api/pet/companion/wake/config') })
    ipcMain.handle('pet:wake-open', async event => {
      if (!trusted(event) || voiceSocket || sending) throw new Error('请先结束当前语音或回复')
      const caps = await request('/api/pet/companion/wake/config')
      if (!caps.ready) throw new Error('中文唤醒模型尚未就绪')
      wakeSocket?.close()
      const url = new URL('/api/pet/companion/wake/ws', brain); url.protocol = brain.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = wakeSocket = new WebSocket(url, { origin: brain.origin, maxPayload: 16000 })
      const emit = value => { if (wakeSocket === socket && win && !win.isDestroyed()) win.webContents.send('pet:wake', value) }
      socket.on('message', (data, binary) => { if (!binary) { try { emit(JSON.parse(data.toString())) } catch {} } })
      socket.on('error', () => emit({ type: 'error', message: '本地唤醒连接失败' }))
      socket.on('close', () => emit({ type: 'error', message: '本地唤醒已断开，请重新开启' }))
      return true
    })
    ipcMain.on('pet:wake-data', (event, bytes) => {
      if (!trusted(event) || !(bytes instanceof Uint8Array) || bytes.length > 6400) return
      if (wakeSocket?.readyState === WebSocket.OPEN) {
        if (wakeSocket.bufferedAmount > 32000) { wakeSocket.close(); return }
        wakeSocket.send(bytes)
      }
    })
    ipcMain.on('pet:wake-close', event => { if (trusted(event)) { const socket = wakeSocket; wakeSocket = null; socket?.close() } })
    ipcMain.handle('pet:session', async (event, value) => {
      if (!trusted(event) || sending) throw new Error('请等当前回复完成再切换')
      if (!['single', 'group'].includes(value?.mode)) throw new Error('聊天类型不正确')
      const chars = await request('/api/characters')
      if (!chars.some(c => c.id === value.character)) throw new Error('角色不存在')
      speechController?.abort()
      await updateSettings({ character: value.character, session: value.mode })
      return bootstrapData()
    })
    ipcMain.handle('pet:theme', async (event, theme) => {
      if (!trusted(event) || !['lilac', 'rose', 'mint', 'night', 'paper'].includes(theme)) throw new Error('主题不存在')
      return updateSettings({ theme })
    })
    ipcMain.handle('pet:choose-model', async event => {
      if (!trusted(event)) throw new Error('来源不正确')
      const result = await dialog.showOpenDialog(win, { title: '添加已获授权的本地模型', properties: ['openFile'],
        filters: [{ name: 'Live2D / VRM', extensions: ['json', 'vrm'] }] })
      if (result.canceled || !result.filePaths[0]) return null
      registerModel(result.filePaths[0])
      return bootstrapData()
    })
    ipcMain.handle('pet:model', async (event, model) => {
      if (!trusted(event)) throw new Error('来源不正确')
      selectModel(model)
      return bootstrapData()
    })
    ipcMain.handle('pet:auto-speak', async (event, value) => {
      if (!trusted(event) || typeof value !== 'boolean') throw new Error('自动播放设置不正确')
      if (!value) speechController?.abort()
      return updateSettings({ auto_speak: value })
    })
    ipcMain.handle('pet:auto-hide', async (event, value) => {
      if (!trusted(event) || typeof value !== 'boolean') throw new Error('收起设置不正确')
      const s = await updateSettings({ dock_auto_hide: value })
      lastNear = Date.now(); fold(false)
      return s
    })
    ipcMain.on('pet:reveal', event => { if (trusted(event)) open() })
    ipcMain.on('pet:engaged', (event, value) => { if (trusted(event)) { engaged = !!value; if (engaged) { lastNear = Date.now(); fold(false) } } })
    ipcMain.handle('pet:scale', async (event, value) => {
      if (!trusted(event) || !Number.isFinite(value)) throw new Error('人物大小不正确')
      const saved = await updateSettings({ scale: Math.round(Math.max(.15, Math.min(3, value)) * 100) / 100 })
      arrange(); return saved
    })
    ipcMain.on('pet:context-menu', event => {
      if (!trusted(event)) return
      Menu.buildFromTemplate([
        { label: '打开聊天', click: open },
        { label: '隐藏桌宠（托盘可恢复）', click: () => win.hide() },
        { type: 'separator' },
        { label: '完整退出桌宠（结束桌宠后台）', click: shutdown },
      ]).popup({ window: win })
    })
    ipcMain.handle('pet:resize-bubble', async (event, value) => {
      if (!trusted(event) || !Number.isFinite(value?.width) || !Number.isFinite(value?.height)) throw new Error('聊天框尺寸不正确')
      const size = fitBubble(value.width, value.height)
      Object.assign(settings, size)
      if (value.save) { await updateSettings(size); saveBounds() }
      return size
    })
    ipcMain.handle('pet:dock', (event, edge) => {
      if (!trusted(event) || !['left', 'right', 'top', 'bottom', 'taskbar'].includes(edge)) throw new Error('停靠方向不正确')
      drag = null
      const display = screen.getDisplayMatching(currentActor())
      if (edge === 'taskbar') edge = taskbarEdge(display.bounds, display.workArea)
      dockEdge = edge; lastNear = Date.now(); fold(false)
      arrange()
      win.webContents.send('pet:docked', dockEdge)
      saveBounds()
    })
    ipcMain.handle('pet:history', event => { if (!trusted(event)) throw new Error('Invalid frame'); return history() })
    ipcMain.handle('pet:tools-state', async event => {
      if (!trusted(event)) throw new Error('Invalid frame')
      const [expert, network] = await Promise.all([request('/api/expert'), request('/api/tools/network')])
      if (!expert.enabled) return { expert: false, installed: network.installed, enabled: network.channels.desktop_pet, count: network.installed ? 1 : 0 }
      const [data, profiles] = await Promise.all([request('/api/tools/config'), request('/api/profiles')])
      const c = data.config
      return { expert: true, installed: network.installed, networkEnabled: network.channels.desktop_pet,
        enabled: !!(c.enabled && c.pet_enabled && c.owner_persona_id === profiles.active_id), count: c.allowed_names.length }
    })
    ipcMain.handle('pet:network-toggle', async (event, enabled) => {
      if (!trusted(event) || typeof enabled !== 'boolean') throw new Error('Invalid frame')
      return request('/api/tools/network/desktop_pet', { enabled }, 'PUT')
    })
    ipcMain.on('pet:tools-home', async event => {
      if (trusted(event) && (await request('/api/expert').catch(() => ({}))).enabled)
        void shell.openExternal('http://localhost:5173/#tool-center')
    })
    ipcMain.on('pet:cancel-send', event => { if (trusted(event)) sendController?.abort() })
    ipcMain.handle('pet:upload', async (event, payload) => {
      if (!trusted(event) || typeof payload?.session_id !== 'string' || !(payload.bytes instanceof Uint8Array) || payload.bytes.length > 50 * 1024 * 1024 || typeof payload.name !== 'string' || typeof payload.type !== 'string') throw new Error('附件格式或大小不正确')
      const current = await history()
      if (current.session_id !== payload.session_id) throw new Error('会话已切换，请重新发送')
      const form = new FormData()
      form.append('session_id', payload.session_id)
      form.append('file', new Blob([payload.bytes], { type: payload.type }), payload.name)
      const controller = sendController = new AbortController()
      try {
        const response = await fetch(new URL('/api/attachments/prepare', brain), { method: 'POST', body: form, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]) })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '附件解析失败')
        return data
      } catch (error) {
        if (controller.signal.aborted) throw new Error('已停止附件发送，草稿已保留。')
        throw error
      } finally { if (sendController === controller) sendController = null }
    })
    ipcMain.handle('pet:send', async (event, payload) => {
      if (!trusted(event) || typeof payload?.text !== 'string' || payload.text.length > 16000 || typeof payload.request_id !== 'string' || typeof payload.session_id !== 'string') throw new Error('消息格式不正确')
      const s = await config()
      if (payload.kind === 'poke') {
        if (s.poke_to_chat !== true) throw new Error('触碰联动未开启，不会调用大模型')
        payload = { ...payload, text: s.session === 'group'
          ? '[桌宠互动] 我轻轻戳了戳在场的所有助手。请在同一轮中让在场各位以自己的身份简短回应，并沿用群聊发言格式。'
          : '[桌宠互动] 我轻轻戳了戳你。请以当前角色自然回应，简短一两句话即可。', images: [], attachment: '' }
      }
      if (sending) throw new Error('正在回复中')
      sending = true
      const controller = sendController = new AbortController()
      try {
      const response = await fetch(new URL('/api/chat/session/stream', brain), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_id: 'desktop_pet', character_id: s.character, mode: s.session,
          session_id: payload.session_id, text: payload.text, images: payload.images || [], attachment: payload.attachment || '', request_id: payload.request_id, auto_memory: !!s.auto_memory }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]) })
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(typeof data.detail === 'string' ? data.detail : '应用暂时未能开始回复，请重试') }
      let buffer = '', result
      const decoder = new TextDecoder()
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true })
        let newline
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
          if (!line.trim()) continue
          const item = JSON.parse(line)
          if (item.type === 'error') throw new Error(item.message)
          if (item.type === 'delta') event.sender.send('pet:delta', { request_id: payload.request_id, text: item.text })
          if (item.type === 'status') event.sender.send('pet:progress', { ...item, request_id: payload.request_id })
          if (item.type.startsWith('tool_') || item.type.startsWith('agent_')) event.sender.send('pet:tool', { ...item, request_id: payload.request_id })
          if (item.type === 'done') result = item.result
        }
      }
      if (!result) throw new Error('回复连接中断，请重试这一轮')
      return result
      } catch (error) {
        if (controller.signal.aborted) throw new Error('已停止本轮，已保留你的消息。')
        const code = error.cause?.code || error.code
        if (['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET'].includes(code) || error.message === 'terminated' || error.message === 'fetch failed') throw new Error('与本机后端服务的连接中断，请确认大脑已启动且未正在重启；不会自动重试。')
        throw error
      } finally { sending = false; if (sendController === controller) sendController = null }
    })
    ipcMain.on('pet:stop-speech', event => { if (trusted(event)) speechController?.abort() })
    ipcMain.handle('pet:tts', async (event, text) => {
      if (!trusted(event) || typeof text !== 'string' || text.length > 16000) throw new Error('朗读文本不正确')
      speechController?.abort()
      const controller = speechController = new AbortController()
      const s = await config()
      const response = await fetch(new URL('/api/voice/tts', brain), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, engine: s.voice_engine || 'edge', voice: s.voice || 'zh-CN-XiaoxiaoNeural' }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]) })
      if (!response.ok) throw new Error('朗读暂时不可用，文字回复已保留')
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength > 24 * 1024 * 1024) throw new Error('音频过长，请缩短朗读内容')
      return { bytes, type: response.headers.get('content-type') || 'audio/mpeg' }
    })
    ipcMain.on('pet:hit', (event, value) => {
      if (!trusted(event) || drag || folded) return
      const next = !!value
      if (next !== hit) { hit = next; win.setIgnoreMouseEvents(!hit, { forward: true }) }
    })
    ipcMain.on('pet:drag', (event, active, point) => {
      if (!trusted(event)) return
      // 已经在拖：忽略重复的 start。否则一次多点触控/重入就会把原点重置，窗口当场跳一下。
      if (active && drag) return
      // 触屏没有「全局光标」：Windows 平板下 screen.getCursorScreenPoint() 是过期值，
      // 拿它算位移窗口不会跟手。有可用触点坐标时一律以触点为原点。
      const valid = point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.usable !== false
      const origin = valid ? { x: point.x, y: point.y } : screen.getCursorScreenPoint()
      drag = active ? { origin, last: valid ? origin : null, pointer: !!valid, bounds: win.getBounds() } : null
      if (drag) startDragLoop(); else stopDragLoop()
      dockEdge = null; win.webContents.send('pet:docked', null); lastNear = Date.now(); fold(false)
      if (active) { hit = true; win.setIgnoreMouseEvents(false) } else {
        const b = currentActor(), a = screen.getDisplayMatching(b).workArea
        dockEdge = Math.abs(b.x - a.x) <= 26 ? 'left' : Math.abs(a.x + a.width - b.x - b.width) <= 26 ? 'right' : Math.abs(a.y + a.height - b.y - b.height - 28) <= 26 ? 'bottom' : Math.abs(b.y - a.y) <= 26 ? 'top' : null
        arrange()
        win.webContents.send('pet:docked', dockEdge)
        win.webContents.send('pet:display'); saveBounds()
      }
    })
    ipcMain.on('pet:drag-move', (event, point) => {
      if (!trusted(event) || !drag || !point) return
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.usable === false) return
      drag.pointer = true; drag.last = { x: point.x, y: point.y }
      // 只更新目标点；由 startDragLoop 的 16ms 循环做平滑跟随。
      // （直接在这里 setPosition 会把触摸坐标的高频噪声原样放大，实测更抖。）
    })
    ipcMain.on('pet:home', event => { if (trusted(event)) void shell.openExternal('http://localhost:5173') })
    ipcMain.on('pet:hide', event => { if (trusted(event)) win.hide() })
    timer = setInterval(() => {
      if (!win || win.isDestroyed() || !win.isVisible()) return
      const cursor = screen.getCursorScreenPoint()
      const [x, y] = win.getPosition()
      const b = win.getBounds(), a = screen.getDisplayMatching(currentActor()).workArea
      const nearWindow = cursor.x >= x && cursor.x <= x + b.width && cursor.y >= y && cursor.y <= y + b.height
      const nearEdge = dockEdge === 'left' ? Math.abs(cursor.x - a.x) <= 32 && cursor.y >= y && cursor.y <= y + b.height : dockEdge === 'right' ? Math.abs(cursor.x - a.x - a.width) <= 32 && cursor.y >= y && cursor.y <= y + b.height : dockEdge === 'top' ? Math.abs(cursor.y - a.y) <= 32 && cursor.x >= x && cursor.x <= x + b.width : dockEdge === 'bottom' ? Math.abs(cursor.y - a.y - a.height) <= 32 && cursor.x >= x && cursor.x <= x + b.width : false
      if (settings.dock_auto_hide !== true) fold(false)
      if (folded && Date.now() - lastConfigAt > 5000) { lastConfigAt = Date.now(); void config(true).catch(() => {}) }
      if (settings.dock_auto_hide === true && dockEdge && !drag) {
        if ((folded ? nearEdge : nearWindow) || engaged || sending) { lastNear = Date.now(); fold(false) }
        else if (Date.now() - lastNear > 3000) fold(true)
      }
      win.webContents.send('pet:cursor', { x: cursor.x - x, y: cursor.y - y })
    }, 33)
    const bitmap = Buffer.alloc(32 * 32 * 4)
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4, inCircle = (x - 16) ** 2 + (y - 16) ** 2 < 210
      bitmap[i] = 170; bitmap[i + 1] = 124; bitmap[i + 2] = 244; bitmap[i + 3] = inCircle ? 255 : 0
    }
    tray = new Tray(nativeImage.createFromBitmap(bitmap, { width: 32, height: 32 }))
    tray.setToolTip('桌宠')
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '聊聊天', click: open }, { label: '回到应用', click: () => shell.openExternal('http://localhost:5173') }, { type: 'separator' }, { label: '退出桌宠', click: shutdown }]))
    tray.on('double-click', open)
    globalShortcut.register('CommandOrControl+Shift+Space', open)
    await win.loadURL('pet://app/index.html')
    void pollReminders()
    reminderTimer = setInterval(pollReminders, 5000)
    presenceTimer = setInterval(publishPresence, 1000)
    socialTimer = setInterval(() => void pollSocial(), 30000)
    if (process.env.PET_TEST_MODE === '1') win.webContents.openDevTools({ mode: 'detach', activate: false })
  }).catch(error => { console.error('桌宠启动失败:', error.stack || error.message); shutdown() })
}
app.on('before-quit', () => { stopDragLoop(); quitting = true; clearInterval(timer); clearInterval(reminderTimer); clearInterval(presenceTimer); clearInterval(socialTimer); wakeSocket?.close(); voiceSocket?.close(); globalShortcut.unregisterAll() })
app.on('window-all-closed', () => { if (quitting) app.quit() })
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
