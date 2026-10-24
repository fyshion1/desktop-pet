const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const models=require('../electron/local-models.cjs')

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-models-'))
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 models.setCatalogPath(path.join(root,'profile/models.json'))
 const folder=path.join(root,'user-model');fs.mkdirSync(folder)
 const file=path.join(folder,'avatar.model3.json')
 const data=JSON.stringify({Version:3,FileReferences:{Moc:'avatar.moc3',Textures:['texture.png']}})
 fs.writeFileSync(file,data);fs.writeFileSync(path.join(folder,'avatar.moc3'),'fixture');fs.writeFileSync(path.join(folder,'texture.png'),'fixture')
 return {root,folder,file,data}
}

test('empty registry advertises no models; selection stays local and never copies assets',t=>{
 const {root,file,data}=fixture(t)
 assert.deepEqual(models.listModels(),[])
 const id=models.registerModel(file)
 assert.equal(models.selectedModel(),id)
 assert.equal(models.listModels()[0].kind,'live2d')
 assert.equal(Object.hasOwn(models.listModels()[0],'file'),false)
 assert.equal(fs.readFileSync(file,'utf8'),data)
 assert.deepEqual(fs.readdirSync(path.join(root,'profile')),['models.json'])
 assert.equal(models.registerModel(file),id)
 assert.equal(models.listModels().length,1)
})

test('registered Live2D resolves relative assets and expressions but rejects escapes',t=>{
 const {folder,file}=fixture(t)
 fs.mkdirSync(path.join(folder,'Expressions'))
 fs.writeFileSync(path.join(folder,'Expressions/smile.exp3.json'),'{}')
 fs.writeFileSync(file.replace('.model3.json','.vtube.json'),JSON.stringify({Hotkeys:[{Action:'ToggleExpression',Name:'Smile',File:'smile.exp3.json'}]}))
 const id=models.registerModel(file)
 assert.equal(models.modelManifest(id).FileReferences.Expressions[0].Name,'Smile')
 assert.ok(models.localFile(id,'texture.png'))
 for(const name of ['../../outside.json','C:/secret.json','../user-model/texture.png','file:stream','/texture.png'])assert.equal(models.localFile(id,name),null)
 assert.equal(models.modelManifest('__proto__'),null)
 assert.equal(models.localFile('unregistered','texture.png'),null)
})

test('VRM exposes only the selected file and removed files disappear from the picker',t=>{
 const {folder}=fixture(t)
 const file=path.join(folder,'avatar.vrm');fs.writeFileSync(file,'synthetic vrm fixture')
 const id=models.registerModel(file)
 assert.equal(models.listModels()[0].kind,'vrm')
 assert.equal(models.localFile(id,'model.vrm'),file)
 assert.equal(models.localFile(id,'anything.json'),null)
 assert.equal(models.modelManifest(id),null)
 assert.throws(()=>models.selectModel('unregistered'))
 fs.unlinkSync(file)
 assert.deepEqual(models.listModels(),[])
})


test('model manifests reject remote, missing and escaping dependencies before registration',t=>{
 const {file}=fixture(t)
 for(const ref of ['https://example.org/model.moc3','../outside.moc3','missing.moc3']){
  fs.writeFileSync(file,JSON.stringify({FileReferences:{Moc:ref,Textures:['texture.png']}}))
  assert.throws(()=>models.registerModel(file))
  assert.deepEqual(models.listModels(),[])
 }
})
