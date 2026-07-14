import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // `vercel dev` serves the /api serverless functions on :3000.
    // Run `vercel dev` alongside `npm run dev` to exercise API routes locally.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
