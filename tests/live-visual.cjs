// Read-only visual check against the real brain. Does not send messages or save settings.
const { _electron: electron } = require('playwright')
const path = require('node:path'), fs = require('node:fs')
;(async () => {
  const root = path.resolve(__dirname, '..'), out = path.join(root, 'artifacts/live'); fs.mkdirSync(out, { recursive: true })
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, `--user-data-dir=${path.join(out, 'profile')}`], cwd: root, env })
  try {
    const page = await app.firstWindow(); await page.waitForFunction(() => document.querySelector('#status')?.textContent === '我在，慢慢说。')
    await page.waitForTimeout(4000)
    const imgs = await page.locator('.avatar img').evaluateAll(xs => xs.map(img => ({ ok: img.complete && img.naturalWidth > 0, name: img.alt })))
    if (imgs.some(img => !img.ok)) throw new Error('Avatar image failed')
    await page.screenshot({ path: path.join(out, 'chat-avatars.png'), omitBackground: true })
    console.log('PASS read-only live brain:', imgs.length, 'loaded avatars; no messages sent or settings saved')
  } finally { await app.evaluate(({app}) => app.exit(0)); await app.close().catch(() => {}) }
})().catch(e => { console.error(e); process.exitCode = 1 })
