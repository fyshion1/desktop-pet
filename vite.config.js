import { defineConfig } from 'vite'
import fs from 'node:fs'
export default defineConfig({
  base: './', build: { target: 'es2022' },
  plugins: [{ name: 'dependency-notices', generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt',
      source: fs.readFileSync(new URL('./third_party/DEPENDENCY-NOTICES.txt', import.meta.url)) })
  } }],
})
