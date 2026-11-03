import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy target: http://backend-dev:8000 inside dev Docker, host default otherwise
const backendTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:8000'

export default defineConfig({
    plugins: [react()],
    server: {
        port: 3000,
        proxy: {
            '/api': {
                target: backendTarget,
                changeOrigin: true
            }
        }
    }
})
