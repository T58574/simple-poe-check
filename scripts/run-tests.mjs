import * as esbuild from 'esbuild'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const outDir = path.resolve('.tmp-tests')
fs.rmSync(outDir, { recursive: true, force: true })

const testFiles = fs.readdirSync(path.resolve('tests'))
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => path.resolve('tests', f))

await esbuild.build({
  entryPoints: testFiles,
  outdir: outDir,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs'
})

const builtFiles = fs.readdirSync(outDir).map((f) => path.join(outDir, f))
try {
  execFileSync(process.execPath, ['--test', ...builtFiles], { stdio: 'inherit' })
} finally {
  fs.rmSync(outDir, { recursive: true, force: true })
}
