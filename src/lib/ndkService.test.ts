import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NDKNip07Signer, type NDKUser } from '@nostr-dev-kit/ndk'; // Import NDKUser type

// Hoist the mock definitions explicitly
const { mockNdkInstance, mockNip07SignerInstance, mockNip46SignerInstance, MockNDK, MockNip07Signer, MockNip46Signer } = vi.hoisted(() => {
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
    const mockNip46SignerInstance = {
        user: vi.fn(),
        blockUntilReady: vi.fn(),
        on: vi.fn(), // Mock the 'on' method for event listeners
    };
    const MockNDK = vi.fn(() => mockNdkInstance);
    const MockNip07Signer = vi.fn(() => mockNip07SignerInstance);
    const MockNip46Signer = vi.fn(() => mockNip46SignerInstance);
    return { mockNdkInstance, mockNip07SignerInstance, mockNip46SignerInstance, MockNDK, MockNip07Signer, MockNip46Signer };
});

// Mock the module using the hoisted mock constructors
vi.mock('@nostr-dev-kit/ndk', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@nostr-dev-kit/ndk')>();
    return {
        ...actual,
        default: MockNDK, // Use hoisted mock constructor
        NDKNip07Signer: MockNip07Signer, // Use hoisted mock constructor
        NDKNip46Signer: MockNip46Signer, // Provide the NIP-46 mock constructor
    };
});

// Mock SvelteKit's browser environment using a getter
const mockBrowser = vi.hoisted(() => ({ value: true }));
vi.mock('$app/environment', () => ({
    get browser() { return mockBrowser.value; }
}));

// Dynamically import the service *after* mocks are set up
import { NdkService } from './ndkService';
// Don't need the original NDK imports here anymore for the test setup

// --- Default Relays for comparison ---
const defaultRelays = [
    'wss://purplepag.es',
    'wss://relay.nostr.band',
    'wss://relay.damus.io',
    'wss://nos.lol'
];

