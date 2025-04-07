import NDK, { NDKNip07Signer, type NDKSigner } from "@nostr-dev-kit/ndk";
import { readable, type Readable } from "svelte/store";
import { browser } from "$app/environment"; // Import browser check

// Define default relays (Using a different set)
const defaultRelays: string[] = [
    'wss://purplepag.es',
    'wss://relay.nostr.band',
    'wss://nos.lol'
    // 'wss://relay.damus.io', // Often reliable but can be busy
    // 'wss://relay.primal.net', // Also good but trying others
];

// Initialize signer variable - will be assigned only in browser
let nip07signer: NDKSigner | undefined = undefined;

// Instantiate NIP-07 signer ONLY in the browser
if (browser) {
    nip07signer = new NDKNip07Signer();
    // Optional: Add a short delay for the extension to be ready, though NDK might handle this.
    // await new Promise(resolve => setTimeout(resolve, 50)); 
}

// Instantiate NDK, passing the signer only if it was created (i.e., in browser)
const ndkInstance: NDK = new NDK({
    explicitRelayUrls: defaultRelays,
    signer: nip07signer, 
});

// Create a readable Svelte store that holds the NDK instance
// The instance itself is created immediately, but signer and connection
// are handled conditionally based on the environment.
const ndk: Readable<NDK> = readable<NDK>(ndkInstance);

// Export the store for use in other parts of the application
export { ndk }; 