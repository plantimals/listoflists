import { writable } from 'svelte/store';
import type { NDKUserProfile } from '@nostr-dev-kit/ndk';

const profile = writable<NDKUserProfile | null>(null);

export { profile }; 