// --- Test Suite ---
describe('NdkService', () => {
    let ndkServiceInstance: NdkService;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset mocks to default behavior
        mockNdkInstance.signer = undefined;
        mockNdkInstance.connect.mockResolvedValue(undefined);
        mockNdkInstance.fetchEvent.mockResolvedValue(null);
        mockNdkInstance.fetchEvents.mockResolvedValue(new Set());
        mockNdkInstance.publish.mockResolvedValue(new Set());
        mockNip07SignerInstance.user.mockResolvedValue({ pubkey: 'testpubkey' } as NDKUser);
        mockNip46SignerInstance.user.mockResolvedValue({ pubkey: 'testpubkey' } as NDKUser);
        mockNip46SignerInstance.blockUntilReady.mockResolvedValue(undefined);
        mockNip46SignerInstance.on.mockReset();
        MockNDK.mockImplementation(() => mockNdkInstance);
        MockNip07Signer.mockImplementation(() => mockNip07SignerInstance);
        MockNip46Signer.mockImplementation(() => mockNip46SignerInstance);
        // Create a new instance for each test after mocks are reset
        ndkServiceInstance = new NdkService();
    });

    // --- Constructor Tests ---
    describe('constructor', () => {
        it('should initialize NDK with default relays', () => {
            // Instance is created in beforeEach
            expect(MockNDK).toHaveBeenCalledTimes(1);
            expect(MockNDK).toHaveBeenCalledWith(expect.objectContaining({ explicitRelayUrls: defaultRelays }));
            // Verify signer is NOT passed during construction regardless of environment
            expect(MockNDK).toHaveBeenCalledWith(expect.not.objectContaining({ signer: expect.anything() }));
        });

        it('should NOT attempt to initialize NIP-07 signer during construction', () => {
            // Instance is created in beforeEach
            expect(MockNip07Signer).not.toHaveBeenCalled();
        });
    });

    // --- activateNip07Signer() Tests ---
    describe('activateNip07Signer', () => {
        beforeEach(() => {
             mockBrowser.value = true; // Ensure browser env for most tests
        });

        it('should return error if not in browser environment', async () => {
            mockBrowser.value = false;
            const result = await ndkServiceInstance.activateNip07Signer();
            expect(result.success).toBe(false);
            expect(result.error).toContain('NIP-07 is only available');
            expect(MockNip07Signer).not.toHaveBeenCalled();
            expect(ndkServiceInstance.getSigner()).toBeUndefined();
            expect(mockNdkInstance.signer).toBeUndefined();
        });

        it('should initialize NIP-07 signer, set activeSigner, set ndk.signer, and return user on success', async () => {
            const mockUser = { pubkey: 'testpubkey' } as NDKUser;
            mockNip07SignerInstance.user.mockResolvedValueOnce(mockUser);

            const result = await ndkServiceInstance.activateNip07Signer();

            expect(MockNip07Signer).toHaveBeenCalledTimes(1);
            expect(mockNip07SignerInstance.user).toHaveBeenCalledTimes(1);
            expect(result.success).toBe(true);
            expect(result.user).toBe(mockUser);
            expect(result.error).toBeUndefined();
            expect(ndkServiceInstance.getSigner()).toBe(mockNip07SignerInstance);
            expect(mockNdkInstance.signer).toBe(mockNip07SignerInstance);
        });

        it('should return error if NIP-07 signer constructor throws', async () => {
            const error = new Error('NIP-07 unavailable');
            MockNip07Signer.mockImplementationOnce(() => { throw error; });
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await ndkServiceInstance.activateNip07Signer();

            expect(MockNip07Signer).toHaveBeenCalledTimes(1);
            expect(mockNip07SignerInstance.user).not.toHaveBeenCalled();
            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to initialize NIP-07 signer');
            expect(result.error).toContain(error.message);
            expect(result.user).toBeUndefined();
            expect(ndkServiceInstance.getSigner()).toBeUndefined();
            expect(mockNdkInstance.signer).toBeUndefined();
            errorSpy.mockRestore();
        });

        it('should return error if signer.user() throws', async () => {
            const error = new Error('User request failed');
            mockNip07SignerInstance.user.mockRejectedValueOnce(error);
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await ndkServiceInstance.activateNip07Signer();

            expect(MockNip07Signer).toHaveBeenCalledTimes(1);
            expect(mockNip07SignerInstance.user).toHaveBeenCalledTimes(1);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to initialize NIP-07 signer or get user');
            expect(result.error).toContain(error.message);
            expect(result.user).toBeUndefined();
            expect(ndkServiceInstance.getSigner()).toBeUndefined();
            expect(mockNdkInstance.signer).toBeUndefined();
            errorSpy.mockRestore();
        });

         it('should return error if signer.user() returns null or no pubkey', async () => {
            mockNip07SignerInstance.user.mockResolvedValueOnce(null as any); // Simulate null user
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            let result = await ndkServiceInstance.activateNip07Signer();

            expect(MockNip07Signer).toHaveBeenCalledTimes(1);
            expect(mockNip07SignerInstance.user).toHaveBeenCalledTimes(1);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to retrieve user information');
            expect(result.user).toBeUndefined();
            expect(ndkServiceInstance.getSigner()).toBeUndefined(); // Should be reset
            expect(mockNdkInstance.signer).toBeUndefined();

            // Reset mock calls for next test case
            MockNip07Signer.mockClear();
            mockNip07SignerInstance.user.mockClear();
            mockNip07SignerInstance.user.mockResolvedValueOnce({} as NDKUser); // Simulate user without pubkey

            result = await ndkServiceInstance.activateNip07Signer();

            expect(MockNip07Signer).toHaveBeenCalledTimes(1);
            expect(mockNip07SignerInstance.user).toHaveBeenCalledTimes(1);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to retrieve user information');
            expect(result.user).toBeUndefined();
             expect(ndkServiceInstance.getSigner()).toBeUndefined(); // Should be reset
            expect(mockNdkInstance.signer).toBeUndefined();
            warnSpy.mockRestore();
        });
    });

    // --- activateNip46Signer() Tests ---
    describe('activateNip46Signer', () => {
        const mockUser = { pubkey: 'testpubkey' } as NDKUser;

        it('should initialize NIP-46 signer, wait for ready, get user, set signers, and return user on success', async () => {
            mockNip46SignerInstance.blockUntilReady.mockResolvedValueOnce(undefined);
            mockNip46SignerInstance.user.mockResolvedValueOnce(mockUser);

            const result = await ndkServiceInstance.activateNip46Signer('nostrconnect://...');

            expect(MockNip46Signer).toHaveBeenCalledTimes(1);
            expect(MockNip46Signer).toHaveBeenCalledWith(ndkServiceInstance.getNdkInstance(), 'nostrconnect://...');
            expect(mockNip46SignerInstance.blockUntilReady).toHaveBeenCalledTimes(1);
            expect(mockNip46SignerInstance.user).toHaveBeenCalledTimes(1);
            expect(result.success).toBe(true);
            expect(result.user).toBe(mockUser);
            expect(result.error).toBeUndefined();
            expect(ndkServiceInstance.getSigner()).toBe(mockNip46SignerInstance);
            expect(mockNdkInstance.signer).toBe(mockNip46SignerInstance);
        });

        it('should call disconnectSigner before attempting connection', async () => {
             // Arrange: Have a NIP-07 signer active first
             mockBrowser.value = true;
             await ndkServiceInstance.activateNip07Signer();
             expect(ndkServiceInstance.getSigner()).toBe(mockNip07SignerInstance);
             const disconnectSpy = vi.spyOn(ndkServiceInstance, 'disconnectSigner');

             // Act
             await ndkServiceInstance.activateNip46Signer('nostrconnect://...');

             // Assert
             expect(disconnectSpy).toHaveBeenCalledOnce();
             // Ensure the final signer is the NIP-46 one (or undefined if failed, tested elsewhere)
             // This implicitly tests that the old one was cleared
             expect(ndkServiceInstance.getSigner()).toBe(mockNip46SignerInstance);
         });

        it('should return error if NDKNip46Signer constructor throws', async () => {
            const error = new Error('Invalid connection string');
            MockNip46Signer.mockImplementationOnce(() => { throw error; });
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await ndkServiceInstance.activateNip46Signer('nostrconnect://...');

            expect(MockNip46Signer).toHaveBeenCalledTimes(1);
            expect(mockNip46SignerInstance.blockUntilReady).not.toHaveBeenCalled();
            expect(mockNip46SignerInstance.user).not.toHaveBeenCalled();
            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to connect/authenticate NIP-46 signer');
            expect(result.error).toContain(error.message);
            expect(result.user).toBeUndefined();
            expect(ndkServiceInstance.getSigner()).toBeUndefined();
            expect(mockNdkInstance.signer).toBeUndefined();
            errorSpy.mockRestore();
        });

        it('should return error if blockUntilReady throws (timeout/connection failure)', async () => {
            const error = new Error('Connection timed out');
            mockNip46SignerInstance.blockUntilReady.mockRejectedValueOnce(error);
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await ndkServiceInstance.activateNip46Signer('nostrconnect://...');

            expect(MockNip46Signer).toHaveBeenCalledTimes(1);
            expect(mockNip46SignerInstance.blockUntilReady).toHaveBeenCalledTimes(1);
            expect(mockNip46SignerInstance.user).not.toHaveBeenCalled();
            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to connect/authenticate NIP-46 signer');
            expect(result.error).toContain(error.message);
            expect(result.user).toBeUndefined();
            expect(ndkServiceInstance.getSigner()).toBeUndefined();
            expect(mockNdkInstance.signer).toBeUndefined();
            errorSpy.mockRestore();
        });

        it('should return error if user() throws', async () => {
            const error = new Error('Failed to get user permissions');
            mockNip46SignerInstance.blockUntilReady.mockResolvedValueOnce(undefined);
            mockNip46SignerInstance.user.mockRejectedValueOnce(error);
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await ndkServiceInstance.activateNip46Signer('nostrconnect://...');

            expect(MockNip46Signer).toHaveBeenCalledTimes(1);
            expect(mockNip46SignerInstance.blockUntilReady).toHaveBeenCalledTimes(1);
            expect(mockNip46SignerInstance.user).toHaveBeenCalledTimes(1);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to connect/authenticate NIP-46 signer');
            expect(result.error).toContain(error.message);
            expect(result.user).toBeUndefined();
            expect(ndkServiceInstance.getSigner()).toBeUndefined();
            expect(mockNdkInstance.signer).toBeUndefined();
            errorSpy.mockRestore();
        });

        it('should return error if user() returns null or no pubkey', async () => {
            mockNip46SignerInstance.blockUntilReady.mockResolvedValueOnce(undefined);
            mockNip46SignerInstance.user.mockResolvedValueOnce(null as any); // Test null user
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            let result = await ndkServiceInstance.activateNip46Signer('nostrconnect://...');

            expect(MockNip46Signer).toHaveBeenCalledTimes(1);
            expect(mockNip46SignerInstance.blockUntilReady).toHaveBeenCalledTimes(1);
            expect(mockNip46SignerInstance.user).toHaveBeenCalledTimes(1);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Remote signer connected but did not provide a valid public key');
            expect(result.user).toBeUndefined();
            expect(ndkServiceInstance.getSigner()).toBeUndefined();
            expect(mockNdkInstance.signer).toBeUndefined();

            // Reset mocks for next case
             mockNip46SignerInstance.blockUntilReady.mockReset().mockResolvedValue(undefined);
             mockNip46SignerInstance.user.mockReset().mockResolvedValue({} as NDKUser); // Test user without pubkey
             MockNip46Signer.mockClear();

            result = await ndkServiceInstance.activateNip46Signer('nostrconnect://...');

             expect(MockNip46Signer).toHaveBeenCalledTimes(1);
             expect(mockNip46SignerInstance.blockUntilReady).toHaveBeenCalledTimes(1);
             expect(mockNip46SignerInstance.user).toHaveBeenCalledTimes(1);
             expect(result.success).toBe(false);
             expect(result.error).toContain('Remote signer connected but did not provide a valid public key');
             expect(result.user).toBeUndefined();
             expect(ndkServiceInstance.getSigner()).toBeUndefined();
             expect(mockNdkInstance.signer).toBeUndefined();

            errorSpy.mockRestore();
        });
    });

    // --- disconnectSigner() Tests ---
    describe('disconnectSigner', () => {
        beforeEach(async () => {
            // Activate NIP-07 signer first for these tests
            mockBrowser.value = true;
            mockNip07SignerInstance.user.mockResolvedValue({ pubkey: 'testpubkey' } as NDKUser);
            await ndkServiceInstance.activateNip07Signer();
            // Verify it was set correctly before disconnecting
            expect(ndkServiceInstance.getSigner()).toBe(mockNip07SignerInstance);
            expect(mockNdkInstance.signer).toBe(mockNip07SignerInstance);
        });

        it('should set activeSigner and ndk.signer to undefined', () => {
            ndkServiceInstance.disconnectSigner();
            expect(ndkServiceInstance.getSigner()).toBeUndefined();
            expect(mockNdkInstance.signer).toBeUndefined();
        });

        it('should be safe to call multiple times', () => {
            ndkServiceInstance.disconnectSigner();
            expect(ndkServiceInstance.getSigner()).toBeUndefined();
            expect(mockNdkInstance.signer).toBeUndefined();

            // Call again
            ndkServiceInstance.disconnectSigner();
            expect(ndkServiceInstance.getSigner()).toBeUndefined();
            expect(mockNdkInstance.signer).toBeUndefined();
        });

        it('should log disconnection message', () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            ndkServiceInstance.disconnectSigner();
            expect(logSpy).toHaveBeenCalledWith('Disconnecting active signer...');
            logSpy.mockRestore();
        });

        it('should unset NIP-46 signer if active', async () => {
            // Arrange: Activate NIP-46
            mockNip46SignerInstance.blockUntilReady.mockResolvedValueOnce(undefined);
            mockNip46SignerInstance.user.mockResolvedValueOnce({ pubkey: 'testpubkey' } as NDKUser);
            await ndkServiceInstance.activateNip46Signer('nostrconnect://...');
            expect(ndkServiceInstance.getSigner()).toBe(mockNip46SignerInstance);
            expect(mockNdkInstance.signer).toBe(mockNip46SignerInstance);

            // Act
            ndkServiceInstance.disconnectSigner();

            // Assert
            expect(ndkServiceInstance.getSigner()).toBeUndefined();
            expect(mockNdkInstance.signer).toBeUndefined();
        });
    });

    // --- getSigner() Tests ---
    describe('getSigner', () => {
        it('should return undefined initially', () => {
            // Instance created in beforeEach, no signer activated yet
            expect(ndkServiceInstance.getSigner()).toBeUndefined();
        });

        it('should return the active signer after successful activation', async () => {
            mockBrowser.value = true;
            mockNip07SignerInstance.user.mockResolvedValue({ pubkey: 'testpubkey' } as NDKUser);
            await ndkServiceInstance.activateNip07Signer();
            expect(ndkServiceInstance.getSigner()).toBe(mockNip07SignerInstance);
        });

        it('should return undefined after activation failure', async () => {
            mockBrowser.value = true;
            MockNip07Signer.mockImplementationOnce(() => { throw new Error('Test Error'); });
            await ndkServiceInstance.activateNip07Signer();
            expect(ndkServiceInstance.getSigner()).toBeUndefined();
        });

        it('should return undefined after disconnection', async () => {
            mockBrowser.value = true;
            mockNip07SignerInstance.user.mockResolvedValue({ pubkey: 'testpubkey' } as NDKUser);
            await ndkServiceInstance.activateNip07Signer(); // Activate
            ndkServiceInstance.disconnectSigner(); // Disconnect
            expect(ndkServiceInstance.getSigner()).toBeUndefined();
        });

        it('should return NIP-46 signer after successful NIP-46 activation', async () => {
            mockNip46SignerInstance.blockUntilReady.mockResolvedValueOnce(undefined);
            mockNip46SignerInstance.user.mockResolvedValueOnce({ pubkey: 'testpubkey' } as NDKUser);
            await ndkServiceInstance.activateNip46Signer('nostrconnect://...');
            expect(ndkServiceInstance.getSigner()).toBe(mockNip46SignerInstance);
        });
    });

    // --- connect() Tests ---
    describe('connect', () => {
        // No changes needed here as connection logic is independent of signer activation
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

    // --- getNdkInstance() Tests ---
     describe('getNdkInstance', () => {
        it('should return the underlying mock NDK instance', () => {
            expect(ndkServiceInstance.getNdkInstance()).toBe(mockNdkInstance);
        });
    });

    // --- fetchEvent() Tests ---
    describe('fetchEvent', () => {
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

        it('should return the events set returned by ndk.fetchEvents', async () => {
            const mockEvents = new Set([{ id: 'event1' }, { id: 'event2' }]) as any;
            mockNdkInstance.fetchEvents.mockResolvedValueOnce(mockEvents);

            const result = await ndkServiceInstance.fetchEvents(testFilter);

            expect(result).toBe(mockEvents);
            expect(result.size).toBe(2);
        });

        it('should return an empty set if ndk.fetchEvents throws an error', async () => {
            const fetchError = new Error('Fetch multiple failed');
            mockNdkInstance.fetchEvents.mockRejectedValueOnce(fetchError);
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await ndkServiceInstance.fetchEvents(testFilter);

            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
            expect(errorSpy).toHaveBeenCalledWith(
                'NdkService: Error fetching events:', fetchError
            );
            errorSpy.mockRestore();
        });
    });

    // --- publish() Tests ---
    describe('publish', () => {
        const mockEvent = { id: 'event1', kind: 1, sign: vi.fn() } as any; // Mock NDKEvent

        beforeEach(async () => {
            // Ensure a signer is active for publish tests
            mockBrowser.value = true;
            mockNip07SignerInstance.user.mockResolvedValue({ pubkey: 'testpubkey' } as NDKUser);
            await ndkServiceInstance.activateNip07Signer();
        });

        it('should ensure connection before publishing', async () => {
            await ndkServiceInstance.publish(mockEvent);
            expect(mockNdkInstance.connect).toHaveBeenCalledTimes(1);
        });

        it('should call ndk.publish with the provided event', async () => {
            await ndkServiceInstance.publish(mockEvent);
            expect(mockNdkInstance.publish).toHaveBeenCalledTimes(1);
            expect(mockNdkInstance.publish).toHaveBeenCalledWith(mockEvent);
        });

        it('should return the set of relays the event was published to', async () => {
            const mockRelays = new Set(['relay1', 'relay2']) as any;
            mockNdkInstance.publish.mockResolvedValueOnce(mockRelays);

            const result = await ndkServiceInstance.publish(mockEvent);

            expect(result).toBe(mockRelays);
            expect(result.size).toBe(2);
        });

        it('should return an empty set if ndk.publish throws an error', async () => {
            const publishError = new Error('Publish failed');
            mockNdkInstance.publish.mockRejectedValueOnce(publishError);
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await ndkServiceInstance.publish(mockEvent);

            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
            expect(errorSpy).toHaveBeenCalledWith(
                `NdkService: Error publishing event ${mockEvent.id}:`, publishError
            );
            errorSpy.mockRestore();
        });
    });

    // --- getConnectionStatus() Tests ---
    describe('getConnectionStatus', () => {
         it('should return initial state', () => {
            expect(ndkServiceInstance.getConnectionStatus()).toEqual({ isConnected: false, isConnecting: false });
        });

        it('should reflect connecting state', () => {
            // Don't wait for connect to finish
            ndkServiceInstance.connect();
            expect(ndkServiceInstance.getConnectionStatus()).toEqual({ isConnected: false, isConnecting: true });
        });

        it('should reflect connected state', async () => {
            await ndkServiceInstance.connect();
            expect(ndkServiceInstance.getConnectionStatus()).toEqual({ isConnected: true, isConnecting: false });
        });

         it('should reflect disconnected state after failed connection', async () => {
            mockNdkInstance.connect.mockRejectedValueOnce(new Error('Fail'));
            try {
                await ndkServiceInstance.connect();
            } catch (e) { /* Ignore */ }
            expect(ndkServiceInstance.getConnectionStatus()).toEqual({ isConnected: false, isConnecting: false });
        });
    });
}); 