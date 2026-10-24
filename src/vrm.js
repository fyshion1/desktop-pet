import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { createVrmAnimation } from './vrmAnimation.js'

export async function createVrm(canvas, url) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, .1, 100)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8d7d8a, 1.3))
  const light = new THREE.DirectionalLight(0xffffff, 1); light.position.set(1, 2, 3); scene.add(light)
  let vrm
  try {
    const loader = new GLTFLoader(); loader.register(parser => new VRMLoaderPlugin(parser))
    const gltf = await loader.loadAsync(url); vrm = gltf.userData.vrm
    if (!vrm) throw new Error('文件不含 VRM 数据')
    VRMUtils.rotateVRM0(vrm); VRMUtils.combineSkeletons(vrm.scene)
    const animation = createVrmAnimation(vrm)
    animation.update(0)
    vrm.update(0)
    vrm.scene.updateMatrixWorld(true)
    scene.add(vrm.scene)
    const box = new THREE.Box3().setFromObject(vrm.scene), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3())
    let width = 1, height = 1, displayHeight = 400
    const pixels = new Uint8Array(4)
    return {
      ratio: size.x / size.y,
      resize(w, h, available, edge, open, actor) {
        width = w; height = h; displayHeight = available
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(w, h, false)
        const modelWidth = available * size.x / size.y
        const cx = actor ? actor.x + actor.width / 2 : edge === 'left' ? modelWidth / 2 + 5 : edge === 'right' ? w - modelWidth / 2 - 5 : w * .55
        const cy = actor ? actor.y + actor.height / 2 : edge === 'top' && !open ? available / 2 + 5 : h - 5 - available / 2
        camera.aspect = w / h; camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h)
        camera.position.set(center.x, center.y, center.z + size.y * h / available / (2 * Math.tan(Math.PI / 12)) * 1.05)
        camera.lookAt(center); camera.updateProjectionMatrix()
      },
      update(dt, mouth) { const step = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, .05)); animation.update(step, mouth); vrm.update(step); renderer.render(scene, camera) },
      focus(x, y) { animation.focus((x / Math.max(width, 1) - .5) * 2, (.5 - y / Math.max(height, 1)) * 2) },
      hit(x, y) { if (x < 0 || y < 0 || x >= width || y >= height) return false; const gl = renderer.getContext(), r = renderer.getPixelRatio(); gl.readPixels(Math.floor(x * r), Math.floor((height - y) * r) - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels); return pixels[3] > 20 },
      touch() { animation.touch() },
      destroy() { VRMUtils.deepDispose(vrm.scene); renderer.dispose() },
    }
  } catch (error) { if (vrm) VRMUtils.deepDispose(vrm.scene); renderer.dispose(); throw error }
}
