import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Using relative base path allows the app to be deployed to any subdirectory
  // or domain without changing the configuration.
  base: './',
})