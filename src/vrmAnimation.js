import { Euler, Quaternion } from 'three'

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0))

/** Small procedural idle, using normalized bones rather than model-specific names.
 * vrm.update() transfers these rotations to raw bones and updates secondary motion.
 * No imported animation clip, tracking device or downloaded model is required.
 */
export function createVrmAnimation(vrm) {
  const bones = new Map()
  for (const name of ['hips', 'spine', 'chest', 'neck', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm']) {
    const node = vrm.humanoid?.getNormalizedBoneNode(name)
    if (node) bones.set(name, { node, rotation: node.quaternion.clone(), position: node.position.clone() })
  }
  const euler = new Euler(), offset = new Quaternion()
  const rotate = (name, x, y, z) => {
    const bone = bones.get(name)
    if (!bone) return
    offset.setFromEuler(euler.set(x, y, z))
    bone.node.quaternion.copy(bone.rotation).multiply(offset)
  }
  // Rest-space arm directions differ across exports. Inspect the normalized
  // forearm offset instead of assuming a sign solely from the VRM version.
  const armSign = side => {
    const x = bones.get(side + 'LowerArm')?.position.x
    return x && Math.abs(x) > 1e-5 ? -Math.sign(x) : (side === 'left' ? -1 : 1)
  }
  const leftSign = armSign('left'), rightSign = armSign('right')
  const height = Math.max(.2, Math.abs(bones.get('hips')?.position.y || 1))
  let elapsed = 0, focusX = 0, focusY = 0, targetX = 0, targetY = 0, reaction = 0
  const expressions = vrm.expressionManager
  const setExpression = (name, value) => {
    if (!expressions?.getExpression || expressions.getExpression(name)) expressions?.setValue(name, value)
  }
  return {
    focus(x, y) { targetX = clamp(x, -1, 1); targetY = clamp(y, -1, 1) },
    touch() { reaction = .9 },
    update(delta, mouth = 0) {
      const dt = clamp(delta, 0, .05)
      elapsed += dt
      const ease = 1 - Math.exp(-dt * 6)
      focusX += (targetX - focusX) * ease
      focusY += (targetY - focusY) * ease
      reaction = Math.max(0, reaction - dt)
      const breathe = Math.sin(elapsed * 1.65), sway = Math.sin(elapsed * .72)
      const acknowledge = reaction > 0 ? Math.sin(reaction / .9 * Math.PI) : 0
      rotate('spine', .012 * breathe, .012 * sway, .012 * sway)
      rotate('chest', .014 * breathe, 0, 0)
      rotate('neck', -focusY * .045, focusX * .055, 0)
      rotate('head', -focusY * .09 + acknowledge * .08, focusX * .15, sway * .018)
      rotate('leftUpperArm', .025 * breathe, 0, leftSign * (1.22 + .025 * sway))
      rotate('rightUpperArm', -.025 * breathe, 0, rightSign * (1.22 - .025 * sway))
      const hips = bones.get('hips')
      if (hips) hips.node.position.copy(hips.position).y += height * .0025 * breathe
      // Blink smoothly once per cycle rather than switching from 0 to 1.
      const phase = elapsed % 4.6
      setExpression('blink', Math.max(0, 1 - Math.abs(phase - 4.3) / .11))
      setExpression('aa', clamp(mouth, 0, 1))
      setExpression('happy', acknowledge * .65)
    },
  }
}
