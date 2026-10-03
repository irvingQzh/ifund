import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const frontendDir = fileURLToPath(new URL('..', import.meta.url))
const viteCli = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const outDir = mkdtempSync(join(tmpdir(), 'qfund-login-split-'))
const dashboardKey = 'src/pages/Dashboard.tsx'

try {
  const build = spawnSync(process.execPath, [viteCli, 'build', '--outDir', outDir, '--manifest'], {
    cwd: frontendDir,
    env: {
      ...process.env,
      VITE_BASE_PATH: '/qfund/',
      VITE_ALLOW_REGISTRATION: 'false',
      VITE_ALLOW_AI_ANALYSIS: 'false',
    },
    encoding: 'utf8',
  })
  if (build.status !== 0) {
    throw new Error(`Qfund production build failed:\n${build.stdout}${build.stderr}`)
  }

  const manifest = JSON.parse(readFileSync(join(outDir, '.vite', 'manifest.json'), 'utf8'))
  const entry = manifest['index.html']
  const dashboard = manifest[dashboardKey]
  assert.ok(entry?.isEntry, 'login entry is missing from the production manifest')
  assert.ok(dashboard?.isDynamicEntry, 'Dashboard must remain a lazy-loaded chunk')
  assert.ok(entry.dynamicImports?.includes(dashboardKey), 'login entry must dynamically import Dashboard')

  const initialChunks = new Set()
  function collectStaticImports(key) {
    if (initialChunks.has(key)) return
    const chunk = manifest[key]
    assert.ok(chunk, `missing static chunk: ${key}`)
    initialChunks.add(key)
    for (const dependency of chunk.imports ?? []) collectStaticImports(dependency)
  }
  collectStaticImports('index.html')
  assert.ok(!initialChunks.has(dashboardKey), 'Dashboard must not be in the login static import graph')

  const initialFiles = [...initialChunks].map((key) => manifest[key].file)
  const initialJsBytes = initialFiles.reduce((total, file) => total + statSync(join(outDir, file)).size, 0)
  assert.ok(initialJsBytes < 800_000, `login JS exceeded 800 kB: ${initialJsBytes} bytes`)

  const html = readFileSync(join(outDir, 'index.html'), 'utf8')
  assert.ok(!html.includes(dashboard.file), 'HTML must not preload Dashboard')
  for (const css of dashboard.css ?? []) {
    assert.ok(!html.includes(css), `HTML must not preload Dashboard CSS: ${css}`)
  }
  console.log(`Qfund login split check passed: ${initialJsBytes} bytes initial JS, Dashboard lazy-loaded.`)
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
