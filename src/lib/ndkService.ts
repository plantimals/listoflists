import NDK, { NDKNip07Signer, NDKEvent, type NDKFilter, NDKRelay, type NDKSigner, type NDKUser, NDKNip46Signer } from "@nostr-dev-kit/ndk";
import { browser } from "$app/environment";

/**
 * Service class for interacting with the Nostr Development Kit (NDK).
 * Manages the NDK instance, relay connections, and provides methods
 * for fetching and publishing Nostr events. It supports dynamic activation
 * of different signer types (NIP-07, NIP-46).
 */
export class NdkService {
    private ndk!: NDK;
    private activeSigner: NDKSigner | undefined = undefined; // Holds the currently active signer
    private isConnecting: boolean = false;
    private isConnected: boolean = false;

    /**
     * Initializes the NdkService.
     */
    constructor() {
        const defaultRelays = [
            'wss://purplepag.es',
            'wss://relay.nostr.band',
            'wss://relay.damus.io',
            'wss://nos.lol'
        ];

        // Initialize NDK without a signer; signers will be activated dynamically
        this.ndk = new NDK({
            explicitRelayUrls: defaultRelays,
            // No signer passed here anymore
        });

        console.log('NdkService initialized without a default signer.');

        // Optional: Add listeners for connection events if needed later
        // this.ndk.pool.on('relay:connect', (relay: NDKRelay) => {
        //     console.log('Connected to relay:', relay.url);
        //     this.isConnected = true; // Or track per relay
        // });
        // this.ndk.pool.on('relay:disconnect', (relay: NDKRelay) => {
        //     console.log('Disconnected from relay:', relay.url);
        //     // Check if all relays are disconnected before setting isConnected to false
        // });
    }

    /**
     * Gets the underlying NDK instance.
     * Use specific methods like connect(), fetchEvent() etc. where possible.
     */
    public getNdkInstance(): NDK {
        return this.ndk;
    }

    /**
     * Gets the currently active NDKSigner, if one has been activated.
     */
    public getSigner(): NDKSigner | undefined {
        return this.activeSigner; // Return the internal state
    }

    /**
     * Activates the NIP-07 signer (browser extension).
     * @returns Promise resolving to an object indicating success, the NDKUser, or an error message.
     */
    public async activateNip07Signer(): Promise<{ success: boolean; user?: NDKUser; error?: string }> {
        console.log("Attempting to activate NIP-07 signer...");
        if (!browser) {
            const errorMsg = 'NIP-07 is only available in browser environments.';
            console.warn(`activateNip07Signer: ${errorMsg}`);
            return { success: false, error: errorMsg };
        }

        try {
            const nip07Signer = new NDKNip07Signer();
            // Explicitly ask the signer for the user
            const user = await nip07Signer.user();
            if (user?.pubkey) {
                 console.log(`NIP-07 Signer activated successfully for user: ${user.pubkey}`);
                this.activeSigner = nip07Signer;
                this.ndk.signer = nip07Signer; // Assign to NDK instance as well
                return { success: true, user };
            } else {
                 console.warn("NIP-07 Signer activated but failed to get user info.");
                 // Don't set the signer if we couldn't get the user
                 this.disconnectSigner(); // Ensure clean state
                 return { success: false, error: 'Failed to retrieve user information from NIP-07 signer.' };
            }

        } catch (e: any) {
            const errorMsg = 'Failed to initialize NIP-07 signer or get user.';
            console.error(`activateNip07Signer: ${errorMsg}`, e);
            this.disconnectSigner(); // Ensure clean state on error
            return { success: false, error: `${errorMsg} Error: ${e.message}` };
        }
    }

