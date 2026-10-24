// One microphone owner: wake listener is closed before handing off to a voice call.
export class PetWake {
  constructor(onEvent) { this.onEvent = onEvent; this.closed = false }
  async start() {
    this.context = new AudioContext({ latencyHint: 'interactive' }); await this.context.resume()
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
    if (this.closed) { this.stream.getTracks().forEach(t => t.stop()); return }
    this.stream.getAudioTracks()[0].onended = () => this.onEvent({ type: 'error', message: '麦克风已断开，唤醒已停止' })
    await this.context.audioWorklet.addModule('pet://app/voice-capture.js')
    if (this.closed) return
    this.input = this.context.createMediaStreamSource(this.stream)
    this.capture = new AudioWorkletNode(this.context, 'voice-capture')
    this.input.connect(this.capture); this.capture.connect(this.context.destination)
    this.capture.port.onmessage = e => { if (!this.closed && this.ready) window.pet.wakeData(new Uint8Array(e.data)) }
    this.off = window.pet.onWake(e => { if (e.type === 'ready') this.ready = true; if (!this.closed) this.onEvent(e) })
    await window.pet.wakeOpen()
  }
  close() {
    if (this.closed) return
    this.closed = true; window.pet.wakeClose(); this.off?.()
    this.capture?.disconnect(); this.input?.disconnect(); this.stream?.getTracks().forEach(t => t.stop())
    void this.context?.close()
  }
}
