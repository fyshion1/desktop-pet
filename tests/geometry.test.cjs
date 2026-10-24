const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fitBounds, dockBounds, taskbarEdge } = require('../electron/geometry.cjs')

test('left/above monitors preserve negative logical coordinates', () => {
  assert.deepEqual(fitBounds({ x: -1300, y: -800 }, { x: -1920, y: -1080, width: 1920, height: 1040 }), { x: -1300, y: -840, width: 540, height: 800 })
})

test('resize survives recovery, snapping respects negative work area and distance', () => {
  const area = { x: -1920, y: -40, width: 1920, height: 1080 }
  const b = { x: -1900, y: 0, width: 812, height: 1000 }
  assert.equal(fitBounds(b, area).width, 812)
  assert.equal(dockBounds(b, area).x, -1920)
  assert.equal(dockBounds({ ...b, x: -1800 }, area).x, -1800)
  assert.equal(dockBounds(b, area, 'right').x, -812)
  assert.equal(dockBounds(b, area, 'bottom').y, 40)
})

test('taskbar docking handles bottom, side, top and auto-hidden taskbars', () => {
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 }
  assert.equal(taskbarEdge(bounds, { ...bounds, height: 1032 }), 'bottom')
  assert.equal(taskbarEdge(bounds, { ...bounds, x: 60, width: 1860 }), 'left')
  assert.equal(taskbarEdge(bounds, { ...bounds, width: 1860 }), 'right')
  assert.equal(taskbarEdge(bounds, { ...bounds, y: 40, height: 1040 }), 'top')
  assert.equal(taskbarEdge(bounds, bounds), 'bottom')
})
test('removed monitor recovers offscreen pet, small/high-DPI work area fits fully', () => {
  assert.deepEqual(fitBounds({ x: -1900, y: 300 }, { x: 0, y: 0, width: 960, height: 516 }), { x: 0, y: 0, width: 540, height: 516 })
  assert.deepEqual(fitBounds({ x: 9999, y: 9999 }, { x: 50, y: 20, width: 400, height: 450 }), { x: 50, y: 20, width: 400, height: 450 })
})
