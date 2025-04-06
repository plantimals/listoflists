// tailwind.config.ts
import { join } from 'path';
import type { Config } from 'tailwindcss';

// Import the Skeleton plugin
import { skeleton } from '@skeletonlabs/tw-plugin';

const config: Config = {
	// Enable class-based dark mode (recommended for Skeleton)
	darkMode: 'class',

	content: [
		'./src/**/*.{html,js,svelte,ts}',
		// Path to Skeleton components using require.resolve for robustness
		join(require.resolve('@skeletonlabs/skeleton'), '../**/*.{html,js,svelte,ts}')
	],

	theme: {
		extend: {
			// You can add custom theme extensions here
		},
	},

	plugins: [
		// Add the Skeleton plugin and configure your themes
		skeleton({
			// Example: Using the 'modern' preset theme. Add others like 'skeleton', 'vintage', etc.
			themes: { preset: [ "modern" ] }
			// Or define custom themes: themes: { custom: [ myTheme ] }
		})
	]
};

// Use ES Module export
export default config;