     /**
     * Activates the NIP-46 signer (remote signing, e.g., Nostr Connect).
     * Uses the provided connection string (nostrconnect:// or bunker://).
     * @param connectionString - The connection string (URI) for NIP-46.
     * @returns Promise resolving to an object indicating success, the NDKUser, or an error message.
     */
    public async activateNip46Signer(connectionString: string): Promise<{ success: boolean; user?: NDKUser; error?: string }> {
        console.log(`Attempting to activate NIP-46 signer with connection string: ${connectionString.substring(0, 50)}...`);

        // Disconnect any existing signer first
        this.disconnectSigner();

        let remoteSigner: NDKNip46Signer | null = null;

        try {
            // Instantiate the NDKNip46Signer
            // Assuming the constructor takes (ndk, connectionToken)
            remoteSigner = new NDKNip46Signer(this.ndk, connectionString);

            // Add listeners for debugging/status (optional but helpful)
            remoteSigner.on('authUrl', (url: string) => { // Add type string to url parameter
                console.log(`%c[NIP-46] Auth URL generated (for signers requiring manual paste): ${url}`, 'color: blue');
                // In a real UI, you might display this URL if the QR/auto-connection fails
            });

            // Wait for the connection to be established and the remote end to be ready
            console.log("[NIP-46] Waiting for signer connection to be ready...");
            await remoteSigner.blockUntilReady(); // This can throw on timeout or connection failure
            console.log("[NIP-46] Signer connection established and ready.");

            // Fetch the user identity from the now-ready remote signer
            const user = await remoteSigner.user(); // This can also throw if the command fails
            if (!user?.pubkey) {
                // No explicit disconnect needed on remoteSigner instance
                // Setting this.ndk.signer = undefined in disconnectSigner() should handle it.
                throw new Error('Remote signer connected but did not provide a valid public key.');
            }

            // Success! Set the active signer.
            console.log(`NIP-46 Signer activated successfully for user: ${user.pubkey}`);
            this.activeSigner = remoteSigner;
            this.ndk.signer = remoteSigner;

            return { success: true, user: user };

        } catch (e: any) {
            const errorMsgBase = 'Failed to connect/authenticate NIP-46 signer.';
            console.error(`activateNip46Signer: ${errorMsgBase}`, e);

            // No explicit disconnect needed on remoteSigner instance.
            // The main disconnectSigner call below handles cleanup.
            // if (remoteSigner && typeof remoteSigner.disconnect === 'function') { ... }

            this.disconnectSigner(); // Ensure NdkService internal state is clean
            return { success: false, error: `${errorMsgBase} ${e.message || 'See console for details.'}` };
        }
    }

    /**
     * Disconnects the currently active signer.
     */
    public disconnectSigner(): void {
        if (this.activeSigner) {
            console.log("Disconnecting active signer...");
            this.activeSigner = undefined;
            this.ndk.signer = undefined;
        } else {
             console.log("No active signer to disconnect.");
        }
    }

    /**
     * Connects to the configured relays if not already connected or connecting.
     */
    public async connect(): Promise<void> {
        if (this.isConnected || this.isConnecting) {
            // console.log('NDK already connected or connecting.');
            return;
        }

        this.isConnecting = true;
        console.log('NdkService: Attempting to connect to relays...');

        try {
            await this.ndk.connect(); // Connect to relays defined in constructor
            this.isConnected = true;
            console.log('NdkService: Connected successfully.');
        } catch (error) {
            console.error('NdkService: Failed to connect to relays:', error);
            this.isConnected = false; // Ensure state reflects failure
            // Rethrow or handle as needed
            throw error;
        } finally {
            this.isConnecting = false;
        }
    }

    /**
     * Fetches a single Nostr event based on the filter.
     * Ensures connection before fetching.
     *
     * @param filter - The NDKFilter to use for fetching.
     * @returns The fetched NDKEvent or null if not found.
     */
    public async fetchEvent(filter: NDKFilter): Promise<NDKEvent | null> {
        await this.connect(); // Ensure connection
        console.log('NdkService: Fetching single event with filter:', filter);
        try {
             const event = await this.ndk.fetchEvent(filter);
             console.log('NdkService: Fetched event:', event?.id ?? 'None found');
             return event;
        } catch (error) {
            console.error('NdkService: Error fetching single event:', error);
            return null;
        }
    }

    /**
     * Fetches a set of Nostr events based on the filter.
     * Ensures connection before fetching.
     *
     * @param filter - The NDKFilter to use for fetching.
     * @returns A Set of fetched NDKEvents.
     */
    public async fetchEvents(filter: NDKFilter): Promise<Set<NDKEvent>> {
        await this.connect(); // Ensure connection
        console.log('NdkService: Fetching events with filter:', filter);
         try {
            const events = await this.ndk.fetchEvents(filter);
            console.log(`NdkService: Fetched ${events.size} events.`);
            return events;
        } catch (error) {
            console.error('NdkService: Error fetching events:', error);
            return new Set<NDKEvent>(); // Return empty set on error
        }
    }

    /**
     * Publishes an NDKEvent to relays.
     * Ensures connection before publishing.
     *
     * @param event - The NDKEvent to publish.
     * @returns A Set of NDKRelays the event was published to.
     */
    public async publish(event: NDKEvent): Promise<Set<NDKRelay>> {
        await this.connect(); // Ensure connection
        console.log(`NdkService: Publishing event ${event.id} (Kind: ${event.kind})...`);
        try {
            const publishedToRelays = await this.ndk.publish(event);
            console.log(`NdkService: Event ${event.id} published to ${publishedToRelays.size} relays.`);
            return publishedToRelays;
        } catch (error) {
            console.error(`NdkService: Error publishing event ${event.id}:`, error);
            return new Set<NDKRelay>(); // Return empty set on error
        }
    }

     /**
     * Gets the current connection status.
     * Note: This reflects the status after the last connect() attempt.
     * For real-time status, NDK pool listeners might be needed.
     */
    public getConnectionStatus(): { isConnected: boolean; isConnecting: boolean } {
        return { isConnected: this.isConnected, isConnecting: this.isConnecting };
    }
}

/**
 * Singleton instance of the NdkService.
 */
export const ndkService = new NdkService(); 