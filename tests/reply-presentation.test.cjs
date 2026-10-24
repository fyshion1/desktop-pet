const { test } = require('node:test')
const assert = require('node:assert/strict')
test('group replies tolerate thinking tags and speaker headings without colons', async () => {
  const { replySegments, visibleReply } = await import('../src/replyPresentation.js')
  assert.deepEqual(replySegments({ content: '<thinking>hidden</thinking>\n**甲**我在。\n<thinking> </thinking>\n**乙**：怎么啦？' }), [
    { speaker: '甲', text: '我在。' }, { speaker: '乙', text: '怎么啦？' }])
  assert.equal(visibleReply('你好<think>unfinished'), '你好')
  assert.deepEqual(replySegments({ segments: [{ speaker: '甲', text: '<thinking> </thinking>' }], content: '**乙**：我在' }), [{ speaker: '乙', text: '我在' }])
  assert.deepEqual(replySegments({ content: '<thinking>nothing</thinking>' }), [])
})
