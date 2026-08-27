import {defineConfig} from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// GitHub Pages serves project sites from /<repo>/, so assets must resolve
// relative to the page rather than the domain root. './' works both there and
// on a local dev server.
const base = process.env.VITE_BASE ?? './'

export default defineConfig({
  base,
  // getUserMedia requires a secure context. localhost is exempt, but testing on
  // a phone over the LAN is not — hence the self-signed cert.
  plugins: [basicSsl()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    assetsDir: 'assets',
  },
})
