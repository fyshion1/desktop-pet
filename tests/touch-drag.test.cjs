const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8')
const electron = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8')

test('touch drag keeps a single pointer and survives missing screen coordinates', () => {
  const targets = Array.from({length:4}, () => ({tagName:'CANVAS', events:{}, addEventListener(type,fn){this.events[type]=fn}, setPointerCapture(){}}))
  const calls=[]
  class Gesture {
    down(x,y){this.origin={x,y}}
    move(x,y){return Math.hypot(x-this.origin.x,y-this.origin.y)>3}
    up(){return false}
    reset(){}
  }
  const context=vm.createContext({window:{screenX:200,screenY:100},navigator:{maxTouchPoints:5},
    PokeGesture:Gesture,performance:{now:()=>10},clearTimeout(){},setTimeout(){},
    document:{querySelector:()=>targets[3]},$:(id)=>targets[['stage','vrm-stage','handle'].indexOf(id)],
    bridge:{drag:(...args)=>calls.push(args),dragMove:p=>calls.push(['move',p])},
    setOpen(){},touch(){},pointer:null,dragging:false,singleTapTimer:null,open:false})
  const begin=main.indexOf('function screenPoint(e)')
  const end=main.indexOf('// Sample a tiny patch',begin)
  vm.runInContext(main.slice(begin,end),context)
  const event=(id,x,primary=true)=>({pointerId:id,isPrimary:primary,button:0,screenX:0,screenY:0,clientX:x,clientY:20,preventDefault(){}})
  const events=targets[0].events
  events.pointerdown(event(1,10))
  events.pointerdown(event(2,900,false))
  events.pointermove(event(2,900,false))
  assert.equal(calls.length,0)
  events.pointermove(event(1,30))
  assert.equal(calls[0][0],true)
  assert.equal(calls[0][1].x,230)
  assert.equal(calls[0][1].y,120)
  events.pointercancel(event(2,900,false))
  assert.equal(calls.length,1)
  events.pointermove(event(1,50))
  assert.equal(calls[1][0],'move')
  assert.equal(calls[1][1].x,250)
  events.pointerup(event(1,50))
  assert.equal(calls.at(-1)[0],false)
  assert.equal(context.pointer,null)
})

test('fixed drag loop smooths touch jitter and preserves direct mouse movement',()=>{
  let position=[0,0]
  const context=vm.createContext({drag:null,win:{isDestroyed:()=>false,getPosition:()=>position,setPosition:(x,y)=>position=[x,y]},screen:{getCursorScreenPoint:()=>({x:80,y:0})},setInterval:()=>1,clearInterval(){}})
  const begin=electron.indexOf('const DRAG_TICK_MS')
  const end=electron.indexOf('function arrange(',begin)
  vm.runInContext(electron.slice(begin,end),context)
  context.drag={pointer:true,origin:{x:0,y:0},last:{x:80,y:0},bounds:{x:0,y:0}}
  context.moveDrag();assert.equal(position[0],44)
  context.moveDrag();context.moveDrag();assert.ok(position[0]>=72)
  position=[0,0]
  for(let i=0;i<10;i++){context.drag.last.x=i%2?4:-4;context.moveDrag()}
  assert.ok(Math.abs(position[0])<=2)
  context.drag.pointer=false
  context.moveDrag();assert.equal(position[0],80)
})
