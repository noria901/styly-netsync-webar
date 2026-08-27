import {cpSync, createReadStream, existsSync} from 'fs'
import {resolve} from 'path'
import {defineConfig} from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import {offlinePlugin} from './offline-plugin.js'

// GitHub Pages serves project sites from /<repo>/, so assets must resolve
// relative to the page rather than the domain root. './' works both there and
// on a local dev server.
const base = process.env.VITE_BASE ?? './'

// The generated JSON carries imagePath: "image-targets/<name>_luminance.png",
// and the engine loads it with img.src = imagePath — a plain relative URL
// resolved against the document. So the actual image files have to sit at that
// path in the built output, not just be bundled as JSON.
//
// Bundling the JSON and forgetting the images produces no build error and no
// console error either: the target simply never matches, which reads as "my
// marker is bad" rather than "the file 404'd".
const copyImageTargets = () => ({
  name: 'copy-image-targets',
  // Dev server: image-targets/ is outside root's served dirs, so alias it.
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/image-targets/')) {
        return next()
      }
      const file = resolve(import.meta.dirname, '.' + req.url.split('?')[0])
      if (!existsSync(file)) {
        return next()
      }
      res.setHeader('Content-Type', req.url.endsWith('.png') ? 'image/png' : 'image/jpeg')
      createReadStream(file).pipe(res)
    })
  },
  closeBundle() {
    const from = resolve(import.meta.dirname, 'image-targets')
    if (!existsSync(from)) {
      return
    }
    // Only the luminance image is fetched at runtime. The original, cropped and
    // thumbnail copies are authoring artifacts — worth keeping in git so a
    // marker can be re-cropped later, not worth shipping. They are ~130 KB per
    // marker, which the original at full resolution dominates.
    const to = resolve(import.meta.dirname, 'dist/image-targets')
    cpSync(from, to, {
      recursive: true,
      filter: src => !/_(original|cropped|thumbnail)\.[a-z]+$/.test(src),
    })
  },
})

export default defineConfig({
  base,
  // getUserMedia requires a secure context. localhost is exempt, but testing on
  // a phone over the LAN is not — hence the self-signed cert.
  // offlinePlugin must run after copyImageTargets — it precaches whatever is
  // in dist, so the targets need to be there first.
  plugins: [basicSsl(), copyImageTargets(), offlinePlugin()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    assetsDir: 'assets',
  },
})
