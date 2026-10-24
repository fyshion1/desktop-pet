// Coordinates are Electron logical pixels, including monitors left/above primary.
function fitBounds(bounds, area) {
  const width = Math.min(Math.max(360, Number(bounds.width) || 540), 1000, area.width)
  const height = Math.min(Math.max(450, Number(bounds.height) || 800), 1200, area.height)
  const x = Number.isFinite(bounds.x) ? bounds.x : area.x + area.width - width - 18
  const y = Number.isFinite(bounds.y) ? bounds.y : area.y + area.height - height
  return { x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))), width, height }
}
function dockBounds(bounds, area, edge = 'auto', distance = 26) {
  const b = fitBounds(bounds, area)
  const edges = { left: area.x, right: area.x + area.width - b.width, top: area.y, bottom: area.y + area.height - b.height }
  if (edge === 'auto') {
    if (Math.abs(b.x - edges.left) <= distance) b.x = edges.left
    else if (Math.abs(b.x - edges.right) <= distance) b.x = edges.right
    if (Math.abs(b.y - edges.top) <= distance) b.y = edges.top
    else if (Math.abs(b.y - edges.bottom) <= distance) b.y = edges.bottom
  } else if (edge === 'left' || edge === 'right') b.x = edges[edge]
  else if (edge === 'top' || edge === 'bottom') b.y = edges[edge]
  return b
}
function taskbarEdge(bounds, area) {
  const insets = { bottom: bounds.y + bounds.height - area.y - area.height, left: area.x - bounds.x, right: bounds.x + bounds.width - area.x - area.width, top: area.y - bounds.y }
  return Object.keys(insets).reduce((best, edge) => insets[edge] > insets[best] ? edge : best, 'bottom')
}
module.exports = { fitBounds, dockBounds, taskbarEdge }
