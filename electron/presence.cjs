// Device-local permission to initiate contact; never infers wakefulness from activity.
const MODES = ['quiet', 'busy', 'rest', 'available', 'warm']
const LABELS = { warm: '常来找我呀', quiet: '悄悄陪着', busy: '我忙一会', rest: '陪我歇会', available: '来陪我呀' }
function normalize(value = {}) {
  return { mode: MODES.includes(value.mode) ? value.mode : 'quiet',
    until: Number.isFinite(value.until) && value.until > 0 ? value.until : 0,
    bufferUntil: Number.isFinite(value.bufferUntil) && value.bufferUntil > 0 ? value.bufferUntil : 0 }
}
function evaluate(value, now = Date.now()) {
  const state = normalize(value)
  if (state.mode === 'available' && (!state.until || now >= state.until)) {
    state.mode = 'quiet'; state.until = 0
  }
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(now))
  const protectedHours = hour >= 2 && hour < 14
  const buffering = now < state.bufferUntil
  const allowed = ['available', 'warm'].includes(state.mode) && !buffering
  return { ...state, allowed, protectedHours, buffering,
    label: buffering ? `${LABELS[state.mode]} · 慢慢醒来` : LABELS[state.mode],
    reason: buffering ? '先陪你慢慢醒，过一会儿再聊' : allowed ? '有小发现就来找你，没回也不催你' : protectedHours ? '这会儿轻轻陪着，叫我就来' : '我在身边，想聊就叫我',
    wakeEnabled: false }
}
function transition(value, mode, minutes = 30, now = Date.now()) {
  if (!MODES.includes(mode)) throw new Error('在场状态不存在')
  if (mode === 'available' && ![15, 30, 60].includes(minutes)) throw new Error('请选择 15、30 或 60 分钟')
  const old = evaluate(value, now)
  return { mode, until: mode === 'available' ? now + minutes * 60000 : 0,
    bufferUntil: old.mode === 'rest' && mode !== 'rest' ? now + 20 * 60000 : old.bufferUntil }
}
module.exports = { evaluate, transition, normalize }
