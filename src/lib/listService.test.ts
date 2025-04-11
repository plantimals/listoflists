import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import NDK, { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk';
import type { NDKSigner, NostrEvent } from '@nostr-dev-kit/ndk';
import type { NDKUser } from '@nostr-dev-kit/ndk';
import { localDb, type StoredEvent } from '$lib/localDb';
import { addItemToList, removeItemFromList, renameList, deleteList, type Item } from '$lib/listService';
import { nip19, nip05 } from 'nostr-tools';

// Mock nostr-tools
vi.mock('nostr-tools', async (importOriginal) => {
	const actual = await importOriginal<typeof import('nostr-tools')>();
	return {
		...actual,
		nip19: actual.nip19, // Keep actual nip19
		nip05: {
			queryProfile: vi.fn(), // Mock queryProfile
		},
	};
});

// Mock NDK
vi.mock('@nostr-dev-kit/ndk', async (importOriginal) => {
	const actualNdk = await importOriginal<typeof import('@nostr-dev-kit/ndk')>();
	class MockNDKUser {
		public pubkey! : string;
		public ndk?: NDK;
		constructor(opts?: { pubkey: string; ndk?: NDK }) {
			if (opts?.pubkey) {
				this.pubkey = opts.pubkey;
			}
			this.ndk = opts?.ndk;
		}
	}
	return {
		...actualNdk,
		NDKEvent: actualNdk.NDKEvent,
		NDKUser: MockNDKUser,
	};
});

// --- Add mocks for service/store --- 
vi.mock('$lib/ndkService', () => ({
    ndkService: {
        getNdkInstance: vi.fn(),
        getSigner: vi.fn(),
        publish: vi.fn(),
    },
}));

vi.mock('$lib/userStore', async (importOriginal) => {
    const actualUserStore = await importOriginal<typeof import('$lib/userStore')>();
    return {
        ...actualUserStore,
        user: { // Mock the store itself
            subscribe: vi.fn(),
            set: vi.fn(),
            update: vi.fn(),
        }
    };
});

// --- Update mock for svelte/store --- 
vi.mock('svelte/store', async (importOriginal) => {
	const actual = await importOriginal<typeof import('svelte/store')>();
	return {
		...actual, // Keep other exports like readable, derived, etc.
		get: vi.fn(), // Mock 'get' as before
		writable: vi.fn().mockReturnValue({ // Mock 'writable'
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn(),
		}),
	};
});

// Mock refreshTrigger
vi.mock('$lib/refreshStore', async () => {
    const actual = await vi.importActual('$lib/refreshStore');
    return {
        ...actual,
        refreshTrigger: {
            subscribe: vi.fn(),
            set: vi.fn(),
            update: vi.fn(), // Mock the update method
        },
    };
});

// Access the mocked NDKUser
const { NDKUser: MockNDKUser } = await import('@nostr-dev-kit/ndk');
// --- Access mocked service/store/get --- 
const { ndkService } = await import('$lib/ndkService');
const { user } = await import('$lib/userStore');
const { get } = await import('svelte/store');
const { refreshTrigger } = await import('$lib/refreshStore'); // Import mocked trigger
const { nip05: mockNip05 } = await import('nostr-tools'); // <-- Added import for mocked nip05
// --- End access ---

// Spy variables for localDb methods and NDKEvent.sign
let getLatestEventByCoordSpy: MockInstance<typeof localDb.getLatestEventByCoord>;
let addOrUpdateEventSpy: MockInstance<typeof localDb.addOrUpdateEvent>;
let deleteEventByIdSpy: MockInstance<typeof localDb.deleteEventById>;
let signSpy: MockInstance<(signer?: NDKSigner | undefined) => Promise<string>>;

// ---> NEW: Spies for kind fetching logic
let getEventByIdSpy: MockInstance<typeof localDb.getEventById>;
let fetchEventSpy: MockInstance<any>; // Mock ndkService.fetchEvent
// --- END NEW ---

// Mock the NDK instance and its methods if necessary
const mockNdkInstance: Partial<NDK> = {
	signer: undefined, // Will be set in beforeEach
    // ---> NEW: Mock fetchEvent method
    fetchEvent: vi.fn(),
    // --- END NEW ---
};

// Mock NIP-07 signer
const mockSigner: NDKSigner = {
	user: async () => ({ pubkey: 'test_pubkey' } as unknown as NDKUser),
	sign: vi.fn().mockImplementation(async (event: NostrEvent) => {
		return `signed-sig-nip07-${event.id}`;
	}),
	encrypt: vi.fn(),
	decrypt: vi.fn(),
	pubkey: 'test_pubkey',
	blockUntilReady: async (): Promise<NDKUser> => {
		return { pubkey: 'test_pubkey' } as unknown as NDKUser;
	},
	userSync: { pubkey: 'test_pubkey' } as unknown as NDKUser,
};

// --- Test Data ---
const testPubkey = 'a0d4643a33944596e239961a4a65303d8689a4a60319936561d941616e0f0bd9';
const currentUser = new MockNDKUser({ pubkey: testPubkey });
// Use a valid, different 64-char hex pubkey
const otherUserPubkey = 'b1e1b1e1b1e1b1e1b1e1b1e1b1e1b1e1b1e1b1e1b1e1b1e1b1e1b1e1b1e1b1e2'; 
const testEventId = 'e4ac8cca7bf794e426fa21f065f55b150d1cf49839d01f7547a990a25268a603';
const testReplaceableEventId = 'f5bda1f4a8f4ca6d3c8f8f8b2e1e1f1c1d1a1b1c1d1e1f1a1b1c1d1e1f2a3b4c';
const testNonReplaceableEventId = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const testRelayHint = 'wss://relay.example.com';
const testDTag = 'my-bookmarks';
const testKind = 30003;
const listCoordinateId = `${testKind}:${testPubkey}:${testDTag}`;

const baseList: StoredEvent = {
	id: 'base_event_id_123',
	kind: testKind,
	pubkey: testPubkey,
	created_at: Math.floor(Date.now() / 1000) - 1000,
	tags: [
		['d', testDTag],
		['p', 'existing_pubkey1'],
		['e', 'existing_eventid1'],
	],
	content: 'Base bookmark list',
	sig: 'sig1',
	dTag: testDTag,
	published: true,
};
const otherUsersList: StoredEvent = {
	...baseList,
	pubkey: otherUserPubkey, // Now uses the valid otherUserPubkey hex
	id: 'other_event_id_456',
};

// --- NEW: Mock event data for kind fetching/validation --- 
const mockCachedReplaceableEvent: StoredEvent = {
    id: testReplaceableEventId,
    kind: 0, // Kind 0 (metadata/profile - replaceable)
    pubkey: 'some_pubkey',
    created_at: 1678886400,
    tags: [],
    content: '',
    sig: 'sig_rep',
    published: true,
};
const mockNetworkNonReplaceableEvent = new NDKEvent(mockNdkInstance as NDK, {
    id: testNonReplaceableEventId,
    kind: 1, // Kind 1 (text note - non-replaceable)
    pubkey: 'another_pubkey',
    created_at: 1678886500,
    tags: [],
    content: '',
    sig: 'sig_non_rep',
} as NostrEvent);

// --- NEW: Mock event data for kind fetching/validation --- 
const mockIdKind0 = '0000000000000000000000000000000000000000000000000000000000000000';
const mockIdKind3 = '3333333333333333333333333333333333333333333333333333333333333333';
const mockIdKind10k = '1010101010101010101010101010101010101010101010101010101010101010';
const mockIdKind30k = '3030303030303030303030303030303030303030303030303030303030303030';
const mockIdKind1 = '1111111111111111111111111111111111111111111111111111111111111111';
const mockIdKind4 = '4444444444444444444444444444444444444444444444444444444444444444';
const mockIdUnknown = '9999999999999999999999999999999999999999999999999999999999999999';

const mockCachedReplaceableKind0: StoredEvent = {
    id: mockIdKind0, kind: 0, pubkey: 'pubkey0', created_at: 1700000000, tags: [], content: '', sig: 'sig0', published: true };
const mockNetworkReplaceableKind3: NDKEvent = new NDKEvent(mockNdkInstance as NDK, {
    id: mockIdKind3, kind: 3, pubkey: 'pubkey3', created_at: 1700000003, tags: [], content: '', sig: 'sig3' } as NostrEvent);
const mockCachedReplaceableKind10k: StoredEvent = {
    id: mockIdKind10k, kind: 10002, pubkey: 'pubkey10k', created_at: 1700000010, tags: [], content: '', sig: 'sig10k', published: true };
const mockNetworkReplaceableKind30k: NDKEvent = new NDKEvent(mockNdkInstance as NDK, {
    id: mockIdKind30k, kind: 30001, pubkey: 'pubkey30k', created_at: 1700000030, tags: [], content: '', sig: 'sig30k' } as NostrEvent);

const mockCachedNonReplaceableKind1: StoredEvent = {
    id: mockIdKind1, kind: 1, pubkey: 'pubkey1', created_at: 1700000001, tags: [], content: '', sig: 'sig1', published: true };
const mockNetworkNonReplaceableKind4: NDKEvent = new NDKEvent(mockNdkInstance as NDK, {
    id: mockIdKind4, kind: 4, pubkey: 'pubkey4', created_at: 1700000004, tags: [], content: '', sig: 'sig4' } as NostrEvent);
const mockUnknownEventId = mockIdUnknown; // Use the valid hex ID here too
// --- END NEW MOCK DATA ---

// Test Input Data and Expected Tags
const inputs = {
	npub: nip19.npubEncode(testPubkey),
	nprofile: nip19.nprofileEncode({ pubkey: testPubkey, relays: [testRelayHint] }),
	note: nip19.noteEncode(testEventId),
	nevent: nip19.neventEncode({ id: testEventId, relays: [testRelayHint], author: testPubkey }),
    // ---> NEW: Inputs for kind testing
    noteReplaceable: nip19.noteEncode(testReplaceableEventId),
    neventNonReplaceable: nip19.neventEncode({ id: testNonReplaceableEventId, relays: [testRelayHint] }),
    hexEventNonReplaceable: testNonReplaceableEventId,
    // ---> NEW: Inputs for kind validation testing
    noteKind0: nip19.noteEncode(mockIdKind0),
    neventKind3: nip19.neventEncode({ id: mockIdKind3, relays: [testRelayHint] }),
    hexKind10k: mockIdKind10k,
    noteKind30k: nip19.noteEncode(mockIdKind30k),
    neventKind1: nip19.neventEncode({ id: mockIdKind1, relays: [testRelayHint] }),
    hexKind4: mockIdKind4,
    noteUnknown: nip19.noteEncode(mockIdUnknown),
    // --- END NEW INPUTS ---
	naddrList: nip19.naddrEncode({ kind: 30001, pubkey: testPubkey, identifier: 'another-list', relays: [testRelayHint] }),
	hexPubkey: testPubkey,
	hexEventId: testEventId,
	coordinateList: `30001:${testPubkey}:list-coord`,
	invalid: 'this is not valid',
	empty: '',
};

const expectedTags = {
	npub: ['p', testPubkey],
	nprofile: ['p', testPubkey],
	note: ['e', testEventId],
	nevent: ['e', testEventId, testRelayHint],
    // ---> NEW: Expected for kind testing (tag added regardless for now)
    noteReplaceable: ['e', testReplaceableEventId],
    neventNonReplaceable: ['e', testNonReplaceableEventId, testRelayHint],
    hexEventNonReplaceable: ['e', testNonReplaceableEventId],
    // ---> NEW: Expected for kind validation testing
    noteKind0: ['e', mockIdKind0],
    neventKind3: ['e', mockIdKind3, testRelayHint],
    hexKind10k: mockIdKind10k,
    noteKind30k: nip19.noteEncode(mockIdKind30k),
    neventKind1: ['e', mockIdKind1, testRelayHint],
    hexKind4: ['e', mockIdKind4],
    noteUnknown: ['e', mockIdUnknown],
    // --- END NEW ---
	naddrList: ['a', `30001:${testPubkey}:another-list`, testRelayHint],
	// Assuming hex defaults to 'e'
	hexPubkey: ['e', testPubkey],
	hexEventId: ['e', testEventId],
	coordinateList: ['a', `30001:${testPubkey}:list-coord`],
};

// --- Test Suites ---
describe('listService', () => {
	beforeEach(() => {
		// Reset spies and mocks
		vi.resetAllMocks();

		// --- Setup mocks for service/store/get --- 
        vi.mocked(ndkService.getNdkInstance).mockReturnValue(mockNdkInstance as NDK);
        vi.mocked(ndkService.getSigner).mockReturnValue(mockSigner);
        vi.mocked(get).mockImplementation((store) => {
            if (store === user) {
                return currentUser;
            }
            return undefined; // Or throw error for unexpected stores
        });
        // --- End setup mocks ---

		// Set up spies on the ACTUAL localDb methods
		getLatestEventByCoordSpy = vi.spyOn(localDb, 'getLatestEventByCoord').mockResolvedValue(baseList);
		addOrUpdateEventSpy = vi.spyOn(localDb, 'addOrUpdateEvent').mockResolvedValue(undefined);
		deleteEventByIdSpy = vi.spyOn(localDb, 'deleteEventById');

        // ---> NEW: Initialize spies for kind fetching
        getEventByIdSpy = vi.spyOn(localDb, 'getEventById'); // Don't mock resolved value here, do it per test
        fetchEventSpy = vi.spyOn(mockNdkInstance, 'fetchEvent'); // Spy on the mocked NDK instance's method
        // --- END NEW ---

		// Set up NDK Signer and spy on NDKEvent.sign
		mockNdkInstance.signer = mockSigner;
		signSpy = vi.spyOn(NDKEvent.prototype, 'sign').mockImplementation(async function(this: NDKEvent) {
			this.id = `mock_id_${Date.now()}`;
			this.sig = `mock_sig_${Date.now()}`;
			return this.sig;
		});

		// Ensure NDK publish is mocked via ndkService
		vi.mocked(ndkService.publish).mockClear(); 
		vi.mocked(refreshTrigger.update).mockClear(); // Clear trigger mock too
	});

	afterEach(() => {
		// Restore all spies
        vi.restoreAllMocks(); // This should restore spies created with vi.spyOn
	});

	// Tests now rely on spies intercepting calls to the actual localDb
	describe('addItemToList', () => {
		// Test each valid input type
		it.each([
			['npub', inputs.npub, expectedTags.npub],
			['nprofile', inputs.nprofile, expectedTags.nprofile],
			['note', inputs.note, expectedTags.note],
			['nevent', inputs.nevent, expectedTags.nevent],
			['naddrList', inputs.naddrList, expectedTags.naddrList],
			['hexEventId', inputs.hexEventId, expectedTags.hexEventId],
			['coordinateList', inputs.coordinateList, expectedTags.coordinateList],
            // Kind fetch tests are separate
		])('should correctly add item for %s input (non-kind-fetch cases)', async (inputType, inputString, expectedTag) => {
			const result = await addItemToList(listCoordinateId, inputString);
			
			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
			expect(result.newEventId).toBeDefined();
			// Check coordinate lookup
			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(testKind, testPubkey, testDTag);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
			
			const savedEvent = addOrUpdateEventSpy.mock.calls[0][0] as StoredEvent;
			expect(savedEvent.tags).toContainEqual(expectedTag);
			expect(savedEvent.tags.length).toBe(baseList.tags.length + 1);
			expect(savedEvent.pubkey).toBe(currentUser.pubkey);
			expect(savedEvent.created_at).toBeGreaterThan(baseList.created_at);
			expect(savedEvent.published).toBe(false);
		});

		 it('should return success without adding if item already exists', async () => {
			// Mock DB to return a list that already contains the item we try to add
			const tagToAdd = expectedTags.note;
			const listWithItem = { 
				...baseList, 
				tags: [...baseList.tags, tagToAdd]
			};
			getLatestEventByCoordSpy.mockResolvedValue(listWithItem);

			const result = await addItemToList(listCoordinateId, inputs.note);

			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
			// IMPORTANT: Should not create a *new* event ID if item exists
			expect(result.newEventId).toBe(baseList.id);
			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(testKind, testPubkey, testDTag);
			// Should not sign or save if duplicate
			expect(signSpy).not.toHaveBeenCalled();
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error for invalid input format', async () => {
			const result = await addItemToList(listCoordinateId, inputs.invalid);
			expect(result.success).toBe(false);
			expect(result.error).toContain('Invalid or unsupported input format');
			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(testKind, testPubkey, testDTag);
			expect(signSpy).not.toHaveBeenCalled();
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error for empty input', async () => {
			 const result = await addItemToList(listCoordinateId, inputs.empty);
			 expect(result.success).toBe(false);
			 expect(result.error).toBe('Input cannot be empty');
			 expect(getLatestEventByCoordSpy).not.toHaveBeenCalled();
			 expect(signSpy).not.toHaveBeenCalled();
			 expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		 });

		// --- Keep existing error condition tests, adapt signature --- 
		it('should return error if list event not found locally by coordinate', async () => {
			getLatestEventByCoordSpy.mockResolvedValueOnce(undefined);
			// Pass string input instead of object
			const result = await addItemToList(listCoordinateId, inputs.note);
			expect(result.success).toBe(false);
			expect(result.error).toContain(`List event with coordinate ${listCoordinateId} not found locally`);
			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(testKind, testPubkey, testDTag);
			expect(signSpy).not.toHaveBeenCalled();
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error if currentUser is not available', async () => {
			// Mock get(user) to return null
			vi.mocked(get).mockImplementation((store) => {
				if (store === user) {
					return null;
				}
				return undefined;
			});
			// Pass string input
			const result = await addItemToList(listCoordinateId, inputs.note);
			expect(result.success).toBe(false);
			expect(result.error).toBe('User not logged in');
			// User check happens before DB query
		});

		 it('should return error if NDK instance is not available', async () => {
			 // Mock ndkService.getNdkInstance to return null
			 vi.mocked(ndkService.getNdkInstance).mockReturnValue(null as unknown as NDK);
			 const result = await addItemToList(listCoordinateId, inputs.note);
			 expect(result.success).toBe(false);
			 expect(result.error).toBe('NDK not initialized');
			 // NDK check happens before DB query
		 });

		it('should return error if signer is not available', async () => {
			// Mock ndkService.getSigner to return undefined
			vi.mocked(ndkService.getSigner).mockReturnValue(undefined);
			const result = await addItemToList(listCoordinateId, inputs.note);
			expect(result.success).toBe(false);
			expect(result.error).toBe('Nostr signer not available (NIP-07?)');
			// Signer check happens before DB query
		});

		it('should return error if event pubkey does not match currentUser.pubkey', async () => {
			// This test name is slightly misleading now. It actually tests the case where the
			// coordinate ID is correct, but the DB *returns* an event with the wrong pubkey.
			// This tests the second safety check inside the function.
			getLatestEventByCoordSpy.mockResolvedValueOnce(otherUsersList);
			 // Pass string input
			const result = await addItemToList(listCoordinateId, inputs.note);
			expect(result.success).toBe(false);
			// Correct the expected error message based on the actual code path tested
			expect(result.error).toBe('List ownership mismatch. Cannot modify.'); 
			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(testKind, testPubkey, testDTag);
			expect(signSpy).not.toHaveBeenCalled();
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error if signing fails', async () => {
			getLatestEventByCoordSpy.mockResolvedValueOnce({ ...baseList }); // Use copy
			const signError = new Error('Signature failed');
			signSpy.mockRejectedValueOnce(signError);
			 // Pass string input
			const result = await addItemToList(listCoordinateId, inputs.note);
			expect(result.success).toBe(false);
			expect(result.error).toContain(signError.message);
			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(testKind, testPubkey, testDTag);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error if addOrUpdateEvent fails', async () => {
			const dbError = new Error('Database write failed');
			getLatestEventByCoordSpy.mockResolvedValueOnce({ ...baseList }); // Use copy
			addOrUpdateEventSpy.mockRejectedValueOnce(dbError);
			 // Pass string input
			const result = await addItemToList(listCoordinateId, inputs.note);
			expect(result.success).toBe(false);
			expect(result.error).toContain(dbError.message);
			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(testKind, testPubkey, testDTag);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
		});

		it('should return error if DB lookup finds event for different user (safety check)', async () => {
			getLatestEventByCoordSpy.mockResolvedValueOnce(otherUsersList); // Mock DB returns event with otherUserPubkey
			const result = await addItemToList(listCoordinateId, inputs.note);
			expect(result.success).toBe(false);
			expect(result.error).toBe('List ownership mismatch. Cannot modify.'); // Fix: Expect this specific error
			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(testKind, testPubkey, testDTag);
		});

        // ---> NEW: Test suite for event kind fetching and validation <---
        describe('event kind fetching and validation', () => {
            it('should REJECT adding replaceable event found in local DB cache', async () => {
                getEventByIdSpy.mockResolvedValue(mockCachedReplaceableEvent);
                const input = inputs.noteReplaceable; // Input corresponds to mockCachedReplaceableEvent ID

                // Clear fetch spy to ensure it's not called
                fetchEventSpy.mockClear();

                const result = await addItemToList(listCoordinateId, input);

                // Assert failure and correct error
                expect(result.success).toBe(false);
                expect(result.error).toMatch(/Cannot add replaceable event kind 0 as a static event reference/);

                // Verify lookup calls
                expect(getEventByIdSpy).toHaveBeenCalledWith(testReplaceableEventId);
                expect(fetchEventSpy).not.toHaveBeenCalled(); // Should not fetch from network
                expect(addOrUpdateEventSpy).not.toHaveBeenCalled(); // Should not save
            });

            it('should fetch from network if event is not in local DB (and add if non-replaceable)', async () => {
                getEventByIdSpy.mockResolvedValue(undefined);
                fetchEventSpy.mockResolvedValue(mockNetworkNonReplaceableEvent);
                const input = inputs.neventNonReplaceable;
                const expectedTag = expectedTags.neventNonReplaceable;

                const result = await addItemToList(listCoordinateId, input);

                expect(result.success).toBe(true); // Should succeed as it's non-replaceable
                expect(result.error).toBeUndefined();
                expect(getEventByIdSpy).toHaveBeenCalledWith(testNonReplaceableEventId);
                expect(fetchEventSpy).toHaveBeenCalledWith({ ids: [testNonReplaceableEventId] });
                expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
                const savedEvent = addOrUpdateEventSpy.mock.calls[0][0] as StoredEvent;
                expect(savedEvent.tags).toContainEqual(expectedTag); 
            });

             it('should add tag even if event kind cannot be found (cache miss, network miss)', async () => {
                getEventByIdSpy.mockResolvedValue(undefined);
                // Use the correct ID for this test case
                const eventIdForUnknown = testNonReplaceableEventId; 
                fetchEventSpy.mockResolvedValue(null); // Simulate event not found on network
                // Use input corresponding to the ID
                const input = inputs.hexEventNonReplaceable; 
                const expectedTag = expectedTags.hexEventNonReplaceable;

                const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

                const result = await addItemToList(listCoordinateId, input);

                expect(result.success).toBe(true); // Should still succeed
                expect(getEventByIdSpy).toHaveBeenCalledWith(eventIdForUnknown);
                expect(fetchEventSpy).toHaveBeenCalledWith({ ids: [eventIdForUnknown] });
                // Check only the warning that IS logged
                expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Could not find event'));
                expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
                const savedEvent = addOrUpdateEventSpy.mock.calls[0][0] as StoredEvent;
                expect(savedEvent.tags).toContainEqual(expectedTag); 

                consoleWarnSpy.mockRestore();
            });

            it('should add tag even if network fetch fails with an error', async () => {
                getEventByIdSpy.mockResolvedValue(undefined);
                const fetchError = new Error('Network timeout');
                fetchEventSpy.mockRejectedValue(fetchError); // Simulate network error
                const input = inputs.note; // Use a generic note input
                const expectedTag = expectedTags.note;

                // Spy on console.error
                const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

                const result = await addItemToList(listCoordinateId, input);

                expect(result.success).toBe(true);
                expect(getEventByIdSpy).toHaveBeenCalledWith(testEventId);
                expect(fetchEventSpy).toHaveBeenCalledWith({ ids: [testEventId] });
                expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error fetching event kind'), fetchError);
                 expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
                const savedEvent = addOrUpdateEventSpy.mock.calls[0][0] as StoredEvent;
                expect(savedEvent.tags).toContainEqual(expectedTag); // Still adds tag for now

                consoleErrorSpy.mockRestore();
            });

            it('should not attempt to fetch kind for non-event inputs (npub)', async () => {
                const input = inputs.npub;
                const expectedTag = expectedTags.npub;

                const result = await addItemToList(listCoordinateId, input);

                expect(result.success).toBe(true);
                expect(getEventByIdSpy).not.toHaveBeenCalled();
                expect(fetchEventSpy).not.toHaveBeenCalled();
                expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
                const savedEvent = addOrUpdateEventSpy.mock.calls[0][0] as StoredEvent;
                expect(savedEvent.tags).toContainEqual(expectedTag);
            });

             it('should not attempt to fetch kind for non-event inputs (naddr)', async () => {
                const input = inputs.naddrList;
                const expectedTag = expectedTags.naddrList;

                const result = await addItemToList(listCoordinateId, input);

                expect(result.success).toBe(true);
                expect(getEventByIdSpy).not.toHaveBeenCalled();
                expect(fetchEventSpy).not.toHaveBeenCalled();
                expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
                const savedEvent = addOrUpdateEventSpy.mock.calls[0][0] as StoredEvent;
                expect(savedEvent.tags).toContainEqual(expectedTag);
            });

            // Test REJECTION of replaceable kinds (using it.each is fine here as output type is consistent)
            it.each([
                // [description, kind, input, mockData]
                ['Kind 0 (cache)',      0, inputs.noteKind0, mockCachedReplaceableKind0],
                ['Kind 3 (network)',    3, inputs.neventKind3, mockNetworkReplaceableKind3],
                ['Kind 10002 (cache)',  10002, inputs.hexKind10k, mockCachedReplaceableKind10k],
                ['Kind 30001 (network)',30001, inputs.noteKind30k, mockNetworkReplaceableKind30k],
            ])(
                'should REJECT adding replaceable event: %s',
                async (_desc: string, kind: number, input: string, mockEventData: StoredEvent | NDKEvent) => {
                    const eventId = mockEventData.id;
                    if (mockEventData instanceof NDKEvent) { 
                        getEventByIdSpy.mockResolvedValue(undefined);
                        fetchEventSpy.mockResolvedValue(mockEventData);
                    } else { 
                        getEventByIdSpy.mockResolvedValue(mockEventData);
                        fetchEventSpy.mockClear(); 
                    }

                    const result = await addItemToList(listCoordinateId, input);

                    expect(result.success).toBe(false);
                    expect(result.error).toMatch(/Cannot add replaceable event kind \d+ as a static event reference/);
                    expect(result.error).toContain(`kind ${kind}`);
                    expect(getEventByIdSpy).toHaveBeenCalledWith(eventId);
                    if (mockEventData instanceof NDKEvent) {
                        expect(fetchEventSpy).toHaveBeenCalledWith({ ids: [eventId] });
                    } else {
                        expect(fetchEventSpy).not.toHaveBeenCalled();
                    }
                    expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
                }
            );

            // --- Test ALLOWANCE of non-replaceable kinds (Split into individual tests) ---
            it('should ALLOW adding non-replaceable event: Kind 1 (cache)', async () => {
                const input = inputs.neventKind1;
                const mockEventData = mockCachedNonReplaceableKind1;
                const expectedTag = expectedTags.neventKind1;
                const eventId = mockEventData.id;

                getEventByIdSpy.mockResolvedValue(mockEventData);
                fetchEventSpy.mockClear(); // Ensure network isn't called

                const result = await addItemToList(listCoordinateId, input);

                expect(result.success).toBe(true);
                expect(result.error).toBeUndefined();
                expect(getEventByIdSpy).toHaveBeenCalledWith(eventId);
                expect(fetchEventSpy).not.toHaveBeenCalled();
                expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
                const savedEvent = addOrUpdateEventSpy.mock.calls[0][0] as StoredEvent;
                expect(savedEvent.tags).toContainEqual(expectedTag);
            });

            it('should ALLOW adding non-replaceable event: Kind 4 (network)', async () => {
                const input = inputs.hexKind4;
                const mockEventData = mockNetworkNonReplaceableKind4;
                const expectedTag = expectedTags.hexKind4;
                const eventId = mockEventData.id;

                getEventByIdSpy.mockResolvedValue(undefined); // Cache miss
                fetchEventSpy.mockResolvedValue(mockEventData); // Network hit

                const result = await addItemToList(listCoordinateId, input);

                expect(result.success).toBe(true);
                expect(result.error).toBeUndefined();
                expect(getEventByIdSpy).toHaveBeenCalledWith(eventId);
                expect(fetchEventSpy).toHaveBeenCalledWith({ ids: [eventId] });
                expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
                const savedEvent = addOrUpdateEventSpy.mock.calls[0][0] as StoredEvent;
                expect(savedEvent.tags).toContainEqual(expectedTag);
            });
            // --- End split ALLOWANCE tests ---

            // Test ALLOWANCE when kind is unknown
            it('should ALLOW adding event if kind is unknown (fetch fails/not found)', async () => {
                getEventByIdSpy.mockResolvedValue(undefined);
                fetchEventSpy.mockResolvedValue(null);
                const input = inputs.noteUnknown;
                const expectedTag = expectedTags.noteUnknown;
                const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

                const result = await addItemToList(listCoordinateId, input);

                expect(result.success).toBe(true);
                expect(result.error).toBeUndefined();
                expect(getEventByIdSpy).toHaveBeenCalledWith(mockUnknownEventId);
                expect(fetchEventSpy).toHaveBeenCalledWith({ ids: [mockUnknownEventId] });
                expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Could not find event'));
                expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
                const savedEvent = addOrUpdateEventSpy.mock.calls[0][0] as StoredEvent;
                expect(savedEvent.tags).toContainEqual(expectedTag);

                consoleWarnSpy.mockRestore();
            });

        });
        // --- END: Revised Test suite for event kind fetching and validation ---

		it('should return error if user is not logged in', async () => {
			// Mock get(user) to return null
			vi.mocked(get).mockImplementation((store) => {
				if (store === user) {
					return null;
				}
				return undefined;
			});
			// Pass string input
			const result = await addItemToList(listCoordinateId, inputs.note);
			expect(result.success).toBe(false);
			expect(result.error).toBe('User not logged in');
			// User check happens before DB query
		});

		// Test adding a NIP-05 identifier successfully
		it('should add a valid NIP-05 identifier', async () => {
			const nip05Input = 'test@example.com';
			// Use a valid hex pubkey from test data
			const resolvedPubkey = testPubkey;
			const expectedTag = ['nip05', nip05Input, resolvedPubkey];

			getLatestEventByCoordSpy.mockResolvedValue(baseList);
			// Cast the mock implementation correctly via unknown
			(mockNip05.queryProfile as unknown as MockInstance).mockResolvedValue({ pubkey: resolvedPubkey });

			const result = await addItemToList(listCoordinateId, nip05Input);

			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
			expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
			const savedEvent = addOrUpdateEventSpy.mock.calls[0][0];
			expect(savedEvent.tags).toEqual(expect.arrayContaining([expectedTag]));
			expect(savedEvent.tags.length).toBe(baseList.tags.length + 1);
		});

		// Test adding a NIP-05 identifier that fails to resolve (returns null)
		it('should return error if NIP-05 identifier fails to resolve (returns null)', async () => {
			const nip05Input = 'notfound@example.com';

			getLatestEventByCoordSpy.mockResolvedValue(baseList);
			// Cast the mock implementation correctly via unknown
			(mockNip05.queryProfile as unknown as MockInstance).mockResolvedValue(null);

			const result = await addItemToList(listCoordinateId, nip05Input);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Failed to resolve NIP-05 identifier');
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		// Test adding a NIP-05 identifier that fails to resolve (throws error)
		it('should return error if NIP-05 identifier resolution throws an error', async () => {
			const nip05Input = 'error@example.com';

			getLatestEventByCoordSpy.mockResolvedValue(baseList);
			// Cast the mock implementation correctly via unknown
			 (mockNip05.queryProfile as unknown as MockInstance).mockRejectedValue(new Error('Network Error'));

			const result = await addItemToList(listCoordinateId, nip05Input);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Failed to resolve NIP-05 identifier');
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		// Test adding a duplicate NIP-05 identifier
		it('should return success without modifying if NIP-05 identifier is a duplicate', async () => {
			const nip05Input = 'duplicate@example.com';
			const existingListWithNip05: StoredEvent = {
				...baseList,
				tags: [...baseList.tags, ['nip05', nip05Input, 'some_existing_pubkey']],
			};

			getLatestEventByCoordSpy.mockResolvedValue(existingListWithNip05);
			// nip05.queryProfile shouldn't even be called if duplicate check works

			const result = await addItemToList(listCoordinateId, nip05Input);

			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
			expect(result.newEventId).toBe(existingListWithNip05.id); // Should return original ID
			expect(mockNip05.queryProfile).not.toHaveBeenCalled(); // Verify resolution wasn't attempted
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		// TODO: Add test case for adding NIP-05 to wrong list kind when kind check is implemented.

		// Regression Test: Ensure adding a standard npub still works
		it('REGRESSION: should still add a valid npub identifier correctly', async () => {
			const npubInput = nip19.npubEncode(testPubkey);
			const expectedTag = ['p', testPubkey];

			getLatestEventByCoordSpy.mockResolvedValue(baseList);

			const result = await addItemToList(listCoordinateId, npubInput);

			expect(result.success).toBe(true);
			expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
			const savedEvent = addOrUpdateEventSpy.mock.calls[0][0];
			expect(savedEvent.tags).toEqual(expect.arrayContaining([expectedTag]));
		});

	});

	describe('removeItemFromList', () => {
		const itemToRemove: Item = { type: 'p', value: 'existing_pubkey1' };
		const nonExistentItem: Item = { type: 'e', value: 'non_existent_id' };

		it('should remove an existing item and save a new event version', async () => {
			const result = await removeItemFromList(listCoordinateId, itemToRemove);

			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
			expect(result.newEventId).toBeDefined();
			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(testKind, testPubkey, testDTag);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();

			const savedEvent = addOrUpdateEventSpy.mock.calls[0][0] as StoredEvent;
			// Check the specific tag was removed
			expect(savedEvent.tags).not.toContainEqual([itemToRemove.type, itemToRemove.value]);
			// Check other tags remain
			expect(savedEvent.tags).toContainEqual(['d', testDTag]);
			expect(savedEvent.tags).toContainEqual(['e', 'existing_eventid1']);
			// Check final tag count
			expect(savedEvent.tags.length).toBe(baseList.tags.length - 1);
			expect(savedEvent.pubkey).toBe(currentUser.pubkey);
			expect(savedEvent.created_at).toBeGreaterThan(baseList.created_at);
			expect(savedEvent.published).toBe(false);
		});

		it('should proceed successfully even if item to remove is not found', async () => {
			const result = await removeItemFromList(listCoordinateId, nonExistentItem);

			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
			expect(result.newEventId).toBeDefined();
			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(testKind, testPubkey, testDTag);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();

			const savedEvent = addOrUpdateEventSpy.mock.calls[0][0] as StoredEvent;
			// Tags should be the same as the original since item wasn't found
			expect(savedEvent.tags).toEqual(baseList.tags);
			expect(savedEvent.tags.length).toBe(baseList.tags.length);
		});

		it('should return error for invalid coordinate ID format', async () => {
			const invalidCoord = '123:abc';
			const result = await removeItemFromList(invalidCoord, itemToRemove);
			expect(result.success).toBe(false);
			expect(result.error).toBe('Invalid list coordinate ID format.');
			expect(getLatestEventByCoordSpy).not.toHaveBeenCalled();
		});

		it('should return error if user pubkey does not match coordinate pubkey', async () => {
			const wrongUserCoord = `${testKind}:${otherUserPubkey}:${testDTag}`; // Uses fixed valid otherUserPubkey
			const result = await removeItemFromList(wrongUserCoord, itemToRemove);
			expect(result.success).toBe(false);
			expect(result.error).toBe('Cannot modify a list belonging to another user.'); // Assertion should now be correct
			expect(getLatestEventByCoordSpy).not.toHaveBeenCalled();
		});

		it('should return error if list event not found locally by coordinate', async () => {
			getLatestEventByCoordSpy.mockResolvedValueOnce(undefined);
			const result = await removeItemFromList(listCoordinateId, itemToRemove);
			expect(result.success).toBe(false);
			expect(result.error).toContain(`List event with coordinate ${listCoordinateId} not found locally`);
			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(testKind, testPubkey, testDTag);
		});

		it('should return error if DB lookup finds event for different user (safety check)', async () => {
			getLatestEventByCoordSpy.mockResolvedValueOnce(otherUsersList);
			const result = await removeItemFromList(listCoordinateId, itemToRemove);
			expect(result.success).toBe(false);
			expect(result.error).toBe('List ownership mismatch. Cannot modify.');
			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(testKind, testPubkey, testDTag);
		});

		it('should return error if currentUser is not available', async () => {
			// Mock get(user) to return null
			vi.mocked(get).mockImplementation((store) => {
				if (store === user) {
					return null;
				}
				return undefined;
			});
			const result = await removeItemFromList(listCoordinateId, itemToRemove);
			expect(result.success).toBe(false);
			expect(result.error).toBe('User not logged in');
			// User check happens before DB query
		});

		it('should return error if NDK instance is not available', async () => {
			 // Mock ndkService.getNdkInstance to return null
			 vi.mocked(ndkService.getNdkInstance).mockReturnValue(null as unknown as NDK);
			 const result = await removeItemFromList(listCoordinateId, itemToRemove);
			 expect(result.success).toBe(false);
			 expect(result.error).toBe('NDK not initialized');
			 // NDK check happens before DB query
		 });

		it('should return error if signer is not available', async () => {
			// Mock ndkService.getSigner to return undefined
			vi.mocked(ndkService.getSigner).mockReturnValue(undefined);
			const result = await removeItemFromList(listCoordinateId, itemToRemove);
			expect(result.success).toBe(false);
			expect(result.error).toBe('Nostr signer not available (NIP-07?)');
			// Signer check happens before DB query
		});

		it('should handle signing errors gracefully', async () => {
			signSpy.mockRejectedValueOnce(new Error('Signing failed'));
			const result = await removeItemFromList(listCoordinateId, itemToRemove);
			expect(result.success).toBe(false);
			expect(result.error).toContain('Signing failed');
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should handle DB save errors gracefully', async () => {
			addOrUpdateEventSpy.mockRejectedValueOnce(new Error('DB write failed'));
			const result = await removeItemFromList(listCoordinateId, itemToRemove);
			expect(result.success).toBe(false);
			expect(result.error).toContain('DB write failed');
			expect(addOrUpdateEventSpy).toHaveBeenCalledOnce(); // Attempted to save
		});
	});

	// +++ NEW TEST SUITE FOR renameList +++
	describe('renameList', () => {
		const newListName = 'My Updated Bookmarks';
		const listCoord = `30001:${testPubkey}:old-name`; // Use a specific coord for rename tests
		const originalList: StoredEvent = {
			id: 'original_event_id_rename',
			kind: 30001,
			pubkey: testPubkey,
			created_at: Math.floor(Date.now() / 1000) - 2000,
			tags: [
				['d', 'old-name'],
				['title', 'Old Name'],
				['p', 'pubkey1'],
				['e', 'eventid1'],
				['otherTag', 'value'],
			],
			content: 'Original list content',
			sig: 'original-sig-rename',
			dTag: 'old-name',
			published: true,
		};

		beforeEach(() => {
			// Default successful mocks for this suite
			getLatestEventByCoordSpy.mockResolvedValue(originalList);
			addOrUpdateEventSpy.mockResolvedValue(undefined); // Assuming void return on success
			// signSpy is already mocked in the parent beforeEach to add id/sig
		});

		it('should successfully rename a list', async () => {
			const result = await renameList(listCoord, newListName);

			expect(result.success).toBe(true);
			expect(result.newEventId).toBeDefined();
			expect(result.error).toBeUndefined();

			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(30001, testPubkey, 'old-name');
			expect(signSpy).toHaveBeenCalledOnce();
			expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();

			const savedEvent = addOrUpdateEventSpy.mock.calls[0][0] as StoredEvent;
			expect(savedEvent.id).toBe(result.newEventId);
			expect(savedEvent.sig).toBeDefined();
			expect(savedEvent.pubkey).toBe(testPubkey);
			expect(savedEvent.kind).toBe(30001);
			expect(savedEvent.content).toBe(originalList.content); // Content preserved
			expect(savedEvent.created_at).toBeGreaterThan(originalList.created_at);
			expect(savedEvent.published).toBe(false); // Crucial: unpublished
			expect(savedEvent.dTag).toBe('old-name'); // Crucial: dTag remains the ORIGINAL

			// Verify tags
			const dTag = savedEvent.tags.find(t => t[0] === 'd');
			const titleTag = savedEvent.tags.find(t => t[0] === 'title');
			expect(dTag).toEqual(['d', 'old-name']); // Original d tag kept
			expect(titleTag).toEqual(['title', newListName]); // New title tag added
			expect(savedEvent.tags).toContainEqual(['p', 'pubkey1']);
			expect(savedEvent.tags).toContainEqual(['e', 'eventid1']);
			expect(savedEvent.tags).toContainEqual(['otherTag', 'value']);
			// Original title removed, new title added, original d and others kept
			expect(savedEvent.tags.length).toBe(originalList.tags.length);
		});

		// --- Error Cases ---
		it('should return error if user is not logged in', async () => {
			vi.mocked(get).mockReturnValue(null); // Simulate no user
			const result = await renameList(listCoord, newListName);
			expect(result).toEqual({ success: false, error: 'User not logged in' });
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error if NDK is not initialized', async () => {
			// Use null as any to bypass strict type check for this specific error case
			vi.mocked(ndkService.getNdkInstance).mockReturnValue(null as any);
			const result = await renameList(listCoord, newListName);
			expect(result).toEqual({ success: false, error: 'NDK not initialized' });
			 expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error if signer is not available', async () => {
			// Use undefined instead of null for type compatibility
			vi.mocked(ndkService.getSigner).mockReturnValue(undefined);
			const result = await renameList(listCoord, newListName);
			expect(result).toEqual({ success: false, error: 'Nostr signer not available (NIP-07? NIP-46?)' });
			 expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error if new name is empty', async () => {
			const result = await renameList(listCoord, '  ');
			expect(result).toEqual({ success: false, error: 'New list name cannot be empty or just whitespace.' });
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error for invalid list coordinate format', async () => {
			const result = await renameList('invalid-coord', newListName);
			expect(result).toEqual({ success: false, error: 'Invalid list coordinate ID format.' });
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error if trying to rename another user\'s list (initial check)', async () => {
			const otherUserCoord = `30001:${otherUserPubkey}:some-list`;
			const result = await renameList(otherUserCoord, newListName);
			expect(result).toEqual({ success: false, error: 'Cannot rename a list belonging to another user.' });
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		 it('should return error if list kind is not replaceable', async () => {
			 const nonReplaceableCoord = `1:${testPubkey}:not-a-list`; // Kind 1
			 // Mock parseCoordinateId behaviour implicitly by calling with coord
			 const result = await renameList(nonReplaceableCoord, newListName);
			 expect(result).toEqual({ success: false, error: `Cannot rename event of kind 1 as it's not replaceable.` });
			 expect(getLatestEventByCoordSpy).not.toHaveBeenCalled();
			 expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		 });

		it('should return error if list event is not found locally', async () => {
			getLatestEventByCoordSpy.mockResolvedValue(undefined);
			const result = await renameList(listCoord, newListName);
			expect(result).toEqual({ success: false, error: `List event with coordinate ${listCoord} not found locally.` });
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error on fetched ownership mismatch (safety check)', async () => {
			const mismatchedList = { ...originalList, pubkey: otherUserPubkey };
			getLatestEventByCoordSpy.mockResolvedValue(mismatchedList);
			const result = await renameList(listCoord, newListName);
			expect(result).toEqual({ success: false, error: 'List ownership mismatch (DB error?). Cannot rename.' });
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error if signing fails (no id/sig)', async () => {
			signSpy.mockImplementation(async function(this: NDKEvent) {
				// Simulate signing failure by not setting id/sig
				this.id = undefined as any;
				this.sig = undefined as any;
				return ''; // Or throw?
			});
			const result = await renameList(listCoord, newListName);
			expect(result).toEqual({ success: false, error: 'Failed to sign the renamed list event.' });
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		 it('should return error if signing throws an error', async () => {
			 const signError = new Error('Signer exploded');
			 signSpy.mockRejectedValue(signError);
			 const result = await renameList(listCoord, newListName);
			 expect(result).toEqual({ success: false, error: 'Signer exploded' });
			 expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		 });

		it('should return error if saving to local DB fails', async () => {
			const dbError = new Error('DB write failed');
			addOrUpdateEventSpy.mockRejectedValue(dbError);
			const result = await renameList(listCoord, newListName);

			expect(result.success).toBe(false);
			// Expect the actual error message when the DexieError check doesn't match
			expect(result.error).toBe(dbError.message); // Changed from toContain to toBe

			// Verify save was attempted
			expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
		});

		it('should add the new name as a title tag', async () => {
			// ... test body ...
		});
	});

	// =====================================================================
	// ===================== Tests for deleteList ==========================
	// =====================================================================
	describe('deleteList', () => {
		const listToDeleteCoord = `30001:${testPubkey}:delete-me`;
		const originalEvent: StoredEvent = {
			id: 'original-list-event-id-to-delete',
			kind: 30001,
			pubkey: testPubkey,
			dTag: 'delete-me',
			created_at: 1700000000,
			tags: [['d', 'delete-me'], ['title', 'List to Delete']],
			content: '',
			sig: 'original-sig',
			published: true,
		};

		let publishSpy: MockInstance;
		let refreshTriggerUpdateSpy: MockInstance;

		beforeEach(() => {
			// Assign spies/mocks from the outer scope or re-mock if needed
			publishSpy = vi.mocked(ndkService.publish);
			refreshTriggerUpdateSpy = vi.mocked(refreshTrigger.update);
		});

		it('should successfully publish NIP-09 and delete list locally', async () => {
			getLatestEventByCoordSpy.mockResolvedValue(originalEvent);
			signSpy.mockImplementation(async function (this: NDKEvent) {
				// Simulate signing adds ID and Sig
				this.id = 'kind5-event-id';
				this.sig = 'kind5-sig';
				return 'kind5-sig';
			});
			publishSpy.mockResolvedValue(new Set(['wss://relay1.com']));
			deleteEventByIdSpy.mockResolvedValue(undefined);

			const result = await deleteList(listToDeleteCoord);

			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();

			// Verify function calls
			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(30001, testPubkey, 'delete-me');
			expect(signSpy).toHaveBeenCalledOnce(); // Verify signing was attempted
			expect(publishSpy).toHaveBeenCalledOnce(); // Verify publish was attempted
			expect(deleteEventByIdSpy).toHaveBeenCalledWith(originalEvent.id);
			expect(refreshTriggerUpdateSpy).toHaveBeenCalledOnce();

			// Verify the event passed to publish
			const publishedEvent = publishSpy.mock.calls[0][0] as NDKEvent; // Get the event passed to publish
			expect(publishedEvent).toBeInstanceOf(NDKEvent);
			expect(publishedEvent.kind).toBe(NDKKind.EventDeletion); // Check kind on the published event
			expect(publishedEvent.tags).toEqual([['e', originalEvent.id]]); // Check tags on the published event
			expect(publishedEvent.id).toBe('kind5-event-id'); // Check the ID assigned during mock signing
			expect(publishedEvent.sig).toBe('kind5-sig'); // Check the sig assigned during mock signing
		});

		it('should proceed with local delete and return success even if NIP-09 publish fails', async () => {
			getLatestEventByCoordSpy.mockResolvedValue(originalEvent);
			signSpy.mockImplementation(async function (this: NDKEvent) {
				this.id = 'kind5-event-id-failpub';
				this.sig = 'kind5-sig-failpub';
				return 'kind5-sig-failpub';
			});
			publishSpy.mockRejectedValue(new Error('Publish failed')); // Simulate publish error
			deleteEventByIdSpy.mockResolvedValue(undefined);

			const result = await deleteList(listToDeleteCoord);

			expect(result.success).toBe(true); // Still success because local delete worked
			expect(result.error).toBeUndefined();

			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(30001, testPubkey, 'delete-me');
			expect(signSpy).toHaveBeenCalledOnce();
			expect(publishSpy).toHaveBeenCalledOnce(); // Publish was attempted
			expect(deleteEventByIdSpy).toHaveBeenCalledWith(originalEvent.id);
			expect(refreshTriggerUpdateSpy).toHaveBeenCalledOnce(); // Refresh happens on successful local delete
		});

		it('should proceed with local delete and return success even if NIP-09 signing fails', async () => {
			getLatestEventByCoordSpy.mockResolvedValue(originalEvent);
			signSpy.mockRejectedValue(new Error('Signing error')); // Simulate signing error
			deleteEventByIdSpy.mockResolvedValue(undefined);
			// publishSpy should not be called

			const result = await deleteList(listToDeleteCoord);

			expect(result.success).toBe(true); // Still success because local delete worked
			expect(result.error).toBeUndefined();

			expect(getLatestEventByCoordSpy).toHaveBeenCalledWith(30001, testPubkey, 'delete-me');
			expect(signSpy).toHaveBeenCalledOnce();
			expect(publishSpy).not.toHaveBeenCalled();
			expect(deleteEventByIdSpy).toHaveBeenCalledWith(originalEvent.id);
			expect(refreshTriggerUpdateSpy).toHaveBeenCalledOnce();
		});

		it('should return error if coordinate is invalid', async () => {
			const result = await deleteList('invalid-coordinate');
			expect(result.success).toBe(false);
			expect(result.error).toContain('Invalid list coordinate ID format');
			expect(deleteEventByIdSpy).not.toHaveBeenCalled();
			expect(refreshTriggerUpdateSpy).not.toHaveBeenCalled();
		});

		it('should return error if user does not own the list', async () => {
			const otherUserCoord = `30001:${otherUserPubkey}:their-list`;
			const result = await deleteList(otherUserCoord);
			expect(result.success).toBe(false);
			expect(result.error).toContain('Cannot delete a list belonging to another user');
			expect(deleteEventByIdSpy).not.toHaveBeenCalled();
			 expect(refreshTriggerUpdateSpy).not.toHaveBeenCalled();
		});

		it('should return error if list is not found locally', async () => {
			getLatestEventByCoordSpy.mockResolvedValue(undefined);
			const result = await deleteList(listToDeleteCoord);
			expect(result.success).toBe(false);
			expect(result.error).toContain('not found locally');
			expect(signSpy).not.toHaveBeenCalled();
			expect(publishSpy).not.toHaveBeenCalled();
			expect(deleteEventByIdSpy).not.toHaveBeenCalled();
			expect(refreshTriggerUpdateSpy).not.toHaveBeenCalled();
		});

		it('should return error if local delete fails', async () => {
			getLatestEventByCoordSpy.mockResolvedValue(originalEvent);
			signSpy.mockImplementation(async function (this: NDKEvent) {
				this.id = 'kind5-event-id-faildel';
				this.sig = 'kind5-sig-faildel';
				return 'kind5-sig-faildel';
			});
			publishSpy.mockResolvedValue(new Set()); // Publish succeeds (or fails, doesn't matter)
			deleteEventByIdSpy.mockRejectedValue(new Error('DB delete error')); // Simulate local DB error

			const result = await deleteList(listToDeleteCoord);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Failed to remove list from local database');
			expect(getLatestEventByCoordSpy).toHaveBeenCalledOnce();
			// Sign and Publish might have been called depending on when the delete failed
			expect(deleteEventByIdSpy).toHaveBeenCalledWith(originalEvent.id);
			expect(refreshTriggerUpdateSpy).not.toHaveBeenCalled(); // Refresh shouldn't trigger if local delete fails
		});

		 it('should return error if user/signer/ndk is missing', async () => {
			vi.mocked(get).mockReturnValue(null);
			let result = await deleteList(listToDeleteCoord);
			expect(result.success).toBe(false);
			expect(result.error).toBe('User not logged in');

			vi.mocked(get).mockReturnValue(currentUser);
			vi.mocked(ndkService.getSigner).mockReturnValue(undefined);
			result = await deleteList(listToDeleteCoord);
			expect(result.success).toBe(false);
			expect(result.error).toBe('Nostr signer not available');

			vi.mocked(ndkService.getSigner).mockReturnValue(mockSigner);
			// Ensure the mock returns undefined, which should cause the service function to return the error
			vi.mocked(ndkService.getNdkInstance).mockReturnValue(undefined as unknown as NDK); 
			result = await deleteList(listToDeleteCoord);
			expect(result.success).toBe(false);
			expect(result.error).toBe('NDK not initialized');

			// Restore NDK instance for subsequent tests if any
			vi.mocked(ndkService.getNdkInstance).mockReturnValue(mockNdkInstance as NDK);
		});
	});

});
