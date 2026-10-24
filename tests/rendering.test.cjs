const {test} = require('node:test')
const assert = require('node:assert/strict')

function fixture(count, textures = 1, initial = false) {
  let high = initial, calls = 0
  const renderer = {
    _clippingManager: {getClippingMaskCount:()=>count, getRenderTextureCount:()=>textures},
    useHighPrecisionMask(value){high=value;calls++},
    isUsingHighPrecisionMask:()=>high,
  }
  return {model:{internalModel:{renderer}},calls:()=>calls}
}

test('complex models automatically avoid the packed-mask overflow', async()=>{
  const {configureLive2DRendering}=await import('../src/live2dCompatibility.js')
  for(const count of [37,85,140]){
    const f=fixture(count)
    assert.equal(configureLive2DRendering(f.model).highPrecision,true)
    assert.equal(f.calls(),1)
  }
})

test('ordinary rigs retain their current masks and existing precision is preserved', async()=>{
  const {configureLive2DRendering}=await import('../src/live2dCompatibility.js')
  for(const count of [0,1,36]){
    const f=fixture(count)
    assert.equal(configureLive2DRendering(f.model).highPrecision,false)
    assert.equal(f.calls(),0)
  }
  assert.equal(configureLive2DRendering(fixture(10,1,true).model).highPrecision,true)
  assert.equal(configureLive2DRendering(fixture(64,2).model).highPrecision,false)
  assert.equal(configureLive2DRendering(fixture(65,2).model).highPrecision,true)
  assert.equal(configureLive2DRendering({internalModel:{}}).maskCount,0)
})
