import { writable } from 'svelte/store';
import type { NDKUser } from '@nostr-dev-kit/ndk';

const user = writable<NDKUser | null>(null);

export { user }; 