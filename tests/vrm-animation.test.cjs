const {test}=require('node:test')
const assert=require('node:assert/strict')

async function fixture(direction=1) {
  const {Object3D}=await import('three')
  const nodes=new Map(['hips','spine','chest','neck','head','leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm'].map(name=>[name,new Object3D()]))
  nodes.get('hips').position.y=1
  nodes.get('leftLowerArm').position.x=.25*direction
  nodes.get('rightLowerArm').position.x=-.25*direction
  const values={}
  const vrm={humanoid:{getNormalizedBoneNode:name=>nodes.get(name)},expressionManager:{getExpression:()=>true,setValue:(name,value)=>values[name]=value}}
  const {createVrmAnimation}=await import('../src/vrmAnimation.js')
  return {nodes,values,animation:createVrmAnimation(vrm)}
}

test('arms lower using rest-space directions instead of a version-only sign',async()=>{
  for(const sign of [-1,1]){
    const {nodes,animation}=await fixture(sign)
    animation.update(0)
    const {Vector3}=await import('three')
    for(const side of ['left','right']){
      const direction=nodes.get(side+'LowerArm').position.clone().applyQuaternion(nodes.get(side+'UpperArm').quaternion)
      assert.ok(direction.y < -.2,side+' forearm should point downward')
    }
  }
})

test('idle advances body bones and breathing without accumulating pose drift',async()=>{
  const {nodes,animation}=await fixture()
  animation.update(0)
  const initial=nodes.get('head').quaternion.clone()
  for(let i=0;i<600;i++)animation.update(1/60)
  assert.ok(nodes.get('head').quaternion.angleTo(initial)>.001)
  assert.ok(Math.abs(nodes.get('hips').position.y-1)<.003)
  assert.ok(Math.abs(nodes.get('spine').rotation.z)<.02)
})

test('focus, speech and touch produce bounded poses and decay back to neutral',async()=>{
  const {nodes,values,animation}=await fixture()
  animation.focus(10,-10)
  animation.touch()
  for(let i=0;i<20;i++)animation.update(.016,3)
  assert.ok(nodes.get('head').rotation.y>.03)
  assert.equal(values.aa,1)
  assert.ok(values.happy>0)
  for(let i=0;i<100;i++)animation.update(.016,0)
  assert.equal(values.happy,0)
  assert.equal(values.aa,0)
  animation.update(NaN,NaN)
  assert.ok(Number.isFinite(nodes.get('head').quaternion.w))
})

test('optional bones and expressions are not required',async()=>{
  const {createVrmAnimation}=await import('../src/vrmAnimation.js')
  const animation=createVrmAnimation({humanoid:{getNormalizedBoneNode:()=>null}})
  assert.doesNotThrow(()=>{animation.focus(0,0);animation.touch();animation.update(.016)})
})
