import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist the mock definitions explicitly
const { mockNdkInstance, mockNip07SignerInstance, MockNDK, MockNip07Signer } = vi.hoisted(() => {
    const mockNdkInstance = {
        connect: vi.fn(),
        fetchEvent: vi.fn(),
        fetchEvents: vi.fn(),
        publish: vi.fn(),
        signer: undefined as any,
        pool: { on: vi.fn() }
    };
    const mockNip07SignerInstance = {
        user: vi.fn(),
    };
    // Create mock constructor functions that return the instances
    const MockNDK = vi.fn(() => mockNdkInstance);
    const MockNip07Signer = vi.fn(() => mockNip07SignerInstance);
    return { mockNdkInstance, mockNip07SignerInstance, MockNDK, MockNip07Signer };
});

// Mock the module using the hoisted mock constructors
vi.mock('@nostr-dev-kit/ndk', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@nostr-dev-kit/ndk')>();
    return {
        ...actual,
        default: MockNDK, // Reference the hoisted mock constructor
        NDKNip07Signer: MockNip07Signer, // Reference the hoisted mock constructor
    };
});

// Mock SvelteKit's browser environment using a getter
const mockBrowser = vi.hoisted(() => ({ value: true }));
vi.mock('$app/environment', () => ({
    // Use a getter to dynamically read the current value
    get browser() { return mockBrowser.value; }
}));

// Dynamically import the service *after* mocks are set up
import { NdkService } from './ndkService';
import NDKOriginal, { NDKNip07Signer as NDKNip07SignerOriginal } from '@nostr-dev-kit/ndk';

// --- Default Relays for comparison ---
const defaultRelays = [
    'wss://purplepag.es',
    'wss://relay.nostr.band',
    'wss://relay.damus.io',
    'wss://nos.lol'
];

