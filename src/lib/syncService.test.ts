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

    it('should return { success: false, ... } and log error if user is not logged in', async () => {
        vi.mocked(get).mockReturnValue(null); // Simulate logged-out user
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const result = await syncServiceInstance.performSync();

        expect(result.success).toBe(false);
        expect(result.message).toContain('User not logged in');
        expect(consoleErrorSpy).toHaveBeenCalledWith('[SyncService] Cannot perform sync: User not logged in.');
        expect(localDb.getLatestEventTimestamp).not.toHaveBeenCalled();
        expect(ndkService.fetchEvents).not.toHaveBeenCalled();
        expect(localDb.getUnpublishedEvents).not.toHaveBeenCalled();
        expect(ndkService.publish).not.toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
    });

    it('should return { success: true, ... } when only incoming sync fetches and stores new events', async () => {
        const incomingEvent = createMockStoredEvent('in1', NDKKind.CategorizedBookmarkList, mockPubkey, 1500);
        const incomingNDKEvent = createMockNDKEvent(incomingEvent);
        vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set([incomingNDKEvent]));
        // Ensure syncOutgoing mock indicates no errors
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([]);

        const result = await syncServiceInstance.performSync();

        expect(result.success).toBe(true);
        expect(ndkService.fetchEvents).toHaveBeenCalledWith(expect.objectContaining({ authors: [mockPubkey], since: 1001 }));
        expect(localDb.addOrUpdateEvent).toHaveBeenCalledTimes(1);
        expect(localDb.addOrUpdateEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'in1' }));
        expect(localDb.getUnpublishedEvents).toHaveBeenCalledWith(mockPubkey);
        expect(ndkService.publish).not.toHaveBeenCalled();
    });

    it('should return { success: true, ... } when only outgoing sync publishes events', async () => {
        const outgoingEvent = createMockStoredEvent('out1', NDKKind.CategorizedBookmarkList, mockPubkey, 1600, '', [], 'sig1');
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEvent]);
        vi.mocked(ndkService.publish).mockResolvedValue(new Set([mockNDKRelay]));
        // Ensure syncIncoming mock indicates no errors
        vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set());
        vi.mocked(localDb.getLatestEventTimestamp).mockResolvedValue(1000); // Ensure timestamp is checked

        const result = await syncServiceInstance.performSync();

        expect(result.success).toBe(true);
        expect(ndkService.fetchEvents).toHaveBeenCalled();
        expect(localDb.addOrUpdateEvent).not.toHaveBeenCalled();
        expect(localDb.getUnpublishedEvents).toHaveBeenCalledWith(mockPubkey);
        expect(ndkService.publish).toHaveBeenCalledTimes(1);
        expect(localDb.markEventAsPublished).toHaveBeenCalledTimes(1);
        expect(localDb.markEventAsPublished).toHaveBeenCalledWith('out1');
    });

    it('should return { success: true, ... } when both incoming and outgoing phases have changes without errors', async () => {
        // Incoming mock
        const incomingEvent = createMockStoredEvent('in2', NDKKind.Metadata, mockPubkey, 1550);
        const incomingNDKEvent = createMockNDKEvent(incomingEvent);
        vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set([incomingNDKEvent]));

        // Outgoing mock
        const outgoingEvent = createMockStoredEvent('out2', NDKKind.CategorizedBookmarkList, mockPubkey, 1650, '', [], 'sig2');
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEvent]);
        vi.mocked(ndkService.publish).mockResolvedValue(new Set([mockNDKRelay]));

        const result = await syncServiceInstance.performSync();

        expect(result.success).toBe(true);
        expect(ndkService.fetchEvents).toHaveBeenCalledTimes(1);
        expect(localDb.addOrUpdateEvent).toHaveBeenCalledTimes(1);
        expect(localDb.getUnpublishedEvents).toHaveBeenCalledTimes(1);
        expect(ndkService.publish).toHaveBeenCalledTimes(1);
        expect(localDb.markEventAsPublished).toHaveBeenCalledTimes(1);
        expect(localDb.markEventAsPublished).toHaveBeenCalledWith('out2');
    });

    it('should return { success: true, ... } when neither incoming nor outgoing phases have changes', async () => {
        // Mocks are default: fetchEvents empty, getUnpublishedEvents empty
        const result = await syncServiceInstance.performSync();

        expect(result.success).toBe(true); // No errors occurred
        expect(ndkService.fetchEvents).toHaveBeenCalledTimes(1);
        expect(localDb.addOrUpdateEvent).not.toHaveBeenCalled();
        expect(localDb.getUnpublishedEvents).toHaveBeenCalledTimes(1);
        expect(ndkService.publish).not.toHaveBeenCalled();
        expect(localDb.markEventAsPublished).not.toHaveBeenCalled();
    });


    // --- Error Handling Tests (Updated for new logic) ---

    it('should return { success: false, ... } when incoming fetch eventually fails (error caught internally)', async () => {
        const error = new Error('Failed to fetch');
        vi.mocked(ndkService.fetchEvents)
            .mockRejectedValueOnce(error) // First call fails
            .mockRejectedValueOnce(error); // Second call fails, syncIncoming catches internally
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {}); // Suppress retry warning

        // Mock outgoing to succeed without internal errors
        const outgoingEvent = createMockStoredEvent('out3', NDKKind.CategorizedBookmarkList, mockPubkey, 1700, '', [], 'sig3');
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEvent]);
        vi.mocked(ndkService.publish).mockResolvedValue(new Set([mockNDKRelay]));
        vi.mocked(localDb.markEventAsPublished).mockResolvedValue(undefined);

        const result = await syncServiceInstance.performSync();

        expect(result.success).toBe(false); // Because syncIncoming reported internal errors
        expect(result.message).toContain('Sync encountered errors');
        // Check the *internal* error logged by syncIncoming after retries
        expect(consoleErrorSpy).toHaveBeenCalledWith('SyncService Phase 1: Error during incoming sync after retries:', error);
        // Ensure the performSync catch block was NOT called
        expect(consoleErrorSpy).not.toHaveBeenCalledWith('[SyncService] Error during syncIncoming phase execution:', expect.anything());
        // Outgoing should still run successfully internally
        expect(localDb.markEventAsPublished).toHaveBeenCalledWith('out3');

        consoleErrorSpy.mockRestore();
        vi.mocked(console.warn).mockRestore();
    });

    it('should return { success: false, ... } when incoming has internal store error', async () => {
        const storeError = new Error('DB Store Failed');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Mock incoming fetch succeeds, but store fails internally
        const incomingEvent = createMockStoredEvent('in3', NDKKind.Metadata, mockPubkey, 1750);
        const incomingNDKEvent = createMockNDKEvent(incomingEvent);
        vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set([incomingNDKEvent]));
        vi.mocked(localDb.addOrUpdateEvent).mockRejectedValue(storeError); // Store fails internally

        // Mock outgoing succeeds without internal errors
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([]);

        const result = await syncServiceInstance.performSync();

        expect(result.success).toBe(false); // Because syncIncoming reported internal errors
        expect(result.message).toContain('Sync encountered errors');
        // Check the internal error log from syncIncoming
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('SyncService Phase 1: Error processing/storing event 0:in3'),
            storeError
        );
        // Check that performSync did NOT log a caught error for incoming
        expect(consoleErrorSpy).not.toHaveBeenCalledWith('[SyncService] Error during syncIncoming phase execution:', expect.anything());
        // Outgoing should have run
        expect(localDb.getUnpublishedEvents).toHaveBeenCalledTimes(1);

        consoleErrorSpy.mockRestore();
    });

    it('should return { success: false, ... } when outgoing publish fails (internal error)', async () => {
        const publishError = new Error('Failed to publish');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Mock incoming succeeds without internal errors
        vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set());

        // Mock outgoing fetch succeeds, but publish fails internally
        const outgoingEvent = createMockStoredEvent('out4', NDKKind.CategorizedBookmarkList, mockPubkey, 1800, '', [], 'sig4');
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEvent]);
        vi.mocked(ndkService.publish).mockRejectedValue(publishError); // Publish fails internally

        const result = await syncServiceInstance.performSync();

        expect(result.success).toBe(false); // Because syncOutgoing reported internal errors
        expect(result.message).toContain('Sync encountered errors');
        // Check the internal error log from syncOutgoing
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error processing unpublished event 30001:out4'), publishError);
        // Check that performSync did NOT log a caught error for outgoing
        expect(consoleErrorSpy).not.toHaveBeenCalledWith('[SyncService] Error during syncOutgoing phase execution:', expect.anything());
        expect(localDb.markEventAsPublished).not.toHaveBeenCalled(); // Mark shouldn't be called

        consoleErrorSpy.mockRestore();
    });

    it('should return { success: false, ... } when outgoing markEventAsPublished fails (internal error)', async () => {
        const markError = new Error('DB error marking published');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.resetAllMocks(); // Isolate this test
        vi.mocked(get).mockImplementation((store: any) => store === user ? mockUser : undefined);

        // Mock incoming succeeds without internal errors
        vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set());
        vi.mocked(localDb.getLatestEventTimestamp).mockResolvedValue(1000); // Needed after reset

        // Mock outgoing fetch succeeds, publish succeeds, mark fails internally
        const outgoingEvent = createMockStoredEvent('out6', NDKKind.CategorizedBookmarkList, mockPubkey, 1950, '', [], 'sig6');
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEvent]);
        vi.mocked(ndkService.publish).mockResolvedValue(new Set([mockNDKRelay]));
        vi.mocked(localDb.markEventAsPublished).mockRejectedValue(markError); // Mark fails internally

        const result = await syncServiceInstance.performSync();

        expect(result.success).toBe(false); // Because syncOutgoing reported internal errors
        expect(result.message).toContain('Sync encountered errors');
        expect(ndkService.publish).toHaveBeenCalledTimes(1);
        expect(localDb.markEventAsPublished).toHaveBeenCalledTimes(1); // It was called
        // Check the internal error log from syncOutgoing
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(`Error processing unpublished event ${NDKKind.CategorizedBookmarkList}:out6`), markError);
        // Check that performSync did NOT log a caught error for outgoing
        expect(consoleErrorSpy).not.toHaveBeenCalledWith('[SyncService] Error during syncOutgoing phase execution:', expect.anything());

        consoleErrorSpy.mockRestore();
    });

    it('should return { success: false, ... } when outgoing fetching unpublished fails (error caught internally)', async () => {
        const getUnpublishedError = new Error('DB error getting unpublished');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Mock incoming succeeds without internal errors
        vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set());

        // Mock outgoing fetch fails (error caught internally by syncOutgoing)
        vi.mocked(localDb.getUnpublishedEvents).mockRejectedValue(getUnpublishedError);

        const result = await syncServiceInstance.performSync();

        expect(result.success).toBe(false); // Because syncOutgoing reported internal errors
        expect(result.message).toContain('Sync encountered errors');
        // Check the *internal* error logged by syncOutgoing
        expect(consoleErrorSpy).toHaveBeenCalledWith('SyncService Phase 2: Failed to fetch unpublished events:', getUnpublishedError);
        // Ensure the performSync catch block was NOT called
        expect(consoleErrorSpy).not.toHaveBeenCalledWith('[SyncService] Error during syncOutgoing phase execution:', expect.anything());
        expect(ndkService.publish).not.toHaveBeenCalled(); // Didn't get to publish

        consoleErrorSpy.mockRestore();
    });

    it('should return { success: false, ... } if both incoming fetch fails (internal) and outgoing publish fails (internal)', async () => {
        const fetchError = new Error('Fetch failed');
        const publishError = new Error('Publish failed');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
         vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Mock incoming fetch failure (caught internally)
        vi.mocked(ndkService.fetchEvents)
            .mockRejectedValueOnce(fetchError)
            .mockRejectedValueOnce(fetchError);

        // Mock outgoing publish failure (internal error)
        const outgoingEvent = createMockStoredEvent('out5', NDKKind.CategorizedBookmarkList, mockPubkey, 1850, '', [], 'sig5');
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEvent]);
        vi.mocked(ndkService.publish).mockRejectedValue(publishError);

        const result = await syncServiceInstance.performSync();

        expect(result.success).toBe(false); // Both phases had internal errors
        expect(result.message).toContain('Sync encountered errors');
        // Check internal error logged by syncIncoming
        expect(consoleErrorSpy).toHaveBeenCalledWith('SyncService Phase 1: Error during incoming sync after retries:', fetchError);
        // Check internal error logged by syncOutgoing for publish failure
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(`Error processing unpublished event ${NDKKind.CategorizedBookmarkList}:out5`), publishError);
        // Ensure performSync catch blocks were NOT called
        expect(consoleErrorSpy).not.toHaveBeenCalledWith('[SyncService] Error during syncIncoming phase execution:', expect.anything());
        expect(consoleErrorSpy).not.toHaveBeenCalledWith('[SyncService] Error during syncOutgoing phase execution:', expect.anything());
        expect(localDb.markEventAsPublished).not.toHaveBeenCalled(); // Publish failed

        consoleErrorSpy.mockRestore();
        vi.mocked(console.warn).mockRestore();
    });


    // ... tests for timestamp handling (ensure mocks are reset/set if needed) ...
    it('should correctly use latest timestamp for incoming filter', async () => {
        vi.resetAllMocks(); // Isolate test
        vi.mocked(get).mockImplementation((store: any) => store === user ? mockUser : undefined);
        vi.mocked(localDb.getLatestEventTimestamp).mockResolvedValue(12345);
        // Mock other calls to prevent unintended errors/logs
        vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set());
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([]);

        await syncServiceInstance.performSync();
        expect(ndkService.fetchEvents).toHaveBeenCalledWith(expect.objectContaining({ since: 12346 }));
    });

    it('should use undefined for `since` if no local events exist', async () => {
        vi.resetAllMocks(); // Isolate test
        vi.mocked(get).mockImplementation((store: any) => store === user ? mockUser : undefined);
        vi.mocked(localDb.getLatestEventTimestamp).mockResolvedValue(0); // Or null/undefined
        // Mock other calls
        vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set());
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([]);

        await syncServiceInstance.performSync();
        expect(ndkService.fetchEvents).toHaveBeenCalledWith(expect.objectContaining({ since: undefined }));
    });
  });

  // Add describe blocks for syncIncoming/syncOutgoing if they become public later
  // or add more performSync tests to cover specific edge cases within them.

}); 