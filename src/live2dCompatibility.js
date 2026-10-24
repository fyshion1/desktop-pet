/** Avoid the Cubism packed-mask limit on detailed imported models.
 * The default renderer packs at most 36 unique masks into one atlas (32 per
 * atlas when using multiple textures). Beyond that, unrelated meshes share a
 * mask region and produce solid shadows or missing hair/clothing.
 * High precision renders the required mask per drawable. It costs extra GPU
 * work, so ordinary models keep their existing packed-mask path.
 */
export function configureLive2DRendering(model) {
  const renderer = model.internalModel?.renderer
  const manager = renderer?._clippingManager
  const count = manager?.getClippingMaskCount?.() || 0
  const textures = manager?.getRenderTextureCount?.() || 1
  const capacity = textures === 1 ? 36 : 32 * textures
  if (count > capacity && typeof renderer.useHighPrecisionMask === 'function') {
    renderer.useHighPrecisionMask(true)
  }
  return { maskCount: count, capacity, highPrecision: renderer?.isUsingHighPrecisionMask?.() || false }
}

export function mapTracking(input, setting) {
  const span = setting.InputRangeUpper - setting.InputRangeLower
  if (!Number.isFinite(span) || span === 0) return null
  const value = setting.OutputRangeLower + (input - setting.InputRangeLower) / span * (setting.OutputRangeUpper - setting.OutputRangeLower)
  return Number.isFinite(value) ? value : null
}

export function configureVtsInputs(model) {
  const im = model.internalModel, core = im.coreModel
  const mappings = im.settings.json.PetCompatibility?.parameterSettings || []
  if (!mappings.length) return
  const ids = new Set(core._model.parameters.ids)
  // Some rigs use *IN parameters as physics inputs. Writing the generic output
  // ParamAngleX directly bypasses that rig and applies a second deformation.
  const focusInputs = { FaceAngleX: () => im.focusController.x * 30, FaceAngleY: () => im.focusController.y * 20,
    FaceAngleZ: () => im.focusController.x * im.focusController.y * -30,
    EyeLeftX: () => im.focusController.x, EyeRightX: () => im.focusController.x,
    EyeLeftY: () => im.focusController.y, EyeRightY: () => im.focusController.y }
  im.updateFocus = () => {
    for (const s of mappings) if (focusInputs[s.Input] && ids.has(s.OutputLive2D)) {
      const v = mapTracking(focusInputs[s.Input](), s)
      if (v !== null) core.setParameterValueById(s.OutputLive2D, v)
    }
  }
  // Keep breathing without the sample SDK's synthetic angle sway, which also
  // writes directly to the physics outputs on these VTS rigs.
  im.updateNaturalMovements = (_dt, now) => {
    if (ids.has('ParamBreath')) core.setParameterValueById('ParamBreath', .5 + .5 * Math.sin(now / 1000 * Math.PI / 2))
  }
  if (!im.settings.getEyeBlinkParameters()?.length) {
    im.on('beforeMotionUpdate', () => {
      const phase = performance.now() / 1000 % 5
      const blink = 1 - Math.max(0, 1 - Math.abs(phase - 4.7) / .13)
      for (const s of mappings) if (['EyeOpenLeft', 'EyeOpenRight'].includes(s.Input) && ids.has(s.OutputLive2D)) {
        const v = mapTracking(blink, s)
        if (v !== null) core.setParameterValueById(s.OutputLive2D, v)
      }
    })
  }
}
