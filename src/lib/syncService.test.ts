import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { SyncService } from '$lib/syncService'; // Assuming singleton is not exported/used directly in tests
import { user } from '$lib/userStore';
import { localDb, type StoredEvent } from '$lib/localDb';
import { ndkService } from '$lib/ndkService';
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'; // Need NDKEvent for outgoing mock reconstruction logic

// --- Mocks ---
vi.mock('$lib/ndkService', () => ({
  ndkService: {
    fetchEvents: vi.fn(),
    publish: vi.fn(),
    getNdkInstance: vi.fn(() => ({})), // Mock NDK instance for NDKEvent constructor
  }
}));

vi.mock('$lib/localDb', () => ({
  localDb: {
    getLatestEventTimestamp: vi.fn(),
    addOrUpdateEvent: vi.fn(),
    getUnpublishedEvents: vi.fn(),
    markEventAsPublished: vi.fn(),
    // Mock other methods if SyncService logic expands to use them
  },
  // Ensure StoredEvent type is correctly exported/available
}));

// Mock svelte/store's get specifically for the user store
vi.mock('svelte/store', async () => {
    const actualStore = await vi.importActual('svelte/store');
    return {
        ...(actualStore as object), // Spread actual exports
        get: vi.fn(), // Mock the get function
    };
});

// Minimal mock for NDKRelay for testing publish success
const mockNDKRelay = {
    url: 'wss://mockrelay.com',
    // Add other properties if SyncService interacts with them, otherwise keep minimal
} as any; // Use 'as any' to bypass strict type checking for the mock

// Helper to create mock StoredEvent (align with actual StoredEvent structure)
const createMockStoredEvent = (id: string, kind: number, pubkey: string, created_at: number, content: string = '', tags: string[][] = [], sig: string = 'mocksig'): StoredEvent => ({
    id,
    kind,
    pubkey,
    created_at,
    content,
    tags,
    sig,
    // rawEvent: JSON.stringify({ id, kind, pubkey, created_at, content, tags, sig }) // Include if SyncService uses it
});

// Helper to create mock NDKEvent (align with actual NDKEvent structure used)
const createMockNDKEvent = (storedEvent: StoredEvent): NDKEvent => {
    const event = new NDKEvent(ndkService.getNdkInstance());
    event.id = storedEvent.id;
    event.kind = storedEvent.kind;
    event.pubkey = storedEvent.pubkey;
    event.created_at = storedEvent.created_at;
    event.content = storedEvent.content;
    event.tags = storedEvent.tags;
    event.sig = storedEvent.sig;
    // Mock rawEvent() if SyncService's reconstruction relies on it or logs it
    vi.spyOn(event, 'rawEvent').mockReturnValue({
        id: storedEvent.id,
        kind: storedEvent.kind,
        pubkey: storedEvent.pubkey,
        created_at: storedEvent.created_at,
        content: storedEvent.content,
        tags: storedEvent.tags,
        sig: storedEvent.sig,
    });
    return event;
};


