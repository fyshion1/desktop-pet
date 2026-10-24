const { test } = require('node:test')
const assert = require('node:assert/strict')
const { placeCompanion } = require('../electron/placement.cjs')
const screen = { x: 0, y: 0, width: 1920, height: 1040 }
const size = { width: 488, height: 360 }
test('standalone speech stays inside the work area without opening chat or moving the actor', () => {
  const a = { x: 8, y: 8, width: 220, height: 420 }
  const p = placeCompanion(a, screen, size, false, false, true)
  assert.deepEqual(world(p, 'actor'), a)
  inside(world(p, 'speech'), screen)
  assert.ok(p.bounds.width >= p.speech.x + p.speech.width)
})
test('300 percent actor exceeds the display without being scaled down; canvas stays screen-sized', () => {
  const a = { x: -100, y: -230, width: 655, height: 1260 }
  const p = placeCompanion(a, screen, size)
  assert.equal(p.actor.height, 1260)
  assert.equal(p.actor.width, 655)
  inside(p.bounds, screen)
  inside(world(p, 'bubble'), screen)
  inside(world(p, 'handle'), screen)
})
const world = (p, part) => ({ ...p[part], x: p.bounds.x + p[part].x, y: p.bounds.y + p[part].y })
function inside(r, area) {
  assert.ok(r.x >= area.x && r.y >= area.y && r.x + r.width <= area.x + area.width && r.y + r.height <= area.y + area.height, JSON.stringify({ r, area }))
}
test('chat expands inward at all four corners without shifting the actor', () => {
  for (const x of [8, 1692]) for (const y of [8, 584]) {
    const a = { x, y, width: 220, height: 420 }
    const p = placeCompanion(a, screen, size)
    assert.deepEqual(world(p, 'actor'), a)
    inside(world(p, 'bubble'), screen)
    const b = world(p, 'bubble')
    if (x === 8) assert.ok(b.x > a.x + a.width)
    else assert.ok(b.x + b.width < a.x)
    assert.equal(p.direction, x === 8 ? 'right' : 'left')
  }
})
test('opening, closing and resizing chat preserve character screen coordinates', () => {
  const a = { x: 1200, y: 450, width: 220, height: 420 }
  for (const open of [true, false]) for (const width of [340, 760]) {
    const p = placeCompanion(a, screen, { width, height: 620 }, open)
    assert.deepEqual(world(p, 'actor'), a)
    inside(world(p, 'bubble'), screen)
  }
})
test('partly offscreen characters stay offscreen while chat and recovery grip remain usable', () => {
  for (const [x, y] of [[-185, 300], [1880, 200], [600, -375], [600, 995]]) {
    const a = { x, y, width: 220, height: 420 }
    const p = placeCompanion(a, screen, size)
    assert.deepEqual(world(p, 'actor'), a)
    inside(world(p, 'bubble'), screen)
    inside(world(p, 'handle'), screen)
  }
})
test('negative-coordinate monitors and narrow displays keep chat reachable', () => {
  for (const area of [{ x: -1920, y: -1000, width: 1920, height: 1040 }, { x: 100, y: 50, width: 400, height: 600 }]) {
    const p = placeCompanion({ x: area.x + 8, y: area.y + 8, width: 220, height: 420 }, area, size)
    inside(world(p, 'bubble'), area)
    inside(world(p, 'handle'), area)
  }
  const recovered = placeCompanion({ x: -5000, y: -3000, width: 220, height: 420 }, screen, size, true, true)
  inside(world(recovered, 'actor'), screen)
})
