import { writable } from 'svelte/store';

/**
 * A simple store that increments a counter to signal that data needs refreshing.
 * Components can subscribe to this, and the main page can react to changes.
 */
export const refreshTrigger = writable(0); 