// All rectangles use logical screen pixels; actor position is independent of chat size.
const limit = (v, low, high) => Math.max(low, Math.min(v, high))
function placeCompanion(actor, area, size, open = true, recover = false, speechVisible = false) {
  const pad = Math.min(8, area.width / 8, area.height / 8), gap = 14
  const width = actor.width
  const height = actor.height
  const a = { x: Math.round(limit(actor.x, recover && width < area.width - pad * 2 ? area.x + pad : area.x - width + Math.min(32, width), recover && width < area.width - pad * 2 ? area.x + area.width - width - pad : area.x + area.width - Math.min(32, width))),
    y: Math.round(limit(actor.y, recover && height < area.height - pad * 2 - 28 ? area.y + pad : area.y - height + Math.min(40, height), recover && height < area.height - pad * 2 - 28 ? area.y + area.height - height - pad - 28 : area.y + area.height - Math.min(40, height))), width, height }
  const handle = { x: Math.round(limit(a.x + width / 2 - 19, area.x + pad, area.x + area.width - 38 - pad)),
    y: Math.round(limit(a.y + height + 2, area.y + pad, area.y + area.height - 24 - pad)), width: 38, height: 24 }
  const bw = Math.min(size.width, area.width - pad * 2), bh = Math.min(size.height, area.height - pad * 2)
  const right = a.x + width / 2 < area.x + area.width / 2
  const below = a.y + height / 2 < area.y + area.height / 2
  let bx = right ? a.x + width + gap : a.x - bw - gap
  let by = below ? a.y + 24 : a.y + height - bh - 24
  let direction = right ? 'right' : 'left'
  if (bx < area.x + pad || bx + bw > area.x + area.width - pad) {
    // Narrow screens use vertical placement before allowing unavoidable overlap.
    const aboveY = a.y - bh - gap, belowY = a.y + height + 28 + gap
    if (belowY + bh <= area.y + area.height - pad || aboveY >= area.y + pad) {
      by = belowY + bh <= area.y + area.height - pad ? belowY : aboveY
      bx = a.x + width / 2 - bw / 2
      direction = by > a.y ? 'below' : 'above'
    }
  }
  const bubble = { x: Math.round(limit(bx, area.x + pad, area.x + area.width - bw - pad)),
    y: Math.round(limit(by, area.y + pad, area.y + area.height - bh - pad)), width: bw, height: bh }
  const sw = Math.min(260, area.width - pad * 2), sh = Math.min(120, area.height - pad * 2)
  // Head is near the upper centre of the visible model, rather than its canvas edge.
  const mouthX = a.x + width * .5, mouthY = a.y + height * .16
  const speech = { x: Math.round(limit(right ? mouthX + width * .16 + 8 : mouthX - width * .16 - 8 - sw, area.x + pad, area.x + area.width - sw - pad)),
    y: Math.round(limit(mouthY - 28, area.y + pad, area.y + area.height - sh - pad)), width: sw, height: sh, side: right ? 'right' : 'left' }
  const x = Math.max(area.x, Math.floor(Math.min(a.x, handle.x, open ? bubble.x : a.x, speechVisible ? speech.x : a.x) - pad))
  const y = Math.max(area.y, Math.floor(Math.min(a.y, handle.y, open ? bubble.y : a.y, speechVisible ? speech.y : a.y) - pad))
  const bounds = { x, y,
    width: Math.ceil(Math.min(area.x + area.width, Math.max(a.x + width, handle.x + handle.width, open ? bubble.x + bw : a.x, speechVisible ? speech.x + sw : a.x) + pad) - x),
    height: Math.ceil(Math.min(area.y + area.height, Math.max(a.y + height, handle.y + handle.height, open ? bubble.y + bh : a.y, speechVisible ? speech.y + sh : a.y) + pad) - y) }
  const local = r => ({ ...r, x: r.x - x, y: r.y - y })
  return { bounds, actor: local(a), bubble: local(bubble), handle: local(handle), speech: local(speech), direction }
}
module.exports = { placeCompanion }
