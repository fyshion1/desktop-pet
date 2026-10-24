export class PokeGesture {
  constructor() { this.reset() }
  reset() { this.press = null; this.tap = null }
  down(x, y, time) { this.press = { x, y, time }; this.moved = false }
  move(x, y) {
    if (!this.press) return false
    if (Math.hypot(x - this.press.x, y - this.press.y) > 3) { this.moved = true; this.tap = null }
    return this.moved
  }
  up(x, y, time) {
    if (!this.press) return false
    this.move(x, y)
    const valid = !this.moved && time - this.press.time <= 300
    this.press = null
    if (!valid) { this.tap = null; return false }
    const pair = this.tap && time - this.tap.time <= 400 && Math.hypot(x - this.tap.x, y - this.tap.y) <= 24
    this.tap = pair ? null : { x, y, time }
    return !!pair
  }
}

export const pokeLines = ['欸？是在叫我吗？', '收到你的戳戳啦，我在这里。', '嘿嘿，陪着你呢。', '怎么啦？想跟我说点什么？', '再戳就要被我发现你想聊天啦。']
