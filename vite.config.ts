import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // IMPORTANT: Change '/PAOA-Visualizer/' to match your GitHub repository name
  // e.g. If your repo is https://github.com/user/my-algo, change this to '/my-algo/'
  base: '/PAOA-Visualizer/', 
})