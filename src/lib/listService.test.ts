import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import NDK, { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk';
import type { NDKSigner, NostrEvent } from '@nostr-dev-kit/ndk';
import type { NDKUser } from '@nostr-dev-kit/ndk';
import { localDb, type StoredEvent } from '$lib/localDb';
import type { ListServiceDependencies } from '$lib/listService';
import { addItemToList, removeItemFromList } from '$lib/listService';

// Remove outer scope mock function variables
// let mockGetEventById: ReturnType<typeof vi.fn>;
// let mockAddOrUpdateEvent: ReturnType<typeof vi.fn>;

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

// REMOVE the vi.mock for $lib/localDb
// vi.mock('$lib/localDb', async () => { ... });

// Access the mocked NDKUser
const { NDKUser: MockNDKUser } = await import('@nostr-dev-kit/ndk');

// Spy variables for localDb methods and NDKEvent.sign
let getEventByIdSpy: MockInstance<typeof localDb.getEventById>;
let addOrUpdateEventSpy: MockInstance<typeof localDb.addOrUpdateEvent>;
let signSpy: MockInstance<(signer?: NDKSigner | undefined) => Promise<string>>;

// Mock the NDK instance and its methods if necessary
const mockNdkInstance: Partial<NDK> = {
	signer: undefined, // Will be set in beforeEach
};

// Mock NIP-07 signer
const mockSigner: NDKSigner = {
	user: async () => ({ pubkey: 'f00d' } as unknown as NDKUser),
	sign: vi.fn().mockImplementation(async (event: NostrEvent) => {
		return `signed-sig-nip07-${event.id}`;
	}),
	encrypt: vi.fn(),
	decrypt: vi.fn(),
	pubkey: 'f00d',
	blockUntilReady: async (): Promise<NDKUser> => {
		return { pubkey: 'f00d' } as unknown as NDKUser;
	},
	userSync: { pubkey: 'f00d' } as unknown as NDKUser,
};

// --- Test Data ---
const currentUser = new MockNDKUser({ pubkey: 'f00d' });
const otherUser = new MockNDKUser({ pubkey: '0ther' });
const baseList: StoredEvent = {
	id: 'base_event_id_123',
	kind: 30003,
	pubkey: currentUser.pubkey,
	created_at: Math.floor(Date.now() / 1000) - 1000,
	tags: [
		['d', 'my-bookmarks'],
		['p', 'pubkey1'],
		['e', 'eventid1'],
	],
	content: 'Base bookmark list',
	sig: 'sig1',
	dTag: 'my-bookmarks',
	published: true,
};
const otherUsersList: StoredEvent = {
	...baseList,
	pubkey: otherUser.pubkey,
	id: 'other_event_id_456',
};

// Redefine ListServiceDependencies to match service expectations IF needed
// The service actually imports { localDb } directly, so we don't need
// to pass these methods via dependencies object. We only need
// currentUser and ndkInstance for the service function signature.
type TestDependencies = {
	currentUser: NDKUser | null;
	ndkInstance: NDK | null;
}
let testDeps: TestDependencies;

// --- Test Suites ---
describe('listService', () => {
	beforeEach(() => {
		// Reset spies and mocks
		vi.resetAllMocks();

		// Set up spies on the ACTUAL localDb methods
		getEventByIdSpy = vi.spyOn(localDb, 'getEventById').mockResolvedValue(baseList);
		addOrUpdateEventSpy = vi.spyOn(localDb, 'addOrUpdateEvent').mockResolvedValue(undefined);

		// Set up NDK Signer and spy on NDKEvent.sign
		mockNdkInstance.signer = mockSigner;
		signSpy = vi.spyOn(NDKEvent.prototype, 'sign').mockImplementation(async function(this: NDKEvent) {
			this.id = `mock_id_${Date.now()}`;
			this.sig = `mock_sig_${Date.now()}`;
			return this.sig;
		});

		// Set up test dependencies object passed to service function
		testDeps = {
			currentUser: currentUser,
			ndkInstance: mockNdkInstance as NDK,
		};
	});

	afterEach(() => {
		// Restore all spies
        vi.restoreAllMocks(); // This should restore spies created with vi.spyOn
	});

	// Tests now rely on spies intercepting calls to the actual localDb
	describe('addItemToList', () => {
		const listEventId = baseList.id;
		const newItem = { type: 'p' as 'p'|'e', value: 'pubkey2' };
		const itemToAddTag = [newItem.type, newItem.value];

		it('should add a new item to an existing list', async () => {
			// Pass the simplified testDeps object
			const result = await addItemToList(listEventId, newItem, testDeps);
			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
			expect(result.newEventId).toBeDefined();
			// Check spies
			expect(getEventByIdSpy).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
			// Check call arguments on the spy
			const savedEvent = addOrUpdateEventSpy.mock.calls[0][0] as StoredEvent;
			expect(savedEvent.tags).toContainEqual(itemToAddTag);
			expect(savedEvent.tags.length).toBe(baseList.tags.length + 1);
			expect(savedEvent.pubkey).toBe(currentUser.pubkey);
			expect(savedEvent.created_at).toBeGreaterThan(baseList.created_at);
			expect(savedEvent.published).toBe(false);
		});

		it('should update an existing item in a list (by replacing - check idempotency)', async () => {
			// Use spy to control return value for this specific call
			getEventByIdSpy.mockResolvedValueOnce(baseList);
			const existingItem = { type: 'p' as 'p'|'e', value: 'pubkey1' };
			const resultIdempotent = await addItemToList(listEventId, existingItem, testDeps);

			expect(resultIdempotent.success).toBe(true);
			expect(resultIdempotent.error).toBeUndefined();
			// Check spies
			expect(getEventByIdSpy).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
			const updatedEvent = addOrUpdateEventSpy.mock.calls[0][0] as StoredEvent;
			expect(updatedEvent.tags).toContainEqual(['p', 'pubkey1']);
			expect(updatedEvent.tags.length).toBe(baseList.tags.length);
		});

		it('should return error if list event not found locally', async () => {
			// Use spy to control return value
			getEventByIdSpy.mockResolvedValueOnce(undefined);
			const result = await addItemToList(listEventId, newItem, testDeps);
			expect(result.success).toBe(false);
			expect(result.error).toContain(`List event with ID ${listEventId} not found locally`);
			// Check spies
			expect(getEventByIdSpy).toHaveBeenCalledWith(listEventId);
			expect(signSpy).not.toHaveBeenCalled();
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error if currentUser is not available', async () => {
			const depsWithoutUser: TestDependencies = { ...testDeps, currentUser: null };
			const result = await addItemToList(listEventId, newItem, depsWithoutUser);
			expect(result.success).toBe(false);
			expect(result.error).toBe('User not logged in');
		});

		it('should return error if NDK instance is not available', async () => {
			const depsWithoutNdk: TestDependencies = { ...testDeps, ndkInstance: null };
			const result = await addItemToList(listEventId, newItem, depsWithoutNdk);
			expect(result.success).toBe(false);
			expect(result.error).toBe('NDK not initialized');
		});

		it('should return error if signer is not available', async () => {
			const ndkWithoutSigner = { ...mockNdkInstance, signer: undefined } as Partial<NDK>;
			const depsWithoutSigner: TestDependencies = { ...testDeps, ndkInstance: ndkWithoutSigner as NDK };
			const result = await addItemToList(listEventId, newItem, depsWithoutSigner);
			expect(result.success).toBe(false);
			expect(result.error).toBe('Nostr signer not available (NIP-07?)');
		});

		it('should return error if event pubkey does not match currentUser.pubkey', async () => {
			// Use spy to control return value
			getEventByIdSpy.mockResolvedValueOnce(otherUsersList);
			const result = await addItemToList(listEventId, newItem, testDeps);
			expect(result.success).toBe(false);
			expect(result.error).toBe('Cannot modify an event belonging to another user.');
			// Check spies
			expect(getEventByIdSpy).toHaveBeenCalledWith(listEventId);
			expect(signSpy).not.toHaveBeenCalled();
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error if signing fails', async () => {
			// Use spy to control return value
			getEventByIdSpy.mockResolvedValueOnce(baseList);
			const signError = new Error('Signature failed');
			signSpy.mockRejectedValueOnce(signError);
			const result = await addItemToList(listEventId, newItem, testDeps);
			expect(result.success).toBe(false);
			expect(result.error).toContain(signError.message);
			// Check spies
			expect(getEventByIdSpy).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error if addOrUpdateEvent fails', async () => {
			const dbError = new Error('Database write failed');
			// Use spies to control return values
			getEventByIdSpy.mockResolvedValueOnce(baseList);
			addOrUpdateEventSpy.mockRejectedValueOnce(dbError);
			const result = await addItemToList(listEventId, newItem, testDeps);
			expect(result.success).toBe(false);
			expect(result.error).toContain(dbError.message);
			// Check spies
			expect(getEventByIdSpy).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
		});
	});

	describe('removeItemFromList', () => {
		const listEventId = baseList.id;
		const itemToRemove = { type: 'p' as 'p'|'e', value: 'pubkey1' };
		const itemToRemoveTag = [itemToRemove.type, itemToRemove.value];

		it('should remove an existing item from a list', async () => {
			const result = await removeItemFromList(listEventId, itemToRemove, testDeps);
			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
			expect(result.newEventId).toBeDefined();
			// Check spies
			expect(getEventByIdSpy).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
			const savedEvent = addOrUpdateEventSpy.mock.calls[0][0] as StoredEvent;
			expect(savedEvent.tags).not.toContainEqual(itemToRemoveTag);
			expect(savedEvent.tags).toContainEqual(['d', 'my-bookmarks']);
			expect(savedEvent.tags).toContainEqual(['e', 'eventid1']);
			expect(savedEvent.tags.length).toBe(baseList.tags.length - 1);
			expect(savedEvent.pubkey).toBe(currentUser.pubkey);
			expect(savedEvent.created_at).toBeGreaterThan(baseList.created_at);
			expect(savedEvent.published).toBe(false);
		});

		it('should succeed even if item does not exist in list (idempotent remove)', async () => {
			const nonExistentItem = { type: 'p' as 'p'|'e', value: 'nonexistent' };
			// Use spy to control return value
			getEventByIdSpy.mockResolvedValueOnce(baseList);
			const result = await removeItemFromList(listEventId, nonExistentItem, testDeps);
			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
			expect(result.newEventId).toBeDefined();
			// Check spies
			expect(getEventByIdSpy).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
		});

		it('should return error if list event not found locally', async () => {
			// Use spy to control return value
			getEventByIdSpy.mockResolvedValueOnce(undefined);
			const result = await removeItemFromList(listEventId, itemToRemove, testDeps);
			expect(result.success).toBe(false);
			expect(result.error).toContain(`List event with ID ${listEventId} not found locally`);
			// Check spies
			expect(getEventByIdSpy).toHaveBeenCalledWith(listEventId);
			expect(signSpy).not.toHaveBeenCalled();
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error if currentUser is not available', async () => {
			const depsWithoutUser: TestDependencies = { ...testDeps, currentUser: null };
			const result = await removeItemFromList(listEventId, itemToRemove, depsWithoutUser);
			expect(result.success).toBe(false);
			expect(result.error).toBe('User not logged in');
		});

		it('should return error if NDK instance is not available', async () => {
			const depsWithoutNdk: TestDependencies = { ...testDeps, ndkInstance: null };
			const result = await removeItemFromList(listEventId, itemToRemove, depsWithoutNdk);
			expect(result.success).toBe(false);
			expect(result.error).toBe('NDK not initialized');
		});

		it('should return error if signer is not available', async () => {
			const ndkWithoutSigner = { ...mockNdkInstance, signer: undefined } as Partial<NDK>;
			const depsWithoutSigner: TestDependencies = { ...testDeps, ndkInstance: ndkWithoutSigner as NDK };
			const result = await removeItemFromList(listEventId, itemToRemove, depsWithoutSigner);
			expect(result.success).toBe(false);
			expect(result.error).toBe('Nostr signer not available (NIP-07?)');
		});

		it('should return error if event pubkey does not match currentUser.pubkey', async () => {
			// Use spy to control return value
			getEventByIdSpy.mockResolvedValueOnce(otherUsersList);
			const result = await removeItemFromList(listEventId, itemToRemove, testDeps);
			expect(result.success).toBe(false);
			expect(result.error).toBe('Cannot modify an event belonging to another user.');
			// Check spies
			expect(getEventByIdSpy).toHaveBeenCalledWith(listEventId);
			expect(signSpy).not.toHaveBeenCalled();
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error if signing fails', async () => {
			// Use spies to control return values
			getEventByIdSpy.mockResolvedValueOnce(baseList);
			const signError = new Error('Signature failed');
			signSpy.mockRejectedValueOnce(signError);
			const result = await removeItemFromList(listEventId, itemToRemove, testDeps);
			expect(result.success).toBe(false);
			expect(result.error).toContain(signError.message);
			// Check spies
			expect(getEventByIdSpy).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(addOrUpdateEventSpy).not.toHaveBeenCalled();
		});

		it('should return error if addOrUpdateEvent fails', async () => {
			const dbError = new Error('Database write failed');
			// Use spies to control return values
			getEventByIdSpy.mockResolvedValueOnce(baseList);
			addOrUpdateEventSpy.mockRejectedValueOnce(dbError);
			const result = await removeItemFromList(listEventId, itemToRemove, testDeps);
			expect(result.success).toBe(false);
			expect(result.error).toContain(dbError.message);
			// Check spies
			expect(getEventByIdSpy).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(addOrUpdateEventSpy).toHaveBeenCalledOnce();
		});
	});
});