// --- Test Suite ---
describe('SyncService', () => {
  let syncServiceInstance: SyncService;
  const mockPubkey = 'mockUserPubkey';
  const mockUser = { pubkey: mockPubkey };

  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();

    // Create a new instance for each test to avoid state pollution
    syncServiceInstance = new SyncService();

    // Default mock implementations
    vi.mocked(get).mockImplementation((store: any) => {
        if (store === user) {
            return mockUser; // Default to logged-in user
        }
        // Handle other stores if necessary, otherwise return undefined or mock
        return undefined;
    });
    vi.mocked(localDb.getLatestEventTimestamp).mockResolvedValue(1000);
    vi.mocked(localDb.addOrUpdateEvent).mockResolvedValue(undefined);
    vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([]);
    vi.mocked(localDb.markEventAsPublished).mockResolvedValue(undefined);
    vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set());
    vi.mocked(ndkService.publish).mockResolvedValue(new Set()); // Represents 0 relays published to
  });

  afterEach(() => {
      vi.restoreAllMocks(); // Restore original implementations if any were spied on
  });

  // --- performSync Tests ---
  describe('performSync', () => {

    it('should return false and log error if user is not logged in', async () => {
        vi.mocked(get).mockReturnValue(null); // Simulate logged-out user
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const result = await syncServiceInstance.performSync();

        expect(result).toBe(false);
        expect(consoleErrorSpy).toHaveBeenCalledWith('[SyncService] Cannot perform sync: User not logged in.');
        expect(localDb.getLatestEventTimestamp).not.toHaveBeenCalled();
        expect(ndkService.fetchEvents).not.toHaveBeenCalled();
        expect(localDb.getUnpublishedEvents).not.toHaveBeenCalled();
        expect(ndkService.publish).not.toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
    });

    it('should return true when only incoming sync fetches and stores new events', async () => {
        const incomingEvent = createMockStoredEvent('in1', NDKKind.CategorizedBookmarkList, mockPubkey, 1500);
        const incomingNDKEvent = createMockNDKEvent(incomingEvent);
        vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set([incomingNDKEvent]));

        const result = await syncServiceInstance.performSync();

        expect(result).toBe(true);
        expect(ndkService.fetchEvents).toHaveBeenCalledWith(expect.objectContaining({
            authors: [mockPubkey],
            since: 1001 // latestTimestamp + 1
        }));
        expect(localDb.addOrUpdateEvent).toHaveBeenCalledTimes(1);
        expect(localDb.addOrUpdateEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'in1' }));
        expect(localDb.getUnpublishedEvents).toHaveBeenCalledWith(mockPubkey); // Still checks outgoing
        expect(ndkService.publish).not.toHaveBeenCalled(); // No outgoing events
    });

     it('should return true when only outgoing sync publishes events', async () => {
        const outgoingEvent = createMockStoredEvent('out1', NDKKind.CategorizedBookmarkList, mockPubkey, 1600, '', [], 'sig1');
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEvent]);
        // Mock publish to return a set indicating success (e.g., 1 relay)
        vi.mocked(ndkService.publish).mockResolvedValue(new Set([mockNDKRelay])); // Use mocked relay

        const result = await syncServiceInstance.performSync();

        expect(result).toBe(true);
        expect(ndkService.fetchEvents).toHaveBeenCalled(); // Incoming still runs
        expect(localDb.addOrUpdateEvent).not.toHaveBeenCalled(); // No incoming events
        expect(localDb.getUnpublishedEvents).toHaveBeenCalledWith(mockPubkey);
        expect(ndkService.publish).toHaveBeenCalledTimes(1);
        expect(ndkService.publish).toHaveBeenCalledWith(expect.any(NDKEvent)); // Check the reconstructed event
        // Check if the published event matches the stored data
        const publishedArg = vi.mocked(ndkService.publish).mock.calls[0][0] as NDKEvent;
        expect(publishedArg.id).toBe('out1');
        expect(publishedArg.sig).toBe('sig1');
        expect(localDb.markEventAsPublished).toHaveBeenCalledTimes(1);
        expect(localDb.markEventAsPublished).toHaveBeenCalledWith('out1');
    });

    it('should return true when both incoming and outgoing phases have changes', async () => {
        // Incoming mock
        const incomingEvent = createMockStoredEvent('in2', NDKKind.Metadata, mockPubkey, 1550);
        const incomingNDKEvent = createMockNDKEvent(incomingEvent);
        vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set([incomingNDKEvent]));

        // Outgoing mock
        const outgoingEvent = createMockStoredEvent('out2', NDKKind.CategorizedBookmarkList, mockPubkey, 1650, '', [], 'sig2');
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEvent]);
        vi.mocked(ndkService.publish).mockResolvedValue(new Set([mockNDKRelay])); // Use mocked relay

        const result = await syncServiceInstance.performSync();

        expect(result).toBe(true);
        // Check incoming calls
        expect(ndkService.fetchEvents).toHaveBeenCalledTimes(1);
        expect(localDb.addOrUpdateEvent).toHaveBeenCalledTimes(1);
        expect(localDb.addOrUpdateEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'in2' }));
        // Check outgoing calls
        expect(localDb.getUnpublishedEvents).toHaveBeenCalledTimes(1);
        expect(ndkService.publish).toHaveBeenCalledTimes(1);
        expect(localDb.markEventAsPublished).toHaveBeenCalledTimes(1);
        expect(localDb.markEventAsPublished).toHaveBeenCalledWith('out2');
    });

    it('should return false when neither incoming nor outgoing phases have changes', async () => {
        // Mocks are default: fetchEvents returns empty, getUnpublishedEvents returns empty
        const result = await syncServiceInstance.performSync();

        expect(result).toBe(false);
        expect(ndkService.fetchEvents).toHaveBeenCalledTimes(1);
        expect(localDb.addOrUpdateEvent).not.toHaveBeenCalled();
        expect(localDb.getUnpublishedEvents).toHaveBeenCalledTimes(1);
        expect(ndkService.publish).not.toHaveBeenCalled();
        expect(localDb.markEventAsPublished).not.toHaveBeenCalled();
    });

    // --- Error Handling ---

    it('should handle error during incoming phase and still run outgoing phase (returning true if outgoing succeeds)', async () => {
        const error = new Error('Failed to fetch');
        vi.mocked(ndkService.fetchEvents).mockRejectedValue(error);
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Mock outgoing to succeed
        const outgoingEvent = createMockStoredEvent('out3', NDKKind.CategorizedBookmarkList, mockPubkey, 1700, '', [], 'sig3');
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEvent]);
        vi.mocked(ndkService.publish).mockResolvedValue(new Set([mockNDKRelay])); // Use mocked relay

        const result = await syncServiceInstance.performSync();

        expect(result).toBe(true); // Outgoing succeeded
        expect(consoleErrorSpy).toHaveBeenCalledWith('SyncService Phase 1: Error during incoming sync:', error);
        expect(localDb.addOrUpdateEvent).not.toHaveBeenCalled(); // Incoming failed
        // Check outgoing still ran
        expect(localDb.getUnpublishedEvents).toHaveBeenCalledTimes(1);
        expect(ndkService.publish).toHaveBeenCalledTimes(1);
        expect(localDb.markEventAsPublished).toHaveBeenCalledWith('out3');

        consoleErrorSpy.mockRestore();
    });

     it('should handle error during outgoing phase after incoming phase succeeds (returning true)', async () => {
        const error = new Error('Failed to publish');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Mock incoming to succeed
        const incomingEvent = createMockStoredEvent('in3', NDKKind.Metadata, mockPubkey, 1750);
        const incomingNDKEvent = createMockNDKEvent(incomingEvent);
        vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set([incomingNDKEvent]));

        // Mock outgoing to fail
        const outgoingEvent = createMockStoredEvent('out4', NDKKind.CategorizedBookmarkList, mockPubkey, 1800, '', [], 'sig4');
         vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEvent]);
        vi.mocked(ndkService.publish).mockRejectedValue(error); // Simulate publish failure

        const result = await syncServiceInstance.performSync();

        expect(result).toBe(true); // Incoming succeeded
        // Check incoming ran
        expect(ndkService.fetchEvents).toHaveBeenCalledTimes(1);
        expect(localDb.addOrUpdateEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'in3' }));
        // Check outgoing ran but failed
        expect(localDb.getUnpublishedEvents).toHaveBeenCalledTimes(1);
        expect(ndkService.publish).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(`SyncService Phase 2: Error publishing event ${outgoingEvent.id}:`, error);
        expect(localDb.markEventAsPublished).not.toHaveBeenCalled(); // Publish failed

        consoleErrorSpy.mockRestore();
    });

     it('should return false if both incoming and outgoing phases fail', async () => {
        const fetchError = new Error('Failed to fetch');
        const publishError = new Error('Failed to publish');
        vi.mocked(ndkService.fetchEvents).mockRejectedValue(fetchError);
        vi.mocked(ndkService.publish).mockRejectedValue(publishError); // Mock publish directly, as getUnpublishedEvents might succeed
        // Ensure getUnpublishedEvents returns something so publish is attempted
        const outgoingEvent = createMockStoredEvent('out5', NDKKind.CategorizedBookmarkList, mockPubkey, 1900, '', [], 'sig5');
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEvent]);

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const result = await syncServiceInstance.performSync();

        expect(result).toBe(false); // Neither phase resulted in a positive refresh signal
        expect(consoleErrorSpy).toHaveBeenCalledWith('SyncService Phase 1: Error during incoming sync:', fetchError);
        expect(consoleErrorSpy).toHaveBeenCalledWith(`SyncService Phase 2: Error publishing event ${outgoingEvent.id}:`, publishError);
        expect(localDb.addOrUpdateEvent).not.toHaveBeenCalled();
        expect(localDb.markEventAsPublished).not.toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
     });

     it('should handle error when getting unpublished events', async () => {
         const getUnpublishedError = new Error('DB error getting unpublished');
         vi.mocked(localDb.getUnpublishedEvents).mockRejectedValue(getUnpublishedError);
         const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

         // Mock incoming to succeed
         const incomingEvent = createMockStoredEvent('in4', NDKKind.Metadata, mockPubkey, 1950);
         const incomingNDKEvent = createMockNDKEvent(incomingEvent);
         vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set([incomingNDKEvent]));

         const result = await syncServiceInstance.performSync();

         expect(result).toBe(true); // Incoming succeeded
         expect(ndkService.fetchEvents).toHaveBeenCalledTimes(1);
         expect(localDb.addOrUpdateEvent).toHaveBeenCalledTimes(1);
         expect(localDb.getUnpublishedEvents).toHaveBeenCalledTimes(1);
         expect(consoleErrorSpy).toHaveBeenCalledWith('SyncService Phase 2: Failed to fetch unpublished events:', getUnpublishedError);
         expect(ndkService.publish).not.toHaveBeenCalled(); // Failed before publish
         expect(localDb.markEventAsPublished).not.toHaveBeenCalled();

         consoleErrorSpy.mockRestore();
     });

     it('should handle error when marking event as published (outgoing phase)', async () => {
        const markPublishedError = new Error('DB error marking published');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Mock incoming to have no changes
        vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set());

        // Mock outgoing event fetch and publish success
        const outgoingEvent = createMockStoredEvent('out6', NDKKind.CategorizedBookmarkList, mockPubkey, 2000, '', [], 'sig6');
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEvent]);
        vi.mocked(ndkService.publish).mockResolvedValue(new Set([mockNDKRelay])); // Use mocked relay

        // Mock markEventAsPublished to fail
        vi.mocked(localDb.markEventAsPublished).mockRejectedValue(markPublishedError);

        const result = await syncServiceInstance.performSync();

        // Result should be false because although publish succeeded, the marking failed,
        // so syncOutgoing internally returns false.
        expect(result).toBe(false);
        expect(ndkService.fetchEvents).toHaveBeenCalledTimes(1);
        expect(localDb.addOrUpdateEvent).not.toHaveBeenCalled();
        expect(localDb.getUnpublishedEvents).toHaveBeenCalledTimes(1);
        expect(ndkService.publish).toHaveBeenCalledTimes(1);
        expect(localDb.markEventAsPublished).toHaveBeenCalledTimes(1); // It was called
        // Check the specific error log inside syncOutgoing's loop
        expect(consoleErrorSpy).toHaveBeenCalledWith(`SyncService Phase 2: Error publishing event ${outgoingEvent.id}:`, markPublishedError); // This comes from the inner catch block
        // The outer catch block in performSync for syncOutgoing won't log unless syncOutgoing *itself* throws,
        // which it doesn't in this case (it just returns false).

        consoleErrorSpy.mockRestore();
     });

     it('should correctly use latest timestamp for incoming filter', async () => {
        vi.mocked(localDb.getLatestEventTimestamp).mockResolvedValue(1234567890);

        await syncServiceInstance.performSync();

        expect(localDb.getLatestEventTimestamp).toHaveBeenCalledWith(mockPubkey);
        expect(ndkService.fetchEvents).toHaveBeenCalledWith(expect.objectContaining({
            since: 1234567891 // +1
        }));
     });

     it('should use undefined for `since` if no local events exist', async () => {
        // Use type assertion as any to bypass strict type check for the mock implementation
        vi.mocked(localDb.getLatestEventTimestamp).mockImplementation(async () => null as any);

        await syncServiceInstance.performSync();

        expect(localDb.getLatestEventTimestamp).toHaveBeenCalledWith(mockPubkey);
        expect(ndkService.fetchEvents).toHaveBeenCalledWith(expect.objectContaining({
            since: undefined
        }));
     });
  });

  // Add describe blocks for syncIncoming/syncOutgoing if they become public later
  // or add more performSync tests to cover specific edge cases within them.

}); 