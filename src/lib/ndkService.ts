import NDK, { NDKNip07Signer, NDKEvent, type NDKFilter, NDKRelay, type NDKSigner } from "@nostr-dev-kit/ndk";
import { browser } from "$app/environment";

/**
 * Service class for interacting with the Nostr Development Kit (NDK).
 * Manages the NDK instance, relay connections, and provides methods
 * for fetching and publishing Nostr events.
 */
export class NdkService {
    private ndk!: NDK;
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

        let nip07signer: NDKSigner | undefined = undefined;

        if (browser) {
            try {
                 nip07signer = new NDKNip07Signer();
            } catch (e) {
                console.warn("NIP-07 Signer could not be initialized.", e);
                // Allows the app to continue without signing capabilities if NIP-07 is missing
            }
        }

        this.ndk = new NDK({
            explicitRelayUrls: defaultRelays,
            signer: nip07signer,
        });

        console.log('NdkService initialized.');

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
     * Gets the configured NDKSigner, if available.
     */
    public getSigner(): NDKSigner | undefined {
        return this.ndk.signer;
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