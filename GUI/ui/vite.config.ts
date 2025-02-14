import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vitejs.dev/config/
export default defineConfig({
	build: {
		emptyOutDir: false,
		copyPublicDir: false,
		outDir: '../app/dist',
		lib: {
			entry: `./src/main.ts`,
			name: 'Micrio.GUI.UI',
			fileName: `micrio.gui.ui`,
			formats: ['iife']
		},
		rollupOptions: {
			output: {
				assetFileNames: () => `micrio.gui.ui[extname]`
			}
		}
	},
  plugins: [svelte()],
})
