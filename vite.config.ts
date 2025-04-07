/// <reference types="vitest" />
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		globals: true,
		environment: 'jsdom',
		setupFiles: ['./vitest.setup.ts'],
	}
	// optimizeDeps: {
	// 	include: ['@skeletonlabs/skeleton']
	// }
	// ssr: {
	// 	noExternal: [
	// 		// Use regex to ensure all @skeletonlabs packages are processed by Vite for SSR
	// 		/^@skeletonlabs\/.*/
	// 	]
	// }
});
