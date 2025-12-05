import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Removed 'base' property. Vercel/Netlify deploys to the root ('/') by default, 
  // which is the standard behavior.
})