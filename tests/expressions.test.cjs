const { test } = require('node:test')
const assert = require('node:assert/strict')
test('VTS input mapping handles custom rig ranges and reversed eye axes', async () => {
  const { mapTracking } = await import('../src/live2dCompatibility.js')
  assert.equal(mapTracking(20, { InputRangeLower: -20, InputRangeUpper: 20, OutputRangeLower: -30, OutputRangeUpper: 30 }), 30)
  assert.equal(mapTracking(1, { InputRangeLower: -1, InputRangeUpper: 1, OutputRangeLower: 1, OutputRangeUpper: -1 }), -1)
  assert.equal(mapTracking(0, { InputRangeLower: 0, InputRangeUpper: 0 }), null)
})
test('expression pins respect declared overwrite, zero values and real parameter ids', async () => {
  const { applyExpressionPins } = await import('../src/live2dExpressions.js')
  const writes = []
  const core = { setParameterValueById: (id, value) => writes.push([id, value]) }
  applyExpressionPins(core, [
    { Id: 'ModelOverlay', Value: 0, Blend: 'Overwrite' },
    { Id: 'ParamMouthForm', Value: .8, Blend: 'Overwrite' },
    { Id: 'ParamMouthForm', Value: .2, Blend: 'Add' },
    { Id: 'ParamMouthForm', Value: .5, Blend: 'Multiply' },
    { Id: 'Unknown', Value: 0, Blend: 'Overwrite' },
    { Id: 'ParamMouthForm', Value: NaN, Blend: 'Overwrite' },
  ], new Set(['ModelOverlay', 'ParamMouthForm']))
  assert.deepEqual(writes, [['ModelOverlay', 0], ['ParamMouthForm', .8]])
})
