import * as esbuild from 'esbuild'
import path from 'node:path'

const isWatch = process.argv.includes('--watch')

const sharedOptions = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  external: ['electron', 'electron-overlay-window', 'uiohook-napi']
}

async function run () {
  const mainCtx = await esbuild.context({
    ...sharedOptions,
    entryPoints: [path.resolve('src/main/index.ts')],
    outfile: path.resolve('dist-main/index.js')
  })

  const preloadCtx = await esbuild.context({
    ...sharedOptions,
    entryPoints: [path.resolve('src/main/preload.ts')],
    outfile: path.resolve('dist-main/preload.js')
  })

  if (isWatch) {
    await Promise.all([mainCtx.watch(), preloadCtx.watch()])
    console.log('[build-main] watching...')
  } else {
    await Promise.all([mainCtx.rebuild(), preloadCtx.rebuild()])
    await Promise.all([mainCtx.dispose(), preloadCtx.dispose()])
    console.log('[build-main] done')
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
