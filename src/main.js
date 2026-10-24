import * as PIXI from 'pixi.js'
import './style.css'
import { PetVoice } from './petVoice.js'
import { PetWake } from './petWake.js'
import { createExpressions } from './live2dExpressions.js'
import { configureLive2DRendering, configureVtsInputs, mapTracking } from './live2dCompatibility.js'
import { PokeGesture, pokeLines } from './pokeGesture.js'
import { replySegments } from './replyPresentation.js'

const bridge = window.pet
document.querySelector('#app').innerHTML = `
  <canvas id="stage" aria-label="可以触摸和拖动的 Live2D 角色"></canvas>
  <canvas id="vrm-stage" hidden aria-label="可以触摸和拖动的 VRM 角色"></canvas>
  <section id="bubble" data-interactive aria-label="桌面聊天">
    <header title="拖动这里，人物和聊天框一起移动"><span class="spark">✦</span><div><strong id="name">桌宠</strong><small id="session">和应用连在一起</small></div><button id="speak" title="朗读最后一条回复" aria-label="朗读最后一条回复">♪</button><button id="home" title="回到应用">⌂</button><button id="close" title="收起聊天">×</button></header>
    <nav aria-label="聊天与窗口"><select id="conversation" aria-label="切换聊天对象" title="切换群聊或其他助手的私聊"></select><button id="smaller" title="缩小聊天框" aria-label="缩小聊天框">−</button><button id="larger" title="放大聊天框" aria-label="放大聊天框">＋</button><select id="dock" aria-label="停靠位置"><option value="">停靠…</option><option value="left">贴左边</option><option value="right">贴右边</option><option value="top">贴顶边</option><option value="taskbar">贴任务栏</option></select></nav>
    <div id="presence-bar"><label>陪伴 <select id="presence" aria-label="陪伴方式"><option value="warm">常来找我呀 · 全天留言</option><option value="quiet">悄悄陪着</option><option value="busy">我忙一会</option><option value="rest">陪我歇会</option><option value="available:15">来陪我呀 · 15分</option><option value="available:30">来陪我呀 · 30分</option><option value="available:60">来陪我呀 · 60分</option></select></label><button id="wake" type="button" aria-pressed="false" title="开启本地中文唤醒，麦克风会持续在本机听唤醒词">叫名字</button><small id="presence-note">我在身边，想聊就叫我</small></div>
    <div id="messages" role="log" aria-live="polite"></div>
    <div id="attachments" hidden aria-label="待发送附件"></div>
    <input id="file-picker" type="file" accept="image/*,video/*" multiple hidden>
    <div id="status" role="status">正在连接应用…</div>
    <div id="tools-bar"><label id="network-access" hidden><input id="network-enabled" type="checkbox">联网</label><button id="tools-center" type="button" hidden>✦ 工具中心</button><span id="tools-state">查看可用能力</span><button id="stop-turn" type="button" hidden>停止本轮</button></div>
    <div id="tool-activity" aria-live="polite" hidden></div>
    <button id="reminder-notice" type="button" hidden title="到工具中心查看或标记已读"></button>
    <form><textarea id="input" rows="2" maxlength="16000" placeholder="想说什么，都可以告诉我…" aria-label="消息"></textarea><button id="dictate" type="button" title="点击录音转文字，再点取消" aria-label="录音转文字">●</button><button id="call" type="button" title="开始或结束语音通话" aria-label="语音通话">☎</button><button id="send" type="submit" aria-label="发送消息">↑</button></form>
    <footer><select id="theme" aria-label="切换聊天主题"><option value="lilac">丁香紫</option><option value="rose">樱花粉</option><option value="mint">薄荷绿</option><option value="night">静夜</option><option value="paper">奶油纸笺</option></select><button id="pin" aria-pressed="true" title="保持常驻，不自动收起">保持常驻</button><button id="retry" hidden>重试</button></footer>
    <button id="resize" title="拖动调整聊天框大小" aria-label="拖动调整聊天框大小">◢</button>
    ${['n','s','e','w','nw','ne','sw'].map(edge => `<span class="resize-edge" data-edge="${edge}" aria-label="调整聊天框边缘"></span>`).join('')}
  </section>
  <aside id="poke-bubble" role="status" aria-live="polite" hidden></aside>
  <button id="handle" data-interactive title="拖动移动 · 点击聊天">✦</button>
  <button id="peek" data-interactive hidden title="桌宠已收起，靠近或点击展开">✦ 桌宠在这里</button>`
