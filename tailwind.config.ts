// tailwind.config.ts
import { join, dirname } from 'path';
import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

// Import the Skeleton plugin - REMOVED
// import { skeleton } from '@skeletonlabs/tw-plugin';

const config: Config = {
	// Enable class-based dark mode (recommended for Skeleton) - Keeping class for now, but DaisyUI prefers data-theme
	darkMode: 'class',

	content: [
		'./src/**/*.{html,js,svelte,ts}',
		// Path to Skeleton components - REMOVED
		// join(dirname(require.resolve('@skeletonlabs/skeleton')), '../**/*.{html,js,svelte,ts}')
	],

	theme: {
		screens: {
			// Explicitly include default screens to ensure they are known
			// Removed comment about @variant directives for v3 compatibility.
			...defaultTheme.screens,
		},
		extend: {
			// You can add custom theme extensions here
			// screens: { // Removed explicit md definition
			// 	// Explicitly add md screen here as a test
			// 	'md': defaultTheme.screens.md,
			// }, // Removed explicit md definition
		},
	},

	plugins: [
		// Skeleton plugin RESTORED - REMOVED
		// skeleton({
		// 	// Using the 'modern' preset theme.
		// 	themes: { preset: [ "modern" ] }
		// })
		require('daisyui'), // ADDED: DaisyUI plugin
	],

	// ADDED: DaisyUI configuration
	daisyui: {
	  themes: ["light", "dark", "cupcake"], // Default themes
	  darkTheme: "dark", // Default dark theme when using data-theme attribute
	},
};

// Use ES Module export
export default config;