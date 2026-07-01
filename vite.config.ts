import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Base path. GitHub Pages serves under a subpath (/benchbridge/); a root-domain host like Render
  // serves at '/'. Render's build sets BASE_PATH=/ (see render.yaml); local/GitHub builds default
  // to the Pages subpath.
  base: process.env.BASE_PATH || '/benchbridge/',
})
