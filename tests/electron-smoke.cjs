// Optional isolated UI check: node tests/electron-smoke.cjs (requires playwright).
// No real backend, API keys, model files or user profile are accessed.
const { _electron: electron } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
async function main() {
 const root = path.resolve(__dirname, '..')
 const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-pet-smoke-'))
 let characters = []
 const server = http.createServer((req,res) => {
  res.setHeader('Content-Type','application/json')
  const pathname = new URL(req.url,'http://localhost').pathname
  let data = {}
  if(pathname.endsWith('/settings')) data = { values: { character:'test-assistant', model:'obsolete-preset', session:'single', scale:1 } }
  if(pathname === '/api/characters') data = characters
  if(pathname === '/api/chat/session') data = {session_id:'test-session',mode:'single',items:[],configured:true}
  res.end(JSON.stringify(data))
 })
 let app
 try {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  const env = {...process.env, PET_USER_DATA_DIR:profile, PET_MODEL_CATALOG:path.join(profile,'models.json'), PET_SUPPRESS_NOTIFICATIONS:'1', PET_BRAIN_URL:`http://127.0.0.1:${server.address().port}`}
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({args:[root],cwd:root,env})
  const page = await app.firstWindow()
  await page.waitForSelector('#add-model')
  const empty = await page.evaluate(() => window.pet.bootstrap())
  assert.deepEqual(empty.models,[])
  assert.equal(empty.settings.model,'')
  assert.equal(empty.character.id,'')
  await page.waitForFunction(() => document.querySelector('#name').textContent.includes('创建'))
  assert.equal(await page.locator('#model-choice option').count(),1)
  assert.equal(await page.locator('#stage').isVisible(),false)
  assert.equal(await page.locator('#vrm-stage').isVisible(),false)
  assert.equal(await page.locator('#add-model').isEnabled(),true)
  characters = [{id:'test-assistant',name:'Test Assistant'}]
  await page.waitForFunction(async () => (await window.pet.bootstrap()).character.id === 'test-assistant')
  const state = await page.evaluate(() => window.pet.bootstrap())
  assert.equal(state.character.name,'Test Assistant')
  await assert.rejects(page.evaluate(() => window.pet.model('unregistered')))
  const response = await page.evaluate(async () => (await fetch('pet://app/assets/models/vrm/sample.vrm')).status)
  assert.equal(response,404)
  console.log('PASS: empty models, empty assistants, local registry, rejected old assets; isolated profile')
 } finally {
  if(app) await app.close()
  await new Promise(resolve => server.close(resolve))
  fs.rmSync(profile,{recursive:true,force:true})
 }
}
main().catch(error => { console.error(error);process.exitCode=1 })
