import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy target: http://backend-dev:8000 inside dev Docker, host default otherwise
const backendTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:8000'

export default defineConfig({
    plugins: [react()],
    // Ship modern JS only: less transpiled code, smaller bundle, faster parse
    build: {
        target: 'esnext'
    },
    server: {
        watch: {
            usePolling: true,
            interval: 300
        },
        // Pre-transform the heavy chart modules while the dev server boots,
        // so first page load isn't blocked by on-demand compiles
        warmup: {
            clientFiles: ['./js/visualizer/**/*.js', './components/*.jsx']
        },
        port: 3000,
        proxy: {
            '/api': {
                target: backendTarget,
                changeOrigin: true
            }
        }
    }
})
