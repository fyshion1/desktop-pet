export const basicExpressions = [
  { id: 'basic:smile', name: '微笑（通用）', parameters: [{ Id: 'ParamMouthForm', Value: .8, Blend: 'Overwrite' }] },
  { id: 'basic:eyes', name: '眯眼（通用）', parameters: [{ Id: 'ParamEyeLOpen', Value: .25, Blend: 'Overwrite' }, { Id: 'ParamEyeROpen', Value: .25, Blend: 'Overwrite' }] },
]

// Only explicit Overwrite controls are pinned after physics/focus/lip-sync.
// Add/Multiply keep the SDK's native blending and are never applied twice.
export function applyExpressionPins(core, parameters, ids) {
  for (const p of parameters) if (p.Blend === 'Overwrite' && ids.has(p.Id) && Number.isFinite(p.Value)) core.setParameterValueById(p.Id, p.Value)
}

export function createExpressions(model, key) {
  const im = model.internalModel, core = im.coreModel, manager = im.motionManager.expressionManager
  const ids = new Set(core._model.parameters.ids)
  const definitions = im.settings.expressions || []
  const isOverlay = d => /remove.*water.*mark|隐藏水印|关闭水印|去水印/i.test(d.Name || d.name || d.File || '')
  const choices = [{ id: '', name: '默认表情' }, ...definitions.map((d, i) => ({ id: `native:${i}`, name: d.Name || d.name || `表情 ${i + 1}` })).filter((_d, i) => !isOverlay(definitions[i])),
    ...basicExpressions.filter(e => e.parameters.every(p => ids.has(p.Id)))]
  let pins = [], generation = 0, selected = '', overlayPins = []
  const overlayIndex = definitions.findIndex(isOverlay)
  let overlayEnabled = overlayIndex >= 0
  try { const saved = localStorage.getItem(`pet.overlay.${key}`); if (saved !== null) overlayEnabled = saved === 'true' } catch {}
  const readExpression = async index => {
    const file = definitions[index].File || definitions[index].file
    const response = await fetch(new URL(file, new URL(im.settings.url, location.href)))
    if (!response.ok) throw new Error('表情文件读取失败')
    return (await response.json()).Parameters || []
  }
  // Model-provided visibility toggles are independent of the selected face expression.
  // Convert their declared blend against the model's authored defaults, never the
  // previous frame, so Add toggles do not accumulate or cancel on another expression.
  const ready = overlayIndex < 0 ? Promise.resolve() : readExpression(overlayIndex).then(parameters => {
    const raw = core._model.parameters
    overlayPins = parameters.filter(p => ids.has(p.Id)).map(p => {
      const index = raw.ids.indexOf(p.Id), base = raw.defaultValues[index]
      return { Id: p.Id, Blend: 'Overwrite', Value: p.Blend === 'Overwrite' ? p.Value : p.Blend === 'Multiply' ? base * p.Value : base + p.Value }
    })
  })
  im.on('beforeModelUpdate', () => { applyExpressionPins(core, pins, ids); if (overlayEnabled) applyExpressionPins(core, overlayPins, ids) })
  return {
    choices,
    hasOverlayToggle: overlayIndex >= 0,
    get overlayEnabled() { return overlayEnabled },
    setOverlay(value) { overlayEnabled = value; try { localStorage.setItem(`pet.overlay.${key}`, String(value)) } catch {} },
    get selected() { return selected },
    async select(value) {
      const serial = ++generation
      await ready
      if (!choices.some(c => c.id === value)) value = ''
      const preset = basicExpressions.find(c => c.id === value)
      let parameters = preset?.parameters || []
      if (value.startsWith('native:')) {
        const index = Number(value.slice(7))
        parameters = await readExpression(index)
        if (serial !== generation || model.destroyed) return
        if (!await model.expression(index)) throw new Error('模型未能应用该表情')
      } else if (manager) {
        // resetExpression alone leaves currentExpression pointing to the old expression;
        // a later motion would restore it. Reset both.
        manager.currentExpression = manager.defaultExpression
        manager.stopAllExpressions()
        manager.resetExpression()
      }
      if (serial !== generation || model.destroyed) return
      pins = parameters.filter(p => p.Blend === 'Overwrite')
      selected = value
      try { localStorage.setItem(`pet.expression.${key}`, value) } catch {}
    },
    saved() { try { return localStorage.getItem(`pet.expression.${key}`) || '' } catch { return '' } },
  }
}
