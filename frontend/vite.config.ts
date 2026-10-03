import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// dev :9000，带部署前缀的 API 代理到后端 :8000，build 输出到 backend/static
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const configuredBase = env.VITE_BASE_PATH || '/'
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/.test(configuredBase)) {
    throw new Error('VITE_BASE_PATH must be a local URL path, for example /qfund/')
  }
  const base = /\/$/.test(configuredBase) ? configuredBase : `${configuredBase}/`

  return {
    base,
    plugins: [react()],
    server: {
      port: 9000,
      proxy: {
        [`${base}api`]: {
          target: 'http://localhost:8000',
          changeOrigin: true,
          rewrite: (path: string) => `/${path.slice(base.length)}`,
        },
      },
    },
    build: {
      outDir: '../backend/static',
      emptyOutDir: true,
    },
  }
})
