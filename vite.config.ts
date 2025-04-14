/// <reference types="vitest" />
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	plugins: [sveltekit(), svelteTesting()],
	test: {
		globals: true,
		environment: 'jsdom',
		setupFiles: ['./vitest.setup.ts'],
		include: ['src/**/*.{test,spec}.{js,ts}'],
		pool: 'forks',
		resolve: {
			alias: {
				'$lib': path.resolve(__dirname, './src/lib'),
			},
		}
	},
	optimizeDeps: {
		include: [
			'@testing-library/svelte',
			'@testing-library/dom'
		]
	},
	resolve: {
		alias: {
			'$lib': path.resolve(__dirname, './src/lib'),
		}
	}
});
