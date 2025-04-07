import { writable } from 'svelte/store';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import type { Writable } from 'svelte/store';

/**
 * Writable Svelte store to hold the array of fetched NIP-51 list events.
 */
const nip51Lists: Writable<NDKEvent[]> = writable([]);

/**
 * Writable Svelte store to track whether the initial flat lists are being loaded.
 */
export const isLoadingLists: Writable<boolean> = writable(false);

export { nip51Lists }; 