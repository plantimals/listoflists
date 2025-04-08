import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import NDK, { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk';
import type { NDKSigner, NostrEvent } from '@nostr-dev-kit/ndk';
import type { NDKUser } from '@nostr-dev-kit/ndk';
import { localDb, type StoredEvent } from '$lib/localDb';
import { addItemToList, removeItemFromList, type Item } from '$lib/listService';
import { nip19 } from 'nostr-tools';

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
// --- End mocks --- 

// Access the mocked NDKUser
const { NDKUser: MockNDKUser } = await import('@nostr-dev-kit/ndk');
// --- Access mocked service/store/get --- 
const { ndkService } = await import('$lib/ndkService');
const { user } = await import('$lib/userStore');
const { get } = await import('svelte/store');
// --- End access ---

// Spy variables for localDb methods and NDKEvent.sign
let getLatestEventByCoordSpy: MockInstance<typeof localDb.getLatestEventByCoord>;
let addOrUpdateEventSpy: MockInstance<typeof localDb.addOrUpdateEvent>;
let signSpy: MockInstance<(signer?: NDKSigner | undefined) => Promise<string>>;

// Mock the NDK instance and its methods if necessary
const mockNdkInstance: Partial<NDK> = {
	signer: undefined, // Will be set in beforeEach
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

// Test Input Data and Expected Tags
const inputs = {
	npub: nip19.npubEncode(testPubkey),
	nprofile: nip19.nprofileEncode({ pubkey: testPubkey, relays: [testRelayHint] }),
	note: nip19.noteEncode(testEventId),
	nevent: nip19.neventEncode({ id: testEventId, relays: [testRelayHint], author: testPubkey }),
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

		// Set up NDK Signer and spy on NDKEvent.sign
		mockNdkInstance.signer = mockSigner;
		signSpy = vi.spyOn(NDKEvent.prototype, 'sign').mockImplementation(async function(this: NDKEvent) {
			this.id = `mock_id_${Date.now()}`;
			this.sig = `mock_sig_${Date.now()}`;
			return this.sig;
		});
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
			// Add hexPubkey test if ambiguity handling changes (e.g., to 'p')
		])('should correctly add item for %s input', async (inputType, inputString, expectedTag) => {
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
			expect(result.error).toContain('Invalid input format');
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
});
