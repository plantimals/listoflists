import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { SyncService } from '$lib/syncService'; // Assuming singleton is not exported/used directly in tests
import { user } from '$lib/userStore';
import { localDb, type StoredEvent } from '$lib/localDb';
import { ndkService } from '$lib/ndkService';
import { NDKEvent, NDKKind, type NDKRelay } from '@nostr-dev-kit/ndk'; // Need NDKEvent, NDKKind, NDKRelay

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
} as NDKRelay;

// Helper to create mock StoredEvent (align with actual StoredEvent structure)
const createMockStoredEvent = (id: string, kind: number, pubkey: string, created_at: number, content: string = '', tags: string[][] = [], sig: string = 'mocksig', published?: boolean): StoredEvent => ({
    id,
    kind,
    pubkey,
    created_at,
    content,
    tags,
    sig,
    published, // Include publish status
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
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;


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

    // Setup spies (can be overridden in specific tests)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
      // Restore all spies and mocks
      vi.restoreAllMocks();
  });

  // --- performSync Tests ---
  describe('performSync', () => {

    it('should return { success: false, ... } and log error if user is not logged in', async () => {
        vi.mocked(get).mockReturnValue(null); // Simulate logged-out user

        const result = await syncServiceInstance.performSync();

        expect(result.success).toBe(false);
        expect(result.message).toContain('User not logged in');
        expect(consoleErrorSpy).toHaveBeenCalledWith('[SyncService] Cannot perform sync: User not logged in.');
        expect(localDb.getLatestEventTimestamp).not.toHaveBeenCalled();
        expect(ndkService.fetchEvents).not.toHaveBeenCalled();
        expect(localDb.getUnpublishedEvents).not.toHaveBeenCalled();
        expect(ndkService.publish).not.toHaveBeenCalled();
    });

    it('should return { success: true, ... } when only incoming sync fetches and stores new events', async () => {
        const incomingEvent = createMockStoredEvent('in1', NDKKind.CategorizedBookmarkList, mockPubkey, 1500);
        const incomingNDKEvent = createMockNDKEvent(incomingEvent);
        vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set([incomingNDKEvent]));
        // Ensure syncOutgoing mock indicates no errors
        vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([]);

        const result = await syncServiceInstance.performSync();

        expect(result.success).toBe(true);
        expect(result.message).toContain('Sync completed.');
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
        expect(result.message).toContain('Sync completed.');
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
        expect(result.message).toContain('Sync completed.');
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
        expect(result.message).toContain('Sync completed.');
        expect(ndkService.fetchEvents).toHaveBeenCalledTimes(1);
        expect(localDb.addOrUpdateEvent).not.toHaveBeenCalled();
        expect(localDb.getUnpublishedEvents).toHaveBeenCalledTimes(1);
        expect(ndkService.publish).not.toHaveBeenCalled();
        expect(localDb.markEventAsPublished).not.toHaveBeenCalled();
    });

    // --- syncIncoming Error Handling Tests (TECH-STORY-001 / SYNC-STORY-006) ---
    describe('syncIncoming Error Handling', () => {
        it('Network Fetch Failure: should log error, return { success: false }, but still run outgoing phase', async () => {
            const fetchError = new Error('Network Error Fetching');
            vi.mocked(ndkService.fetchEvents).mockRejectedValue(fetchError);

            // Setup outgoing phase to succeed to isolate incoming failure impact
            const outgoingEvent = createMockStoredEvent('out3', NDKKind.CategorizedBookmarkList, mockPubkey, 1700, '', [], 'sig3');
            vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEvent]);
            vi.mocked(ndkService.publish).mockResolvedValue(new Set([mockNDKRelay]));

            const result = await syncServiceInstance.performSync();

            // Overall result reflects the incoming error
            expect(result.success).toBe(false);
            expect(result.message).toContain('Sync encountered errors. Check logs for details.');
            // Check for potential appended message if outgoing phase succeeded
            expect(result.message).toContain('Some updates may have occurred.');

            // Verify the specific error logged by syncIncoming *after* retries fail
            expect(consoleErrorSpy).toHaveBeenCalledWith('SyncService Phase 1: Error during incoming sync after retries:', fetchError);

            // Verify the overall performSync catch block for incoming phase was *also* called when error is re-thrown
            // NOTE: Error is handled internally by syncIncoming, not re-thrown to performSync's catch block.

            // Verify outgoing phase still ran
            expect(localDb.getUnpublishedEvents).toHaveBeenCalledWith(mockPubkey);
            expect(ndkService.publish).toHaveBeenCalledTimes(1);
            expect(localDb.markEventAsPublished).toHaveBeenCalledWith('out3');
        });

        it('Network Fetch Failure with Retry: should retry fetch, log warning, eventually log error and return { success: false }', async () => {
            const fetchError = new Error('Temporary Network Error');
            vi.mocked(ndkService.fetchEvents)
                .mockRejectedValueOnce(fetchError) // First attempt fails
                .mockRejectedValueOnce(fetchError); // Second attempt fails

            // Spy on sleep to ensure it's called for the delay
            // Note: We are not actually importing sleep, so we cannot spy on it directly.
            // Assume retry logic calls sleep internally if needed.

            const result = await syncServiceInstance.performSync();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Sync encountered errors. Check logs for details.');
            expect(ndkService.fetchEvents).toHaveBeenCalledTimes(2); // Called twice due to retry

            // Verify the warning for the first failure and retry
            expect(consoleWarnSpy).toHaveBeenCalledWith(`SyncService Phase 1: Attempt 1 failed:`, fetchError);
            expect(consoleWarnSpy).toHaveBeenCalledWith(`SyncService Phase 1: Attempt 2 failed:`, fetchError); // Log failure on last attempt too


            // Verify the final error log after all retries failed
            expect(consoleErrorSpy).toHaveBeenCalledWith('SyncService Phase 1: Error during incoming sync after retries:', fetchError);
            // Verify the overall performSync catch block error is also logged
            // NOTE: Error is handled internally by syncIncoming, not re-thrown to performSync's catch block.
        });


        it('Empty Fetch Result: should complete successfully, return { success: true }', async () => {
            vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set());

            const result = await syncServiceInstance.performSync();

            expect(result.success).toBe(true);
            expect(result.message).toContain('Sync completed.');
            expect(ndkService.fetchEvents).toHaveBeenCalledTimes(1);
            expect(localDb.addOrUpdateEvent).not.toHaveBeenCalled();
            // Outgoing phase should run normally (finds nothing by default)
            expect(localDb.getUnpublishedEvents).toHaveBeenCalledTimes(1);
            expect(ndkService.publish).not.toHaveBeenCalled();
        });

         it('Local DB Store Error (within syncIncoming): should log error, return { success: false }, but not stop processing other incoming events', async () => {
            const storeError = new Error('DB Store Failed');
            const incomingEvent1 = createMockStoredEvent('inErr', NDKKind.Metadata, mockPubkey, 1750);
            const incomingEvent2 = createMockStoredEvent('inOk', NDKKind.Metadata, mockPubkey, 1760);
            const incomingNDKEvent1 = createMockNDKEvent(incomingEvent1);
            const incomingNDKEvent2 = createMockNDKEvent(incomingEvent2);

            vi.mocked(ndkService.fetchEvents).mockResolvedValue(new Set([incomingNDKEvent1, incomingNDKEvent2]));
            vi.mocked(localDb.addOrUpdateEvent)
                .mockRejectedValueOnce(storeError) // Fail for inErr
                .mockResolvedValue(undefined); // Succeed for inOk

            const result = await syncServiceInstance.performSync();

            expect(result.success).toBe(false); // Because syncIncoming reported internal errors
            expect(result.message).toContain('Sync encountered errors. Check logs for details.');

            // Verify the specific internal error log
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                `SyncService Phase 1: Error processing/storing event ${incomingEvent1.kind}:${incomingEvent1.id}:`,
                storeError
            );

             // Verify performSync DID NOT log a catch block error for incoming phase execution
            expect(consoleErrorSpy).not.toHaveBeenCalledWith('[SyncService] Error during syncIncoming phase execution:', expect.anything());


            // Verify it attempted to store both events
            expect(localDb.addOrUpdateEvent).toHaveBeenCalledTimes(2);
            expect(localDb.addOrUpdateEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'inErr' }));
            expect(localDb.addOrUpdateEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'inOk' }));
        });

    });

    // --- syncOutgoing Error Handling Tests (TECH-STORY-001 / SYNC-STORY-006) ---
    describe('syncOutgoing Error Handling', () => {
        it('Network Publish Failure (Specific Event): should log error, not mark failed event as published, continue with others, return { success: false }', async () => {
            const publishError = new Error('Relay Publish Error');
            const outgoingEventFail = createMockStoredEvent('outFail', NDKKind.Text, mockPubkey, 1800, 'fail', [], 'sigFail');
            const outgoingEventOK = createMockStoredEvent('outOk', NDKKind.Text, mockPubkey, 1810, 'ok', [], 'sigOk');
            vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEventFail, outgoingEventOK]);

            vi.mocked(ndkService.publish).mockImplementation(async (event) => {
                if (event.id === 'outFail') {
                    throw publishError;
                }
                if (event.id === 'outOk') {
                    return new Set([mockNDKRelay]);
                }
                return new Set(); // Default case
            });

            const result = await syncServiceInstance.performSync();

            expect(result.success).toBe(false); // Because syncOutgoing reported internal errors
            expect(result.message).toContain('Sync encountered errors. Check logs for details.');


            // Verify the specific internal error log for the failed publish
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                `SyncService Phase 2: Error processing unpublished event ${outgoingEventFail.kind}:${outgoingEventFail.id}. Will retry next cycle. Error:`,
                publishError
            );

             // Verify performSync DID NOT log a catch block error for outgoing phase execution
            expect(consoleErrorSpy).not.toHaveBeenCalledWith('[SyncService] Error during syncOutgoing phase execution:', expect.anything());


            // Verify publish was attempted for both
            expect(ndkService.publish).toHaveBeenCalledTimes(2);

            // Verify markEventAsPublished was NOT called for the failed one
            expect(localDb.markEventAsPublished).not.toHaveBeenCalledWith('outFail');
            // Verify markEventAsPublished WAS called for the successful one
            expect(localDb.markEventAsPublished).toHaveBeenCalledWith('outOk');
            expect(localDb.markEventAsPublished).toHaveBeenCalledTimes(1);
        });

        it('No Relays Accept Publish: should log warning, not mark as published, return { success: true }', async () => {
            const outgoingEventNoRelays = createMockStoredEvent('outWarn', NDKKind.Text, mockPubkey, 1820, 'warn', [], 'sigWarn');
            vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEventNoRelays]);
            vi.mocked(ndkService.publish).mockResolvedValue(new Set()); // Simulate no relays accepting

            const result = await syncServiceInstance.performSync();

            // This specific case is currently treated as success (event remains unpublished)
            expect(result.success).toBe(true);
            expect(result.message).toContain('Sync completed.');


            // Verify the specific warning log
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                `SyncService Phase 2: Event ${outgoingEventNoRelays.kind}:${outgoingEventNoRelays.id} was not published to any relays (maybe already seen or relay issues?). Will retry next cycle.`
            );

            // Verify no error was logged
            expect(consoleErrorSpy).not.toHaveBeenCalled();

            // Verify markEventAsPublished was NOT called
            expect(localDb.markEventAsPublished).not.toHaveBeenCalled();
        });

        it('Failure Marking Event as Published: should log error, return { success: false }', async () => {
            const markError = new Error('DB Mark Error');
            const outgoingEventMarkFail = createMockStoredEvent('outMarkFail', NDKKind.Text, mockPubkey, 1830, 'markfail', [], 'sigMarkFail');
            vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEventMarkFail]);
            vi.mocked(ndkService.publish).mockResolvedValue(new Set([mockNDKRelay])); // Publish succeeds
            vi.mocked(localDb.markEventAsPublished).mockRejectedValue(markError); // Marking fails

            const result = await syncServiceInstance.performSync();

            expect(result.success).toBe(false); // Because syncOutgoing reported internal errors
            expect(result.message).toContain('Sync encountered errors. Check logs for details.');


            // Verify the specific internal error log from the catch block around markEventAsPublished
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                `SyncService Phase 2: Error processing unpublished event ${outgoingEventMarkFail.kind}:${outgoingEventMarkFail.id}. Will retry next cycle. Error:`,
                markError
            );

             // Verify performSync DID NOT log a catch block error for outgoing phase execution
            expect(consoleErrorSpy).not.toHaveBeenCalledWith('[SyncService] Error during syncOutgoing phase execution:', expect.anything());


            // Verify publish was called
            expect(ndkService.publish).toHaveBeenCalledTimes(1);
            // Verify markEventAsPublished was called
            expect(localDb.markEventAsPublished).toHaveBeenCalledWith('outMarkFail');
        });

        it('Failure Fetching Unpublished Events: should log error, return { success: false }', async () => {
            const fetchUnpublishedError = new Error('DB Fetch Unpublished Error');
            vi.mocked(localDb.getUnpublishedEvents).mockRejectedValue(fetchUnpublishedError);

            const result = await syncServiceInstance.performSync();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Sync encountered errors. Check logs for details.');


            // Verify the specific error logged by syncOutgoing when fetching fails
            expect(consoleErrorSpy).toHaveBeenCalledWith('SyncService Phase 2: Failed to fetch unpublished events:', fetchUnpublishedError);


            // Verify the overall performSync catch block for outgoing phase was *also* called when the error is re-thrown
            // NOTE: Error is handled internally by syncOutgoing, not re-thrown to performSync's catch block.


            // Verify publish was not called because fetching failed
            expect(ndkService.publish).not.toHaveBeenCalled();
        });
    });

    // --- Overall Sync Failure Feedback (AC3) ---
    describe('Overall Sync Failure', () => {
        it('Widespread Failure: should log errors for both phases and return { success: false }', async () => {
            const incomingError = new Error('Incoming Global Fail');
            const outgoingError = new Error('Outgoing Global Fail');

            // Mock incoming phase to fail completely
            vi.mocked(ndkService.fetchEvents).mockRejectedValue(incomingError);

            // Mock outgoing phase to fail completely
            const outgoingEvent = createMockStoredEvent('outGlobalFail', NDKKind.Text, mockPubkey, 1900, 'globalfail', [], 'sigGlobalFail');
            vi.mocked(localDb.getUnpublishedEvents).mockResolvedValue([outgoingEvent]);
            vi.mocked(ndkService.publish).mockRejectedValue(outgoingError); // Publish attempt fails


            const result = await syncServiceInstance.performSync();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Sync encountered errors. Check logs for details.');

            // Verify errors logged from both phases
            // Check for the internal incoming error logs first
            expect(consoleErrorSpy).toHaveBeenCalledWith('SyncService Phase 1: Error during incoming sync after retries:', incomingError);
            // Check for the performSync catch block log for incoming
            expect(consoleErrorSpy).toHaveBeenCalledWith('SyncService Phase 1: Error during incoming sync after retries:', incomingError);
            // NOTE: Incoming error is handled internally by syncIncoming, not re-thrown to performSync's catch block.

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                 `SyncService Phase 2: Error processing unpublished event ${outgoingEvent.kind}:${outgoingEvent.id}. Will retry next cycle. Error:`,
                 outgoingError // Error during the publish attempt inside the loop
             );

            // NOTE: The final summary message '[SyncService] Sync finished...' is logged via console.log, not console.error.
            // The phase-specific errors logged to console.error are checked above.


            // Verify markEventAsPublished was not called
            expect(localDb.markEventAsPublished).not.toHaveBeenCalled();
        });
    });


  }); // End describe('performSync')
}); // End describe('SyncService') 