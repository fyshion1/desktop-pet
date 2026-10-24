const { test } = require('node:test')
const assert = require('node:assert/strict')

test('PCM energy distinguishes silence and ordinary speech', async () => {
  const { pcmRms } = await import('../src/petVoice.js')
  const silence = new Uint8Array(3200)
  const speech = new Int16Array(1600)
  for (let i = 0; i < speech.length; i++) speech[i] = i % 2 ? 1800 : -1800
  assert.equal(pcmRms(silence), 0)
  assert.ok(pcmRms(new Uint8Array(speech.buffer)) > 0.05)
  assert.equal(pcmRms(new Uint8Array([1])), 0)
})
