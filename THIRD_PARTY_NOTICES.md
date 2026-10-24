# Third-party notices

Review date: 2026-10-25. Original desktop-pet code is Apache-2.0.
Dependency versions are pinned by package-lock.json. Original dependency license
texts are retained in third_party/DEPENDENCY-NOTICES.txt and copied into dist.

- PixiJS, three.js, @pixiv/three-vrm, pixi-live2d-display, ws and Electron use MIT
  licenses at the wrapper/package level; their notices remain applicable.
- pixi-live2d-display/cubism4 includes Live2D Cubism Web Framework, under its own
  Live2D Open Software License and SDK release conditions. The wrapper's MIT
  license does not override them. Business users meeting the upstream revenue
  threshold need a Cubism SDK Release License. Consult the original agreement;
  do not assume universal royalty-free commercial use of the Live2D path.
- Cubism Core is proprietary, not bundled or automatically downloaded. Users
  obtain it independently. Models, textures, expressions, motions and avatars
  are user-supplied and separately licensed; no samples are bundled.
- @pixiv/three-vrm code being MIT does not grant rights to .vrm model files.
- Binary distributions must retain Electron's LICENSE and LICENSES.chromium.html
  from its runtime directory, alongside the application's Apache-2.0 license.

Sources:
- https://github.com/guansss/pixi-live2d-display
- https://github.com/Live2D/CubismWebFramework/blob/develop/LICENSE.md
- https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html
- https://www.live2d.com/en/download/cubism-sdk/release-license/
- https://github.com/pixiv/three-vrm
- https://github.com/electron/electron