// --- Test Suite ---
describe('NdkService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockNdkInstance.signer = undefined;
        mockNdkInstance.connect.mockResolvedValue(undefined);
        mockNdkInstance.fetchEvent.mockResolvedValue(null);
        mockNdkInstance.fetchEvents.mockResolvedValue(new Set());
        mockNdkInstance.publish.mockResolvedValue(new Set());
        mockNip07SignerInstance.user.mockResolvedValue({ pubkey: 'testpubkey' });
        MockNip07Signer.mockImplementation(() => mockNip07SignerInstance);
    });

    // --- Constructor Tests ---
    describe('constructor', () => {
        it('should initialize NDK with default relays in browser environment', () => {
            mockBrowser.value = true;
            const instance = new NdkService();
            expect(MockNDK).toHaveBeenCalledTimes(1);
            expect(MockNDK).toHaveBeenCalledWith(expect.objectContaining({ explicitRelayUrls: defaultRelays }));
        });

        it('should initialize NIP-07 signer and pass it to NDK in browser environment', () => {
            mockBrowser.value = true;
            const instance = new NdkService();
            expect(MockNip07Signer).toHaveBeenCalledTimes(1);
            expect(MockNDK).toHaveBeenCalledWith(expect.objectContaining({ signer: mockNip07SignerInstance }));
        });

        it('should handle NIP-07 signer initialization error gracefully in browser', () => {
            mockBrowser.value = true;
            const errorSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            MockNip07Signer.mockImplementationOnce(() => { throw new Error('NIP-07 unavailable'); });
            const instance = new NdkService();
            expect(MockNip07Signer).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('NIP-07 Signer could not be initialized'), expect.any(Error));
            expect(MockNDK).toHaveBeenCalledWith(expect.objectContaining({ signer: undefined }));
            errorSpy.mockRestore();
        });

        it('should initialize NDK without signer when not in browser environment', () => {
            mockBrowser.value = false;
            mockNdkInstance.signer = undefined;
            // Explicitly clear calls for this specific mock before test execution
            MockNip07Signer.mockClear(); 
            const instance = new NdkService(); 
            expect(MockNip07Signer).not.toHaveBeenCalled();
            expect(MockNDK).toHaveBeenCalledTimes(1);
            expect(MockNDK).toHaveBeenCalledWith(expect.objectContaining({ explicitRelayUrls: defaultRelays, signer: undefined }));
        });
    });

    // --- connect() Tests ---
    describe('connect', () => {
        let ndkServiceInstance: NdkService;
        beforeEach(() => {
            mockBrowser.value = true;
            ndkServiceInstance = new NdkService();
            mockNdkInstance.signer = mockNip07SignerInstance;
        });

        it('should call ndk.connect() when not connected', async () => {
            await ndkServiceInstance.connect();
            expect(mockNdkInstance.connect).toHaveBeenCalledTimes(1);
        });

        it('should set connection state correctly on successful connection', async () => {
            expect(ndkServiceInstance.getConnectionStatus()).toEqual({ isConnected: false, isConnecting: false });
            await ndkServiceInstance.connect();
            expect(ndkServiceInstance.getConnectionStatus()).toEqual({ isConnected: true, isConnecting: false });
            expect(mockNdkInstance.connect).toHaveBeenCalledTimes(1);
        });

        it('should not call ndk.connect() if already connected', async () => {
            // First connection
            await ndkServiceInstance.connect();
            expect(mockNdkInstance.connect).toHaveBeenCalledTimes(1);
            expect(ndkServiceInstance.getConnectionStatus().isConnected).toBe(true);

            // Second attempt
            await ndkServiceInstance.connect();
            expect(mockNdkInstance.connect).toHaveBeenCalledTimes(1); // Should not be called again
        });

        it('should not call ndk.connect() if currently connecting (simulated)', async () => {
             // Simulate race condition: call connect twice quickly
            const connectPromise1 = ndkServiceInstance.connect();
            const connectPromise2 = ndkServiceInstance.connect(); // Second call while first might be in progress

            await Promise.all([connectPromise1, connectPromise2]);

            // connect() should only be called once by the underlying ndk instance
            expect(mockNdkInstance.connect).toHaveBeenCalledTimes(1);
             expect(ndkServiceInstance.getConnectionStatus().isConnected).toBe(true);
        });

        it('should set connection state correctly on failed connection and rethrow error', async () => {
            const connectError = new Error('Relay connection failed');
            mockNdkInstance.connect.mockRejectedValueOnce(connectError);

            expect(ndkServiceInstance.getConnectionStatus()).toEqual({ isConnected: false, isConnecting: false });

            await expect(ndkServiceInstance.connect()).rejects.toThrow(connectError);

            expect(mockNdkInstance.connect).toHaveBeenCalledTimes(1);
            expect(ndkServiceInstance.getConnectionStatus()).toEqual({ isConnected: false, isConnecting: false });
        });
    });

    // --- getSigner() Tests ---
    describe('getSigner', () => {
        let ndkServiceInstance: NdkService;
        beforeEach(() => {
            mockBrowser.value = true;
            mockNdkInstance.signer = mockNip07SignerInstance;
            ndkServiceInstance = new NdkService();
        });

        it('should return the signer from the NDK instance in browser env', () => {
            expect(ndkServiceInstance.getSigner()).toBe(mockNip07SignerInstance);
        });

        it('should return undefined if NDK has no signer (non-browser)', () => {
            mockBrowser.value = false;
            mockNdkInstance.signer = undefined;
            const nonBrowserInstance = new NdkService();
            expect(nonBrowserInstance.getSigner()).toBeUndefined();
        });
    });

    // --- getNdkInstance() Tests ---
     describe('getNdkInstance', () => {
        it('should return the underlying mock NDK instance', () => {
            mockBrowser.value = true;
            const instance = new NdkService();
            expect(instance.getNdkInstance()).toBe(mockNdkInstance);
        });
    });

    // --- fetchEvent() Tests ---
    describe('fetchEvent', () => {
        let ndkServiceInstance: NdkService;
        beforeEach(() => {
            mockBrowser.value = true;
            ndkServiceInstance = new NdkService();
            mockNdkInstance.signer = mockNip07SignerInstance;
        });
        const testFilter = { kinds: [1], authors: ['testauthor'], limit: 1 };

        it('should ensure connection before fetching', async () => {
            await ndkServiceInstance.fetchEvent(testFilter);
            expect(mockNdkInstance.connect).toHaveBeenCalledTimes(1);
        });

        it('should call ndk.fetchEvent with the provided filter', async () => {
            await ndkServiceInstance.fetchEvent(testFilter);
            expect(mockNdkInstance.fetchEvent).toHaveBeenCalledTimes(1);
            expect(mockNdkInstance.fetchEvent).toHaveBeenCalledWith(testFilter);
        });

        it('should return the event returned by ndk.fetchEvent', async () => {
            const mockEvent = { id: 'event1', kind: 1 } as any; // Mock NDKEvent
            mockNdkInstance.fetchEvent.mockResolvedValueOnce(mockEvent);
            const result = await ndkServiceInstance.fetchEvent(testFilter);
            expect(result).toBe(mockEvent);
        });

        it('should return null if ndk.fetchEvent throws an error', async () => {
            const fetchError = new Error('Fetch failed');
            mockNdkInstance.fetchEvent.mockRejectedValueOnce(fetchError);
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await ndkServiceInstance.fetchEvent(testFilter);

            expect(result).toBeNull();
            expect(errorSpy).toHaveBeenCalledWith(
                'NdkService: Error fetching single event:', fetchError
            );
            errorSpy.mockRestore();
        });
    });

    // --- fetchEvents() Tests ---
    describe('fetchEvents', () => {
        let ndkServiceInstance: NdkService;
        beforeEach(() => {
            mockBrowser.value = true;
            ndkServiceInstance = new NdkService();
            mockNdkInstance.signer = mockNip07SignerInstance;
        });
        const testFilter = { kinds: [1], authors: ['testauthor'] };

        it('should ensure connection before fetching', async () => {
            await ndkServiceInstance.fetchEvents(testFilter);
            expect(mockNdkInstance.connect).toHaveBeenCalledTimes(1);
        });

        it('should call ndk.fetchEvents with the provided filter', async () => {
            await ndkServiceInstance.fetchEvents(testFilter);
            expect(mockNdkInstance.fetchEvents).toHaveBeenCalledTimes(1);
            expect(mockNdkInstance.fetchEvents).toHaveBeenCalledWith(testFilter);
        });

        it('should return the set of events returned by ndk.fetchEvents', async () => {
            const mockEvents = new Set([{ id: 'event1' }, { id: 'event2' }] as any[]); // Mock Set<NDKEvent>
            mockNdkInstance.fetchEvents.mockResolvedValueOnce(mockEvents);
            const result = await ndkServiceInstance.fetchEvents(testFilter);
            expect(result).toBe(mockEvents);
        });

        it('should return an empty set if ndk.fetchEvents throws an error', async () => {
            const fetchError = new Error('Fetch failed');
            mockNdkInstance.fetchEvents.mockRejectedValueOnce(fetchError);
             const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await ndkServiceInstance.fetchEvents(testFilter);

            expect(result).toEqual(new Set());
            expect(errorSpy).toHaveBeenCalledWith(
                'NdkService: Error fetching events:', fetchError
            );
            errorSpy.mockRestore();
        });
    });

    // --- publish() Tests ---
    describe('publish', () => {
        let ndkServiceInstance: NdkService;
        beforeEach(() => {
            mockBrowser.value = true;
            ndkServiceInstance = new NdkService();
            mockNdkInstance.signer = mockNip07SignerInstance;
        });
        const mockEventToPublish = { id: 'publishedevent', kind: 1, sign: vi.fn() } as any;

        it('should ensure connection before publishing', async () => {
            await ndkServiceInstance.publish(mockEventToPublish);
            expect(mockNdkInstance.connect).toHaveBeenCalledTimes(1);
        });

        it('should call ndk.publish with the provided event', async () => {
            await ndkServiceInstance.publish(mockEventToPublish);
            expect(mockNdkInstance.publish).toHaveBeenCalledTimes(1);
            expect(mockNdkInstance.publish).toHaveBeenCalledWith(mockEventToPublish);
        });

        it('should return the set of relays returned by ndk.publish', async () => {
            const mockRelays = new Set(['relay1', 'relay2'] as any);
            mockNdkInstance.publish.mockResolvedValueOnce(mockRelays);
            const result = await ndkServiceInstance.publish(mockEventToPublish);
            expect(result).toBe(mockRelays);
        });

        it('should return an empty set if ndk.publish throws an error', async () => {
            const publishError = new Error('Publish failed');
            mockNdkInstance.publish.mockRejectedValueOnce(publishError);
             const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await ndkServiceInstance.publish(mockEventToPublish);

            expect(result).toEqual(new Set());
            expect(errorSpy).toHaveBeenCalledWith(
                `NdkService: Error publishing event ${mockEventToPublish.id}:`, publishError
            );
            errorSpy.mockRestore();
        });
    });

}); 