const $ = id => document.getElementById(id)
const autoTts = document.createElement('button')
autoTts.id = 'auto-tts'; autoTts.type = 'button'; autoTts.textContent = '自动播放 TTS'
autoTts.setAttribute('aria-pressed', 'false'); autoTts.title = '开启后自动朗读新回复；关闭时可点 ♪ 单次朗读'
document.querySelector('#presence-bar').append(autoTts)
const pokeToggle = document.createElement('button')
pokeToggle.id = 'poke-model'; pokeToggle.type = 'button'; pokeToggle.textContent = '触碰联动应用'
pokeToggle.title = '开启后双击触碰会发送到当前私聊/群聊并调用大模型；关闭时仅显示预设台词'
pokeToggle.setAttribute('aria-pressed', 'false')
document.querySelector('footer').append(pokeToggle)
pokeToggle.onclick = async () => {
  pokeToggle.disabled = true
  try { const s = await bridge.pokeModel(state?.settings.poke_to_chat !== true); if (state) state.settings = s; pokeToggle.setAttribute('aria-pressed', String(s.poke_to_chat === true)) }
  catch (e) { status(e.message, true) } finally { pokeToggle.disabled = false }
}
let pokeTimer, singleTapTimer, pokeRequest = null, pokeText = '', pokeLine = 0, lastPoke = 0
const localPokes = new Map()
function pokeRows() { return localPokes.get(state?.session.session_id) || new Map() }
function hidePoke() { clearTimeout(pokeTimer); $('poke-bubble').hidden = true; bridge.speechVisible(false); updateEngaged() }
function showPoke(text, wait = false) {
  if (state) {
    const rows = pokeRows()
    const ids = state.session.mode === 'group' ? state.session.character_ids : [state.character.id]
    const members = (state.characters || [state.character]).filter(c => !ids || ids.includes(c.id))
    rows.set(`poke-${lastPoke}`, { id: `poke-${lastPoke}`, role: 'assistant', content: text,
      segments: members.map(c => ({ character_id: c.id, speaker: c.name, text })) })
    localPokes.set(state.session.session_id, rows)
    // Bound transient local reactions; these never enter shared history.
    if (rows.size > 20) rows.delete(rows.keys().next().value)
    if (open) { hidePoke(); render(state.session.items); $('messages').scrollTop = $('messages').scrollHeight; return }
  }
  if (!visible || folded) return
  clearTimeout(pokeTimer)
  const content = document.createElement('div'); content.className = 'poke-text'; content.textContent = text
  $('poke-bubble').replaceChildren(content); $('poke-bubble').hidden = false
  bridge.speechVisible(true); updateEngaged()
  if (!wait) pokeTimer = setTimeout(hidePoke, 8000)
}
autoTts.onclick = async () => {
  autoTts.disabled = true
  try {
    const settings = await bridge.autoSpeak(state?.settings.auto_speak !== true)
    if (state) state.settings = settings
    autoTts.setAttribute('aria-pressed', String(settings.auto_speak === true))
    if (settings.auto_speak !== true) stopSpeak()
  } catch (e) { status(e.message || '自动播放设置保存失败', true) }
  finally { autoTts.disabled = false }
}
function showPresence(value) {
  if (!value) return
  const select = $('presence')
  if (value.mode !== 'available') select.value = value.mode
  else if (!select.value.startsWith('available:')) select.value = 'available:30'
  $('presence-note').textContent = `${value.label} · ${value.reason}。已确认提醒照常。`
  $('presence-note').title = $('presence-note').textContent
}
bridge.onPresence(showPresence)
$('presence').onchange = async () => {
  const [mode, duration] = $('presence').value.split(':')
  try { showPresence(await bridge.setPresence({ mode, minutes: Number(duration) || 30 })) }
  catch (error) { status(error.message || '在场状态未能保存，请重试', true) }
}
let state, model, modelKey, busy = false, pending = null, cursor = { x: -100, y: -100 }, dragging = false, pointer = null
let open = true, visible = true, booting = false, lastSignature = '', lastHit, bootGeneration = 0
let streamRows = [], streamText = '', speechGeneration = 0, audio, audioUrl, audioContext, audioSource, analyser, samples, mouth = 0, speaking = false
let switching = false, resizing = false, bubbleSize = { width: 488, height: 360 }
let vrm, folded = false
let attachments = [], changingModel = false
let petVoice = null, voiceKind = '', silenceTimer = 0, voiceStarting = false, voiceAttempt = 0
let wakeListener = null, wakeWanted = false, wakeStarting = false, wakeTimer = 0, wakeEpoch = 0, wokeCall = false
function stopWake() { ++wakeEpoch; wakeListener?.close(); wakeListener = null; wakeStarting = false }
async function resumeWake() {
  if (!wakeWanted || !visible || wakeListener || wakeStarting || petVoice || voiceStarting || speaking || busy) return
  wakeStarting = true; const epoch = ++wakeEpoch
  try {
    const caps = await bridge.wakeConfig()
    if (!wakeWanted || epoch !== wakeEpoch) return
    if (!caps.ready) throw new Error('中文唤醒模型尚未就绪')
    const listener = wakeListener = new PetWake(event => {
      if (wakeListener !== listener) return
      if (event.type === 'ready') status('我听着呢，叫“助手在吗”或“助手助手”就来。')
      if (event.type === 'wake') {
        stopWake(); setOpen(true); status('在呢，想说什么？'); wokeCall = true
        void beginVoice('call').then(() => { if (petVoice && wokeCall) armWakeTimeout(8000); else { wokeCall = false; void resumeWake() } })
      }
      if (event.type === 'error') { wakeWanted = false; stopWake(); $('wake').setAttribute('aria-pressed', 'false'); status(event.message, true) }
    })
    await listener.start()
    if (epoch !== wakeEpoch || !wakeWanted) listener.close()
  } catch (e) { if (epoch === wakeEpoch) { wakeWanted = false; stopWake(); $('wake').setAttribute('aria-pressed', 'false'); status(e.message || '名字唤醒暂时不可用', true) } }
  finally { if (epoch === wakeEpoch) wakeStarting = false }
}
function armWakeTimeout(ms) {
  clearTimeout(wakeTimer)
  wakeTimer = setTimeout(() => { if (wokeCall) { endVoice('我继续陪着，想聊再叫我。'); void resumeWake() } }, ms)
}
$('wake').onclick = async () => {
  wakeWanted = !wakeWanted; $('wake').setAttribute('aria-pressed', String(wakeWanted))
  if (!wakeWanted) { stopWake(); if (wokeCall) endVoice('名字唤醒已关，想聊可以点语音。') }
  else { stopSpeak(); await resumeWake() }
}
bridge.onSocial(async value => {
  if (busy || petVoice || state?.session.session_id !== value.session_id || state?.session.persona_id !== value.persona_id) return
  await bootstrap(); status('来陪你说句话，不着急回我呀。')
})
bridge.onSocialError(value => { if (!busy && !petVoice) status(value, true) })
const drafts = new Map()
function endVoice(note = '') { ++voiceAttempt; voiceStarting = false; clearTimeout(silenceTimer); clearTimeout(wakeTimer); wokeCall = false; petVoice?.close(); petVoice = null; voiceKind = ''; $('dictate').classList.remove('active'); $('call').classList.remove('active'); updateEngaged(); if (note) status(note); if (wakeWanted && visible) setTimeout(() => void resumeWake(), 1000) }
async function beginVoice(kind) {
  if (petVoice || voiceStarting) { endVoice(kind === voiceKind ? '已取消录音。' : '已结束语音。'); return }
  if (busy || switching) return
  stopWake()
  voiceStarting = true; voiceKind = kind; const attempt = ++voiceAttempt, draft = $('input').value
  stopSpeak(); updateEngaged(); status('正在连接本地语音…')
  try {
    const caps = await bridge.voiceConfig(), provider = caps.kokoro_ready ? 'kokoro' : caps.cosyvoice_ready ? 'cosyvoice' : caps.piper_voices?.length ? 'piper' : ''
    if (attempt !== voiceAttempt) return
    if (kind === 'call' && !provider) throw new Error('没有可用的本地语音合成服务')
    voiceKind = kind; let heard = false, activePackets = 0
    const voice = petVoice = new PetVoice(event => {
      if (petVoice !== voice) return
      if (event.type === 'ready') { status(kind === 'dictate' ? '正在听，识别结果会填入输入框…' : '语音通话中…'); if (kind === 'dictate') silenceTimer = setTimeout(() => { if (!heard) endVoice('没有听到语音，已自动取消。') }, 3000) }
      if (event.type === 'microphone-level' && kind === 'dictate' && !heard) {
        activePackets = event.rms >= .018 ? activePackets + 1 : 0
        if (activePackets >= 2) { heard = true; clearTimeout(silenceTimer); status('正在听，等你说完后转成文字…') }
      }
      if (event.type === 'transcript' && event.text) { heard = true; clearTimeout(silenceTimer); if (wokeCall) armWakeTimeout(120000); if (kind === 'dictate') { $('input').value = (draft ? draft + '\n' : '') + event.text; updateEngaged(); if (event.final) endVoice('语音已转成文字，请确认后发送。') } }
      if (event.type === 'history') void bootstrap()
      if (event.type === 'synthesizing') status('正在准备声音…')
      if (event.type === 'audio-start') status('正在说…')
      if (event.type === 'done') { status('语音通话中…'); if (wokeCall) armWakeTimeout(25000) }
      if (event.type === 'fatal' || event.type === 'error') endVoice(event.message || '语音暂时不可用')
    })
    const voiceId = provider === 'kokoro' ? caps.kokoro_speakers[0] : provider === 'cosyvoice' ? caps.cosyvoice_speakers[0] : caps.piper_voices?.[0] || ''
    await voice.start({ kind, provider, voice: voiceId, playback: 'smooth' })
    if (attempt !== voiceAttempt) { voice.close(); return }
    voiceStarting = false
    $(kind === 'call' ? 'call' : 'dictate').classList.add('active')
  } catch (e) { if (attempt === voiceAttempt) { endVoice(); status(e.message || '无法使用麦克风', true) } }
}
const app = new PIXI.Application({ view: $('stage'), resizeTo: window, backgroundAlpha: 0, antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true })
const modelSelect = document.createElement('select'); modelSelect.id = 'model-choice'; modelSelect.setAttribute('aria-label', '切换桌宠模型')
const emptyModel = document.createElement('option'); emptyModel.value = ''; emptyModel.textContent = '未添加模型'; modelSelect.append(emptyModel)
document.querySelector('footer').prepend(modelSelect)
const addModel = document.createElement('button'); addModel.type = 'button'; addModel.id = 'add-model'; addModel.textContent = '添加模型'; addModel.title = '选择已获授权的本地 .model3.json 或 .vrm；不会上传或复制素材'
document.querySelector('footer').append(addModel)
addModel.onclick = async () => {
  if (busy || changingModel) return
  changingModel = true; addModel.disabled = true
  try { const next = await bridge.chooseModel(); if (next) await applyState(next) }
  catch (e) { status(e.message, true) }
  finally { changingModel = false; addModel.disabled = false }
}
const expressionSelect = document.createElement('select')
expressionSelect.id = 'expression-choice'; expressionSelect.setAttribute('aria-label', '切换Live2D表情'); expressionSelect.title = '模型原生表情与通用表情；默认可恢复'
document.querySelector('footer').append(expressionSelect)
const overlayToggle = document.createElement('button')
overlayToggle.id = 'model-overlay'; overlayToggle.type = 'button'; overlayToggle.textContent = '模型水印'; overlayToggle.title = '使用模型作者提供的水印隐藏表情，独立于脸部表情'
document.querySelector('footer').append(overlayToggle)
overlayToggle.onclick = () => { expressions?.setOverlay(!expressions.overlayEnabled); expressionOptions() }
let expressions = null
function expressionOptions() {
  const choices = expressions?.choices || [{ id: '', name: 'Live2D 表情' }]
  expressionSelect.replaceChildren(...choices.map(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; return o }))
  expressionSelect.disabled = !expressions
  expressionSelect.value = expressions?.selected || ''
  overlayToggle.hidden = !expressions?.hasOverlayToggle
  overlayToggle.setAttribute('aria-pressed', String(expressions?.overlayEnabled === true))
  overlayToggle.textContent = expressions?.overlayEnabled ? '模型水印：隐藏' : '模型水印：显示'
}
expressionSelect.onchange = async () => {
  const current = expressions
  expressionSelect.disabled = true
  try { await current?.select(expressionSelect.value) }
  catch (e) { status(e.message, true) }
  finally { expressionOptions() }
}
expressionOptions()
const attachButton = document.createElement('button'); attachButton.type = 'button'; attachButton.id = 'attach'; attachButton.textContent = '＋'; attachButton.title = '添加附件，也可直接粘贴（最多10张图片 / 1个视频）'; attachButton.setAttribute('aria-label', '添加附件'); document.querySelector('form').prepend(attachButton)
attachButton.onclick = () => $('file-picker').click()
function renderAttachments() {
  const box = $('attachments'); box.replaceChildren(); box.hidden = !attachments.length
  for (const item of attachments) {
    const card = document.createElement('div'); card.className = 'attachment'
    if (item.kind === 'image') { const img = document.createElement('img'); img.src = item.url; img.alt = item.file.name; card.append(img) }
    if (item.kind === 'video') { const video = document.createElement('video'); video.src = item.url; video.controls = true; video.preload = 'metadata'; card.append(video) }
    const name = document.createElement('span'); name.textContent = item.file.name || item.kind
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `移除 ${item.file.name}`); remove.onclick = () => { if (busy) return; URL.revokeObjectURL(item.url); attachments = attachments.filter(a => a !== item); pending = null; renderAttachments() }
    card.append(name, remove); box.append(card)
  }
  if (attachments.length) { const note = document.createElement('small'); note.textContent = '将与文字一起发送；视频抽帧，不识别音轨。'; box.append(note) }
  updateEngaged()
}
function addFiles(files) {
  if (busy) { status('请等本轮回复结束再粘贴附件。', true); return }
  const incoming = Array.from(files).map(file => ({ file, kind: file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'pdf' : null }))
  if (incoming.some(a => a.kind === 'pdf')) { status('PDF 暂不支持发送，请改发图片。', true); return }
  const all = [...attachments, ...incoming]
  if (!incoming.length) return
  if (incoming.some(a => !a.kind) || !(all.every(a => a.kind === 'image') && all.length <= 10 || all.length === 1 && ['video', 'pdf'].includes(all[0].kind))) { status('每次最多10张图片，或1个视频；请先移除其他附件。', true); return }
  if (incoming.some(a => a.file.size > (a.kind === 'video' ? 50 : 20) * 1024 * 1024)) { status('图片暂限20MB，视频50MB、15秒。', true); return }
  attachments.push(...incoming.map(a => ({ ...a, url: URL.createObjectURL(a.file) }))); pending = null; renderAttachments(); status('附件已添加，可以输入描述后一起发送。')
}
$('file-picker').onchange = () => { addFiles($('file-picker').files); $('file-picker').value = '' }
$('input').addEventListener('paste', e => { const files = Array.from(e.clipboardData?.files || []); if (files.length) { e.preventDefault(); addFiles(files) } })
modelSelect.onchange = async () => {
  if (busy || changingModel) { modelSelect.value = state?.settings.model || ''; return }
  changingModel = true; modelSelect.disabled = true; ++bootGeneration
  try { if (modelSelect.value) await applyState(await bridge.model(modelSelect.value)) }
  catch (e) { modelSelect.value = state?.settings.model || ''; status(e.message, true) }
  finally { changingModel = false; modelSelect.disabled = false }
}
app.ticker.maxFPS = 60
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error) }
function setOpen(value) { clearTimeout(singleTapTimer); open = value; $('bubble').hidden = !value; if (value) hidePoke(); bridge.bubbleOpen(value); layout(); if (!value) { stopSpeak(); endVoice() } if (value) { render(state?.session.items); void bootstrap(); setTimeout(() => $('input').focus(), 50) } }
function appearance(s) {
  pokeToggle.setAttribute('aria-pressed', String(s.poke_to_chat === true))
  modelSelect.value = s.model || ''
  $('pin').textContent = s.dock_auto_hide === true ? '自动收起' : '保持常驻'
  $('pin').setAttribute('aria-pressed', String(s.dock_auto_hide !== true))
  $('pin').title = s.dock_auto_hide === true ? '停靠后离开约 3 秒收起；点击改为保持常驻' : '保持常驻，不自动收起；点击启用自动收起'
  const root = document.documentElement.style
  root.setProperty('--chat-size', `${Math.max(11, Math.min(20, Number(s.font_size) || 13))}px`)
  root.setProperty('--bubble-alpha', String(Math.max(.65, Math.min(1, Number(s.bubble_opacity) || .98))))
  bubbleSize = { width: Math.max(340, Math.min(760, Number(s.bubble_width) || 488)), height: Math.max(260, Math.min(620, Number(s.bubble_height) || 360)) }
  root.setProperty('--bubble-width', `${bubbleSize.width}px`)
  root.setProperty('--bubble-height', `${bubbleSize.height}px`)
  document.documentElement.dataset.theme = ['rose', 'mint', 'night', 'paper'].includes(s.theme) ? s.theme : 'lilac'
  $('theme').value = document.documentElement.dataset.theme
}
function stopSpeak() {
  speechGeneration++; bridge.stopSpeech(); speaking = false; mouth = 0
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null }
  if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null }
  audioSource?.disconnect(); analyser?.disconnect(); audioSource = null; analyser = null
  $('speak').textContent = '♪'; $('speak').title = '朗读最后一条回复'; $('speak').setAttribute('aria-label', '朗读最后一条回复')
}
async function speak(row) {
  stopWake()
  stopSpeak()
  if (!row) return
  const generation = speechGeneration
  const text = (row.segments?.length ? row.segments.map(s => `${s.speaker}：${s.text}`).join('\n') : row.content || '').replace(/\*\*/g, '').trim()
  if (!text) return
  speaking = true; $('speak').textContent = '■'; $('speak').title = '停止朗读'; $('speak').setAttribute('aria-label', '停止朗读')
  try {
    // Resume during the click gesture; autoplay after a user-sent turn is also supported.
    audioContext ||= new AudioContext()
    await audioContext.resume()
    const result = await bridge.tts(text.slice(0, 16000))
    if (generation !== speechGeneration) return
    audioUrl = URL.createObjectURL(new Blob([result.bytes], { type: result.type }))
    audio = new Audio(audioUrl)
    audio.volume = Math.max(0, Math.min(1, Number(state?.settings.voice_volume ?? .8)))
    analyser = audioContext.createAnalyser(); analyser.fftSize = 256; samples = new Uint8Array(analyser.fftSize)
    audioSource = audioContext.createMediaElementSource(audio); audioSource.connect(analyser); analyser.connect(audioContext.destination)
    audio.onended = () => { if (generation === speechGeneration) stopSpeak() }
    audio.onerror = () => { if (generation === speechGeneration) { stopSpeak(); status('音频播放失败，文字回复已保留', true) } }
    await audio.play()
  } catch (e) { if (generation === speechGeneration) { stopSpeak(); status(e.message || '朗读暂时不可用', true) } }
}
app.ticker.add(() => {
  let target = 0
  if (speaking && audio && !audio.paused && analyser) {
    analyser.getByteTimeDomainData(samples)
    let energy = 0; for (const value of samples) energy += ((value - 128) / 128) ** 2
    target = Math.min(1, Math.sqrt(energy / samples.length) * 5)
  }
  mouth += (target - mouth) * .5
}, undefined, 100)
bridge.onDelta(data => {
  if (pokeRequest && data.request_id === pokeRequest.request_id) { pokeText += data.text; showPoke(pokeText, true); return }
  if (!busy || data.request_id !== pending?.request_id) return
  streamText += data.text
  render([...streamRows, { role: 'assistant', content: streamText }])
  status('正在回复你…')
  $('messages').scrollTop = $('messages').scrollHeight
})
bridge.onProgress(data => { if (pokeRequest && data.request_id === pokeRequest.request_id) showPoke('还在等回应…', true); else if (busy && data.request_id === pending?.request_id) status(data.text) })
const toolNames = { web_search: '联网搜索', knowledge_search: '查个人知识资料', knowledge_read: '展开笔记出处', knowledge_propose: '补充知识草案', project_cost_record: '记录项目费用', project_cost_query: '查询项目费用', daily_life_record: '记录饮食运动', daily_life_query: '查询饮食运动', reminder_draft: '提醒草稿' }
bridge.onReminders(data => {
  const items = data.items || [], button = $('reminder-notice')
  button.hidden = !items.length
  button.textContent = items.length ? `✦ 到时间了：${items[0].title}${items.length > 1 ? `（共 ${items.length} 条）` : ''}` : ''
})
$('reminder-notice').onclick = () => bridge.openTools()
bridge.onTool(data => {
  if (!busy || data.request_id !== pending?.request_id) return
  const box = $('tool-activity'); box.hidden = false
  const label = toolNames[data.name] || '工具'
  if (data.type === 'agent_status') status('正在判断下一步…')
  if (data.type === 'tool_start') { box.textContent = `${label} · 正在执行…`; status('正在调用工具…') }
  if (data.type === 'tool_result') box.textContent = `${label} · ${data.ok ? '成功' : `未完成（${data.code}）`}`
  if (data.type === 'agent_guard') box.textContent = '已触发执行保护，停止继续调用。'
  if (data.type === 'agent_end' && !box.textContent) box.textContent = '本轮已完成，未调用工具。'
})
function render(rows = []) {
  rows = [...rows, ...pokeRows().values()]
  const signature = JSON.stringify(rows)
  if (signature === lastSignature) return
  lastSignature = signature
  const box = $('messages'), nearEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 45
  box.replaceChildren()
  if (!rows.length) { const el = document.createElement('p'); el.className = 'welcome'; el.textContent = '我在这里。\n今天想聊点什么？'; box.append(el) }
  for (const row of rows.slice(-30)) {
    const segments = row.role === 'user' ? [{ text: row.content || (row.image ? '[图片，请到应用查看]' : ''), speaker: '我' }] : replySegments(row, state?.character.name)
    for (const segment of segments) {
      const el = document.createElement('div'); el.className = `message ${row.role === 'user' ? 'mine' : 'hers'}`
      const who = row.role === 'user' ? state?.persona : state?.characters?.find(c => c.id === segment.character_id || c.name === segment.speaker) || state?.character
      const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = who?.emoji || (row.role === 'user' ? '我' : '✦')
      if (who?.avatar?.startsWith('/api/files/characters/')) { const img = document.createElement('img'); img.src = who.avatar; img.alt = who.name; img.onerror = () => img.remove(); avatar.append(img) }
      const body = document.createElement('div'), name = document.createElement('small'), text = document.createElement('div')
      name.textContent = row.role === 'user' ? who?.name || '我' : segment.speaker || who?.name || '助手'; text.textContent = segment.text
      body.append(name, text); el.append(avatar, body); box.append(el)
      for (const url of (row.frames?.length ? row.frames : row.image && !/\.(mp4|mov|webm|mkv)$/i.test(row.image) ? [row.image] : [])) {
        if (!url.startsWith('/api/files/')) continue
        const image = document.createElement('img'); image.src = url; image.alt = '聊天附件'; image.style.cssText = 'max-width:100%;max-height:150px;border-radius:8px;margin-top:6px'; body.append(image)
      }
    }
  }
  if (nearEnd || rows.length < 4) box.scrollTop = box.scrollHeight
}
async function core() {
  if (window.Live2DCubismCore) return
  await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = '/vendor/live2dcubismcore.min.js'; script.onload = resolve; script.onerror = () => reject(new Error('本机 Cubism Core 未能加载')); document.head.append(script) })
}
function layout() {
  if (companionPlacement) {
    const { actor: a, bubble: b, direction } = companionPlacement
    const speech = companionPlacement.speech
    if (speech) {
      Object.assign($('poke-bubble').style, { left: `${speech.x}px`, top: `${speech.y}px`, width: `${speech.width}px`, maxHeight: `${speech.height}px` })
      $('poke-bubble').dataset.side = speech.side
    }
    Object.assign($('bubble').style, { left: `${b.x}px`, top: `${b.y}px`, right: 'auto', transform: 'none', width: `${b.width}px`, height: `${b.height}px` })
    $('bubble').dataset.direction = direction
    if (vrm) vrm.resize(innerWidth, innerHeight, a.height, null, open, a)
    if (model?._petBounds) {
      const bounds = model._petBounds, factor = Math.min(a.width / bounds.width, a.height / bounds.height)
      model.scale.set(factor)
      model.position.set(a.x + (a.width - bounds.width * factor) / 2 - bounds.x * factor, a.y + a.height - (bounds.y + bounds.height) * factor)
    }
    const handle = companionPlacement.handle
    Object.assign($('handle').style, { left: `${handle.x}px`, top: `${handle.y}px`, bottom: 'auto' })
    return
  }
  const factor = Math.max(.15, Math.min(3, Number(state?.settings.scale) || 1))
  if (vrm) vrm.resize(innerWidth, innerHeight, Math.min(innerHeight - 40, Math.min(432, Math.max(120, innerHeight - Math.min(bubbleSize.height, innerHeight - 180) - 60)) * factor), dockSide, open)
  if (!model?._petBounds) return
  const b = model._petBounds, w = app.screen.width, h = app.screen.height
  const scale = 420 * factor / b.height
  model.scale.set(scale)
  const x = dockSide === 'left' ? 5 - b.x * scale : dockSide === 'right' ? w - 5 - (b.x + b.width) * scale : w * .55 - (b.x + b.width / 2) * scale
  const y = dockSide === 'top' && !open ? 5 - b.y * scale : h - 5 - (b.y + b.height) * scale
  model.position.set(x, y)
  $('handle').style.left = `${Math.max(4, Math.min(w - 42, x + (b.x + b.width / 2) * scale - 19))}px`
}
async function loadModel() {
  const key = state?.settings.model || ''
  const selected = state?.models?.find(m => m.id === key)
  if (modelKey === key && selected && (model || vrm)) { layout(); return }
  modelKey = key
  expressions = null; expressionOptions()
  try {
    if (vrm) { vrm.destroy(); vrm = null }
    if (model) { app.stage.removeChild(model); model.destroy({ children: true, texture: true, baseTexture: true }); model = null }
    if (!selected) {
      $('stage').hidden = true; $('vrm-stage').hidden = true
      layout(); status('未添加模型。请点击“添加模型”，选择自行下载并获授权的 Live2D 或 VRM 文件。')
      return
    }
    const isVrm = selected.kind === 'vrm'
    $('stage').hidden = isVrm; $('vrm-stage').hidden = !isVrm
    if (isVrm) {
      const { createVrm } = await import('./vrm.js')
      const next = await createVrm($('vrm-stage'), selected.url)
      if (modelKey !== key) { next.destroy(); return }
      vrm = next; bridge.actorRatio(vrm.ratio); layout(); return
    }
    await core()
    const { Live2DModel, config } = await import('pixi-live2d-display/cubism4')
    // Touch uses animation only; never play unrelated prerecorded model audio.
    config.sound = false
    const url = selected.url
    const next = await Live2DModel.from(url, { ticker: app.ticker, autoHitTest: false, autoFocus: false })
    if (modelKey !== key) { next.destroy({ children: true, texture: true, baseTexture: true }); return }
    if (model) { app.stage.removeChild(model); model.destroy({ children: true, texture: true, baseTexture: true }) }
    configureLive2DRendering(next)
    model = next; app.stage.addChild(model)
    configureVtsInputs(next)
    const mouthMapping = next.internalModel.settings.json.PetCompatibility?.parameterSettings?.find(p => p.Input === 'MouthOpen')
    model.internalModel.on('beforeModelUpdate', () => {
      if (speaking || mouth > .001) {
        const value = mouthMapping ? mapTracking(mouth, mouthMapping) : mouth
        if (value !== null) next.internalModel.coreModel.setParameterValueById(mouthMapping?.OutputLive2D || 'ParamMouthOpenY', value)
      }
    })
    expressions = createExpressions(next, key)
    try { await expressions.select(expressions.saved()) } catch (e) { status(`表情恢复失败：${e.message}`, true) }
    expressionOptions()
    // Capture unscaled local bounds once. Animated poses must not refit the window each frame.
    model._petBounds = model.getLocalBounds().clone(); bridge.actorRatio(model._petBounds.width / model._petBounds.height); layout()
  } catch (e) { modelKey = null; status(`角色加载失败：${e.message}`, true) }
}
async function bootstrap() {
  if (booting || busy || switching || resizing || changingModel) return
  booting = true
  const generation = ++bootGeneration
  try {
    const next = await bridge.bootstrap()
    if (generation !== bootGeneration || busy || switching || resizing || changingModel) return
    await applyState(next)
  } catch (e) { status(`暂时连不上应用：${e.message}`, true); $('retry').hidden = false }
  finally { booting = false }
}
async function applyState(next) {
  if (state?.session.session_id !== next.session.session_id) {
    if (state) drafts.set(state.session.session_id, { text: $('input').value, pending, attachments })
    const draft = drafts.get(next.session.session_id)
    $('input').value = draft?.text || ''; pending = draft?.pending || null
    attachments = draft?.attachments || []; renderAttachments()
    $('retry').hidden = !pending; lastSignature = ''; stopSpeak()
  }
  if (state?.settings.auto_speak && !next.settings.auto_speak) stopSpeak()
  if (next.placement) companionPlacement = next.placement
  dockSide = next.dockEdge ?? null; document.documentElement.dataset.dock = dockSide || ''
  modelSelect.replaceChildren(...[{ id: '', name: '未选择模型' }, ...(next.models || [])].map(item => {
    const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; option.disabled = !item.id; return option
  }))
  state = next; appearance(next.settings); showPresence(next.presence)
  autoTts.setAttribute('aria-pressed', String(next.settings.auto_speak === true))
  void bridge.toolsState().then(value => {
    $('tools-center').hidden = !value.expert
    $('network-access').hidden = !value.installed
    $('network-enabled').checked = value.expert ? !!value.networkEnabled : !!value.enabled
    $('tools-state').textContent = value.expert ? (value.enabled ? `已开启 ${value.count} 项能力` : '工具未开启') : ''
  }).catch(() => { $('tools-center').hidden = true; $('network-access').hidden = true; $('tools-state').textContent = '' })
  updateEngaged()
  $('name').textContent = next.session.mode === 'group' ? '群聊' : next.character.name
  $('session').textContent = `${next.session.mode === 'group' ? '群聊' : '私聊'} · 与应用同步`
  const choices = [{ id: 'group', name: '群聊' }, ...(next.characters || [next.character]).map(c => ({ id: `single:${c.id}`, name: `私聊 · ${c.name}` }))]
  $('conversation').replaceChildren(...choices.map(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; return o }))
  $('conversation').value = next.session.mode === 'group' ? 'group' : `single:${next.character.id}`
  render(next.session.items)
  if (!pending && !speaking) status(next.session.configured ? '我在，慢慢说。' : '请先在应用配置大脑 API', !next.session.configured)
  await loadModel()
}
$('conversation').onchange = async () => {
  if (busy || switching || !state) return
  const choice = $('conversation').value
  switching = true; ++bootGeneration; stopSpeak(); endVoice()
  $('conversation').disabled = true; $('send').disabled = true; $('input').disabled = true
  status('正在切换聊天…')
  try { await applyState(await bridge.selectSession({ mode: choice === 'group' ? 'group' : 'single', character: choice === 'group' ? state.character.id : choice.slice(7) })) }
  catch (e) { $('conversation').value = state.session.mode === 'group' ? 'group' : `single:${state.character.id}`; status(e.message, true) }
  finally { switching = false; $('conversation').disabled = false; $('send').disabled = false; $('input').disabled = false }
}
async function resizeBubble(width, height, save = true, edge = '') {
  const size = await bridge.resizeBubble({ width, height, save, edge })
  appearance({ ...state?.settings, ...size })
  if (state && save) Object.assign(state.settings, size)
}
for (const [id, direction] of [['smaller', -1], ['larger', 1]]) $(id).onclick = async () => {
  if (resizing) return
  resizing = true; ++bootGeneration
  try { await resizeBubble(bubbleSize.width + direction * 60, bubbleSize.height + direction * 50) }
  catch (e) { status(e.message, true) } finally { resizing = false }
}
$('dock').onchange = async () => { const edge = $('dock').value; $('dock').value = ''; if (edge) try { await bridge.dock(edge) } catch (e) { status(e.message, true) } }
$('theme').onchange = async () => { try { const s = await bridge.theme($('theme').value); if (state) state.settings = s; appearance(s); lastSignature = ''; render(state?.session.items) } catch (e) { status(e.message, true) } }
$('pin').onclick = async () => {
  $('pin').disabled = true
  try { const s = await bridge.autoHide(state?.settings.dock_auto_hide !== true); if (state) state.settings = s; appearance(s); status(s.dock_auto_hide ? '自动收起已开启：停靠后离开约 3 秒，靠近边缘标签展开。' : '已保持常驻，不会自动消失。') }
  catch (e) { status(e.message, true) } finally { $('pin').disabled = false }
}
$('peek').onclick = () => bridge.reveal()
function updateEngaged() { bridge.engaged(!$('poke-bubble').hidden || !!petVoice || voiceStarting || attachments.length > 0 || document.activeElement === $('input') && !!$('input').value.trim()) }
document.addEventListener('focusin', updateEngaged)
document.addEventListener('focusout', () => setTimeout(updateEngaged, 0))
$('input').addEventListener('input', updateEngaged)
bridge.onFold(({ folded: value, edge }) => { folded = value; lastHit = undefined; $('peek').hidden = !value; $('peek').dataset.edge = edge || 'bottom'; document.documentElement.classList.toggle('folded', value); if (value) { app.stop(); stopSpeak() } else if (visible) { app.start(); void bootstrap() } })
app.ticker.add(() => { if (vrm && !folded) vrm.update(Math.min(app.ticker.deltaMS / 1000, .05), mouth) })
let dockSide = null
let companionPlacement = null
bridge.onPlacement(value => { companionPlacement = value; displayChanged() })
bridge.onDock(edge => { dockSide = edge; document.documentElement.dataset.dock = edge || ''; layout() })
let scaleSaveTimer
for (const target of [$('stage'), $('vrm-stage'), $('handle')]) target.addEventListener('wheel', e => {
  if (!state || folded || !e.deltaY) return
  e.preventDefault()
  const value = Math.round(Math.max(.15, Math.min(3, (Number(state.settings.scale) || 1) + (e.deltaY < 0 ? .05 : -.05))) * 100) / 100
  ++bootGeneration
  state.settings.scale = value
  $('handle').title = `拖动移动 · 点击聊天 · 滚轮缩放 ${Math.round(value * 100)}%`
  clearTimeout(scaleSaveTimer)
  scaleSaveTimer = setTimeout(() => { void bridge.scale(value).catch(error => status(error.message, true)) }, 200)
}, { passive: false })
window.addEventListener('contextmenu', e => { if (e.target.closest('textarea,input,.message')) return; e.preventDefault(); bridge.contextMenu() })
let resizePointer, resizeQueue = Promise.resolve(), resizeTarget, resizeRunning = false
for (const target of [$('resize'), ...document.querySelectorAll('.resize-edge')]) {
target.onpointerdown = e => {
  if (e.button !== 0 || resizing) return
  e.preventDefault(); resizing = true; ++bootGeneration
  resizePointer = { id: e.pointerId, x: e.screenX, y: e.screenY, ...bubbleSize, edge: target.dataset.edge || 'se' }
  target.setPointerCapture(e.pointerId)
}
target.onpointermove = e => {
  if (!resizePointer) return
  const edge = resizePointer.edge, dx = e.screenX - resizePointer.x, dy = e.screenY - resizePointer.y
  const width = resizePointer.width + (edge.includes('e') ? dx : edge.includes('w') ? -dx : 0), height = resizePointer.height + (edge.includes('s') ? dy : edge.includes('n') ? -dy : 0)
  resizeTarget = { width, height }
  if (resizeRunning) return
  resizeRunning = true
  resizeQueue = (async () => {
    try { while (resizeTarget) { const target = resizeTarget; resizeTarget = null; await resizeBubble(target.width, target.height, false, resizePointer?.edge) } }
    catch (e) { status(e.message, true) }
    finally { resizeRunning = false }
  })()
}
async function finishResize() {
  if (!resizePointer) return
  resizePointer = null
  await resizeQueue
  try { await resizeBubble(bubbleSize.width, bubbleSize.height) } catch (e) { status(e.message, true) }
  finally { resizing = false }
}
target.onpointerup = finishResize
target.onpointercancel = finishResize
target.onlostpointercapture = finishResize
}
async function send(retry = false) {
  if (busy || switching) return
  if (!state) { await bootstrap(); return }
  if (!state.character.id) { status('请先在应用创建并选择助手。', true); return }
  const text = retry && pending ? pending.caption : $('input').value.trim() || (attachments.length ? '请看看这些附件。' : '')
  if (!text) return
  stopSpeak(); endVoice()
  const retrying = pending && pending.caption === text && pending.session_id === state.session.session_id
  if (!retrying) pending = { text, caption: text, request_id: crypto.randomUUID(), session_id: state.session.session_id }
  busy = true; $('conversation').disabled = true; $('send').disabled = true; $('input').disabled = true; $('retry').hidden = true
  $('stop-turn').hidden = false; $('tool-activity').hidden = true; $('tool-activity').textContent = ''
  status('正在想怎么回答你…')
  streamText = ''; streamRows = [...(state.session.items || []), ...(retrying ? [] : [{ role: 'user', content: text }])]
  render(streamRows)
  try {
    if (!pending.prepared) {
      const images = [], notes = []; let attachment = ''
      for (const [index, item] of attachments.entries()) {
        status(`正在上传并解析附件 ${index + 1}/${attachments.length}…`)
        if (!item.prepared) item.prepared = await bridge.upload({ session_id: pending.session_id, name: item.file.name, type: item.file.type, bytes: new Uint8Array(await item.file.arrayBuffer()) })
        images.push(...item.prepared.images); if (item.prepared.text) notes.push(item.prepared.text)
        attachment = item.prepared.attachment || attachment
      }
      pending.images = images; pending.attachment = attachment
      const fullText = [text, ...notes].join('\n\n')
      if (fullText.length > 16000) throw new Error('文字加附件说明超过16000字，请缩短文字后发送。')
      pending.text = fullText; pending.prepared = true
    }
    status('正在想怎么回答你…')
    const result = await bridge.send(pending)
    const items = [...state.session.items]
    for (const row of [result.user, result.assistant]) if (row && !items.some(m => m.id === row.id)) items.push(row)
    state.session.items = items; render(items)
    pending = null; $('input').value = ''
    for (const item of attachments) URL.revokeObjectURL(item.url)
    attachments = []; renderAttachments()
    try { const history = await bridge.history(); state.session = history; render(history.items) } catch { /* Reply is already saved; the next refresh will catch up. */ }
    status('我在，慢慢说。')
    if (state.settings.auto_speak === true && open) void speak(result.assistant)
  } catch (e) {
    status(e.message, true); $('retry').hidden = false
    // The user message may already be saved. Keep the request id for safe retries.
    try { const history = await bridge.history(); if (history.session_id === state.session.session_id) { state.session = history; render(history.items) } } catch {}
  } finally { busy = false; $('stop-turn').hidden = true; $('conversation').disabled = false; $('send').disabled = false; $('input').disabled = false; $('input').focus(); updateEngaged() }
}
$('close').onclick = () => setOpen(false)
$('speak').onclick = () => speaking ? stopSpeak() : void speak(state?.session.items?.filter(m => m.role === 'assistant').at(-1))
$('home').onclick = () => bridge.openHome()
$('dictate').onclick = () => void beginVoice('dictate')
$('call').onclick = () => void beginVoice('call')
$('tools-center').onclick = () => bridge.openTools()
$('network-enabled').onchange = async () => {
  const input = $('network-enabled'); const enabled = input.checked; input.disabled = true
  try { await bridge.setNetwork(enabled) }
  catch (e) { input.checked = !enabled; status(e.message || '联网设置未能保存') }
  finally { input.disabled = false }
}
$('stop-turn').onclick = () => bridge.cancelSend()
$('retry').onclick = () => pending ? void send(true) : void bootstrap()
document.querySelector('form').onsubmit = e => { e.preventDefault(); void send() }
$('input').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send() } }
window.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false) })
bridge.onOpen(() => setOpen(true))
bridge.onCursor(p => { cursor = p; app.ticker.maxFPS = p.x >= 0 && p.y >= 0 && p.x < innerWidth && p.y < innerHeight ? 60 : 30; if (model) model.focus(p.x, p.y); if (vrm) { const inside = p.x >= 0 && p.y >= 0 && p.x < innerWidth && p.y < innerHeight; vrm.focus(inside ? p.x : innerWidth / 2, inside ? p.y : innerHeight / 2) } })
bridge.onVisibility(value => { visible = value; if (visible && !folded) app.start(); else { hidePoke(); app.stop(); stopWake(); stopSpeak(); endVoice() } })
function displayChanged() {
  const resolution = Math.min(devicePixelRatio, 2)
  if (app.renderer.resolution !== resolution) app.renderer.resolution = resolution
  app.renderer.resize(innerWidth, innerHeight)
  layout()
}
window.addEventListener('resize', displayChanged)
bridge.onDisplay(displayChanged)

