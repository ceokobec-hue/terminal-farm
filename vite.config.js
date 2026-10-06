import { defineConfig } from 'vite'
import { apiMiddleware } from './server/api.mjs'

/** Serves /api from inside the Vite dev server, so `npm run dev` is the whole game. */
const api = () => ({
  name: 'terminal-farm-api',
  configureServer(server) {
    server.middlewares.use(apiMiddleware)
  },
})

export default defineConfig({
  plugins: [api()],
  // PORT lets a second copy run alongside the first without a flag on the command line.
  server: { port: Number(process.env.PORT) || 5274, strictPort: false },
  build: { target: 'esnext' },
})
