export function pcmRms(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2) return 0
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength - bytes.byteLength % 2)
  let sum = 0
  for (let i = 0; i < view.byteLength; i += 2) {
    const sample = view.getInt16(i, true) / 32768
    sum += sample * sample
  }
  return Math.sqrt(sum / (view.byteLength / 2))
}

export class PetVoice {
  constructor(onEvent) { this.onEvent = onEvent; this.sources = new Set(); this.segments = new Map(); this.rates = new Map(); this.next = 0; this.generation = 0; this.closed = false }
  async start(options) {
    this.context = new AudioContext({ latencyHint: 'interactive' }); await this.context.resume()
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
    if (this.closed) { this.stream.getTracks().forEach(t => t.stop()); return }
    await this.context.audioWorklet.addModule('pet://app/voice-capture.js')
    if (this.closed) return
    this.input = this.context.createMediaStreamSource(this.stream); this.capture = new AudioWorkletNode(this.context, 'voice-capture')
    this.input.connect(this.capture); this.capture.connect(this.context.destination)
    this.capture.port.onmessage = e => {
      if (this.closed) return
      const bytes = new Uint8Array(e.data)
      window.pet.voiceData(bytes)
      this.onEvent({ type: 'microphone-level', rms: pcmRms(bytes) })
    }
    this.off = window.pet.onVoice(event => this.receive(event))
    await window.pet.voiceOpen(options)
  }
  receive(event) {
    if (event.type === 'error') return this.fail('语音连接失败')
    if (event.type === 'close') return this.fail('语音连接已关闭')
    if (event.type !== 'message') return
    if (event.binary) return this.audio(event.data)
    let message; try { message = JSON.parse(event.data) } catch { return }
    if (message.type === 'reply-start') { this.stopAudio(); this.generation = message.generation }
    if (message.type === 'audio-start' && message.generation === this.generation) { this.rates.set(message.segment, message.sample_rate); this.segments.set(message.segment, { pending: 0, ended: false, acked: false }) }
    if (message.type === 'audio-end' && message.generation === this.generation) { const s = this.segments.get(message.segment); if (s) { s.ended = true; this.ack(message.segment) } }
    if (message.type === 'interrupted' && message.generation === this.generation) this.stopAudio()
    this.onEvent(message)
  }
  audio(bytes) {
    const raw = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), view = new DataView(raw)
    if (raw.byteLength < 10 || raw.byteLength % 2) return
    const generation = view.getUint32(0, true), number = view.getUint32(4, true), segment = this.segments.get(number)
    if (!segment || generation !== this.generation || this.closed) return
    const buffer = this.context.createBuffer(1, (raw.byteLength - 8) / 2, this.rates.get(number) || 24000), samples = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(8 + i * 2, true) / 32768
    const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.context.destination); segment.pending++; this.sources.add(source)
    source.onended = () => { this.sources.delete(source); segment.pending--; this.ack(number) }
    this.next = Math.max(this.next, this.context.currentTime + .06); source.start(this.next); this.next += buffer.duration
  }
  ack(number) { const s = this.segments.get(number); if (s?.ended && !s.pending && !s.acked) { s.acked = true; window.pet.voiceData(JSON.stringify({ type: 'played', generation: this.generation, segment: number })) } }
  sendText(text) { window.pet.voiceData(JSON.stringify({ type: 'text', text })) }
  stopAudio() { for (const s of this.sources) try { s.stop(); s.disconnect() } catch {} this.sources.clear(); this.segments.clear(); this.rates.clear(); this.next = 0 }
  fail(message) { if (!this.closed) this.onEvent({ type: 'fatal', message }); this.close() }
  close() { if (this.closed) return; this.closed = true; window.pet.voiceData(JSON.stringify({ type: 'hangup' })); window.pet.voiceClose(); this.stopAudio(); this.capture?.disconnect(); this.input?.disconnect(); this.stream?.getTracks().forEach(t => t.stop()); this.off?.(); void this.context?.close() }
}