async function touch() {
  if (Date.now() - lastPoke < 900) return
  lastPoke = Date.now()
  if (vrm) vrm.touch()
  showPoke(pokeLines[pokeLine++ % pokeLines.length])
  if (state?.settings.poke_to_chat !== true || busy || switching || changingModel || petVoice || voiceStarting) return
  const request = pokeRequest = { kind: 'poke', text: state.session.mode === 'group' ? '[桌宠互动] 我轻轻戳了戳在场的所有助手。' : '[桌宠互动] 我轻轻戳了戳你。', request_id: crypto.randomUUID(), session_id: state.session.session_id }
  busy = true; ++bootGeneration; pokeText = ''; stopWake()
  $('send').disabled = true; $('conversation').disabled = true; $('stop-turn').hidden = false
  showPoke('欸？让我想想怎么回应你…', true)
  try {
    const result = await bridge.send(request)
    const rows = [...state.session.items]
    for (const row of [result.user, result.assistant]) if (row && !rows.some(r => r.id === row.id)) rows.push(row)
    state.session.items = rows
    const reply = replySegments(result.assistant || { content: pokeText }, state.character.name).map(s => `${s.speaker}：${s.text}`).join('\n')
    if (!reply) throw new Error('本轮未收到可显示的回复；未自动重试')
    if (open) { pokeRows().delete(`poke-${lastPoke}`); render(rows); $('messages').scrollTop = $('messages').scrollHeight; hidePoke() }
    else { showPoke(reply || '我在呢。'); pokeRows().delete(`poke-${lastPoke}`) }
    if (state.settings.auto_speak === true && visible && !folded) void speak(result.assistant)
  } catch (e) { showPoke(`这次没接通：${e.message}（不会自动重试）`); status(e.message, true) }
  finally { pokeRequest = null; busy = false; $('send').disabled = false; $('conversation').disabled = false; $('stop-turn').hidden = true; updateEngaged() }
}
// 触摸事件的 screenX/screenY 在部分 Windows 驱动 / 合成事件下会是 0（实测 Electron 里确实如此）。
// 缺失时结合窗口位置和触点局部坐标恢复，避免依赖触屏上过期的鼠标光标。
function screenPoint(e) {
  let x = e.screenX, y = e.screenY
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) {
    // Touch drivers may omit screen coordinates. Derive them from the actual
    // window and local touch, rather than falling back to a stale mouse cursor.
    x = window.screenX + e.clientX; y = window.screenY + e.clientY
  }
  return { x, y, usable: Number.isFinite(x) && Number.isFinite(y) }
}
const pokeGesture = new PokeGesture()
// 触屏设备：没有鼠标光标，命中测试依赖的 pet:cursor 永远是过期值，
// 结果窗口一直保持「鼠标穿透」，手指戳下去直接穿过桌宠落到桌面。
// 有触摸能力时直接当作「始终可交互」，不走光标命中。
const touchUi = navigator.maxTouchPoints > 0
for (const target of [$('stage'), $('vrm-stage'), $('handle'), document.querySelector('header')]) {
  target.addEventListener('pointerdown', e => {
    // 只认第一根手指：平板上多点触控时，第二根手指 / 手掌边缘不该参与交互。
    if (e.button !== 0 || !e.isPrimary) return
    if (target.tagName === 'HEADER' && e.target.closest('button,select,input,textarea')) return
    clearTimeout(singleTapTimer); e.preventDefault()
    const point = screenPoint(e)
    pointer = { id: e.pointerId, x: point.x, y: point.y }
    pokeGesture.down(point.x, point.y, performance.now())
    try { target.setPointerCapture(e.pointerId) } catch { /* 合成事件/指针已失效时忽略 */ }
  })
  target.addEventListener('pointermove', e => {
    // ⚠ 必须校验 pointerId：之前任何一根手指的移动都会驱动窗口，
    // 平板上表现为拖拽时窗口在两个触点之间来回跳（「抽来抽去」）。
    if (!pointer || e.pointerId !== pointer.id) return
    const point = screenPoint(e)
    if (!dragging && pokeGesture.move(point.x, point.y)) { dragging = true; bridge.drag(true, e.pointerType === 'mouse' ? undefined : point) }
    else if (dragging && e.pointerType !== 'mouse') bridge.dragMove(point)
  })
  const release = e => {
    if (pointer && e.pointerId !== pointer.id) return
    const point = screenPoint(e)
    const tapped = pointer && !dragging, paired = pokeGesture.up(point.x, point.y, performance.now())
    const validClick = tapped && (paired || pokeGesture.tap)
    if (dragging) bridge.drag(false)
    dragging = false; pointer = null
    if (tapped && target === $('handle')) { pokeGesture.reset(); setOpen(!open) }
    else if (target.tagName === 'HEADER') pokeGesture.reset()
    else if (paired) void touch()
    else if (validClick && !open) singleTapTimer = setTimeout(() => setOpen(true), 420)
  }
  target.addEventListener('pointerup', release)
  const abandon = e => {
    if (pointer && e && e.pointerId !== undefined && e.pointerId !== pointer.id) return
    if (dragging) bridge.drag(false)
    dragging = false; pointer = null; pokeGesture.reset()
  }
  target.addEventListener('pointercancel', abandon)
  target.addEventListener('lostpointercapture', abandon)
}
// Sample a tiny patch of the actual rendered alpha, after Pixi renders. This also
// catches hair/clothes outside semantic Head/Body hit areas without a GPU readback of the full window.
const pixels = new Uint8Array(3 * 3 * 4)
app.ticker.add(() => {
  let hit = touchUi || !!pointer || dragging || resizing
  const { x, y } = cursor
  if (!hit && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight) {
    hit = !!document.elementFromPoint(x, y)?.closest('[data-interactive]')
    if (!hit && vrm) hit = vrm.hit(x, y)
    if (!hit && model) {
      const gl = app.renderer.gl, r = app.renderer.resolution
      const px = Math.max(1, Math.min(gl.drawingBufferWidth - 2, Math.floor(x * r)))
      const py = Math.max(1, Math.min(gl.drawingBufferHeight - 2, Math.floor(gl.drawingBufferHeight - y * r)))
      gl.readPixels(px - 1, py - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > (lastHit ? 10 : 35)) { hit = true; break }
    }
  }
  if (hit !== lastHit) { lastHit = hit; bridge.hit(hit) }
}, undefined, -100)
void loadModel()
void bootstrap()
setInterval(() => { if (visible && !folded && open && !busy) void bootstrap() }, 5000)
setInterval(() => { if (wakeWanted && visible && !petVoice && !voiceStarting && !speaking && !busy) void resumeWake() }, 1500)
