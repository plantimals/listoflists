import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import NDK, { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk';
import type { NDKSigner, NostrEvent } from '@nostr-dev-kit/ndk';
import type { NDKUser } from '@nostr-dev-kit/ndk';
import type { StoredEvent } from '$lib/localDb';
import type { ListServiceDependencies } from '$lib/listService';
import { addItemToList, removeItemFromList } from '$lib/listService';

// Re-define mock functions in outer scope
const mockGetEventById = vi.fn();
const mockAddOrUpdateEvent = vi.fn();

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

// Mock localDb - Assign outer mocks inside factory, do not export
vi.mock('$lib/localDb', async () => {
	return {
		localDb: {
			getEventById: mockGetEventById,
			addOrUpdateEvent: mockAddOrUpdateEvent,
		},
	};
});

// Access the mocked NDKUser
const { NDKUser: MockNDKUser } = await import('@nostr-dev-kit/ndk');
// DO NOT import mock DB functions

// Spy variable for NDKEvent.sign with explicit type
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

// --- Dependencies Object ---
let deps: ListServiceDependencies;

// --- Test Suites ---
describe('listService', () => {
	beforeEach(() => {
		// Reset mocks FIRST - Use outer scope mocks
		vi.resetAllMocks(); // Resets spies too
        mockGetEventById.mockClear();
        mockAddOrUpdateEvent.mockClear();

		// Set up dependencies and default mocks - Use outer scope mocks
		mockNdkInstance.signer = mockSigner;
		mockGetEventById.mockResolvedValue(baseList);
		mockAddOrUpdateEvent.mockResolvedValue(undefined);

		// Set up spy AFTER resetting mocks
		signSpy = vi.spyOn(NDKEvent.prototype, 'sign').mockImplementation(async function(this: NDKEvent) {
			this.id = `mock_id_${Date.now()}`;
			this.sig = `mock_sig_${Date.now()}`;
			return this.sig;
		});

		// Set up deps AFTER mocks/spies are configured
		deps = {
			currentUser: currentUser,
			ndkInstance: mockNdkInstance as NDK,
		};
	});

	afterEach(() => {
		// Restore spies explicitly
        if (signSpy) {
            signSpy.mockRestore();
        }
        // Mocks themselves are cleared/reset in beforeEach now
	});

	// Tests use the outer scope mockGetEventById and mockAddOrUpdateEvent
	describe('addItemToList', () => {
		const listEventId = baseList.id;
		const newItem = { type: 'p' as 'p'|'e', value: 'pubkey2' };
		const itemToAddTag = [newItem.type, newItem.value];

		it('should add a new item to an existing list', async () => {
			const result = await addItemToList(listEventId, newItem, deps);
			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
			expect(result.newEventId).toBeDefined();
			expect(mockGetEventById).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(mockAddOrUpdateEvent).toHaveBeenCalledOnce();
			const savedEvent = mockAddOrUpdateEvent.mock.calls[0][0] as StoredEvent;
			expect(savedEvent.tags).toContainEqual(itemToAddTag);
			expect(savedEvent.tags.length).toBe(baseList.tags.length + 1);
			expect(savedEvent.pubkey).toBe(currentUser.pubkey);
			expect(savedEvent.created_at).toBeGreaterThan(baseList.created_at);
			expect(savedEvent.published).toBe(false);
		});

		it('should update an existing item in a list (by replacing - check idempotency)', async () => {
			mockGetEventById.mockResolvedValueOnce(baseList);
			const existingItem = { type: 'p' as 'p'|'e', value: 'pubkey1' };
			const resultIdempotent = await addItemToList(listEventId, existingItem, deps);

			expect(resultIdempotent.success).toBe(true);
			expect(resultIdempotent.error).toBeUndefined();
			expect(mockGetEventById).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(mockAddOrUpdateEvent).toHaveBeenCalledOnce();
			const updatedEvent = mockAddOrUpdateEvent.mock.calls[0][0] as StoredEvent;
			expect(updatedEvent.tags).toContainEqual(['p', 'pubkey1']);
			expect(updatedEvent.tags.length).toBe(baseList.tags.length);
		});

		it('should return error if list event not found locally', async () => {
			mockGetEventById.mockResolvedValueOnce(undefined);
			const result = await addItemToList(listEventId, newItem, deps);
			expect(result.success).toBe(false);
			expect(result.error).toContain(`List event with ID ${listEventId} not found locally`);
			expect(mockGetEventById).toHaveBeenCalledWith(listEventId);
			expect(signSpy).not.toHaveBeenCalled();
			expect(mockAddOrUpdateEvent).not.toHaveBeenCalled();
		});

		it('should return error if currentUser is not available', async () => {
			const depsWithoutUser: ListServiceDependencies = { ...deps, currentUser: null };
			const result = await addItemToList(listEventId, newItem, depsWithoutUser);
			expect(result.success).toBe(false);
			expect(result.error).toBe('User not logged in');
		});

		it('should return error if NDK instance is not available', async () => {
			const depsWithoutNdk: ListServiceDependencies = { ...deps, ndkInstance: null };
			const result = await addItemToList(listEventId, newItem, depsWithoutNdk);
			expect(result.success).toBe(false);
			expect(result.error).toBe('NDK not initialized');
		});

		it('should return error if signer is not available', async () => {
			const ndkWithoutSigner = { ...mockNdkInstance, signer: undefined } as Partial<NDK>;
			const depsWithoutSigner: ListServiceDependencies = { ...deps, ndkInstance: ndkWithoutSigner as NDK };
			const result = await addItemToList(listEventId, newItem, depsWithoutSigner);
			expect(result.success).toBe(false);
			expect(result.error).toBe('Nostr signer not available (NIP-07?)');
		});

		it('should return error if event pubkey does not match currentUser.pubkey', async () => {
			mockGetEventById.mockResolvedValueOnce(otherUsersList);
			const result = await addItemToList(listEventId, newItem, deps);
			expect(result.success).toBe(false);
			expect(result.error).toBe('Cannot modify an event belonging to another user.');
			expect(mockGetEventById).toHaveBeenCalledWith(listEventId);
			expect(signSpy).not.toHaveBeenCalled();
			expect(mockAddOrUpdateEvent).not.toHaveBeenCalled();
		});

		it('should return error if signing fails', async () => {
			mockGetEventById.mockResolvedValueOnce(baseList);
			const signError = new Error('Signature failed');
			signSpy.mockRejectedValueOnce(signError);
			const result = await addItemToList(listEventId, newItem, deps);
			expect(result.success).toBe(false);
			expect(result.error).toContain(signError.message);
			expect(mockGetEventById).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(mockAddOrUpdateEvent).not.toHaveBeenCalled();
		});

		it('should return error if addOrUpdateEvent fails', async () => {
			const dbError = new Error('Database write failed');
			mockGetEventById.mockResolvedValueOnce(baseList);
			mockAddOrUpdateEvent.mockRejectedValueOnce(dbError);
			const result = await addItemToList(listEventId, newItem, deps);
			expect(result.success).toBe(false);
			expect(result.error).toContain(dbError.message);
			expect(mockGetEventById).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(mockAddOrUpdateEvent).toHaveBeenCalledOnce();
		});
	});

	describe('removeItemFromList', () => {
		const listEventId = baseList.id;
		const itemToRemove = { type: 'p' as 'p'|'e', value: 'pubkey1' };
		const itemToRemoveTag = [itemToRemove.type, itemToRemove.value];

		it('should remove an existing item from a list', async () => {
			const result = await removeItemFromList(listEventId, itemToRemove, deps);
			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
			expect(result.newEventId).toBeDefined();
			expect(mockGetEventById).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(mockAddOrUpdateEvent).toHaveBeenCalledOnce();
			const savedEvent = mockAddOrUpdateEvent.mock.calls[0][0] as StoredEvent;
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
			mockGetEventById.mockResolvedValueOnce(baseList);
			const result = await removeItemFromList(listEventId, nonExistentItem, deps);
			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
			expect(result.newEventId).toBeDefined();
			expect(mockGetEventById).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(mockAddOrUpdateEvent).toHaveBeenCalledOnce();
		});

		it('should return error if list event not found locally', async () => {
			mockGetEventById.mockResolvedValueOnce(undefined);
			const result = await removeItemFromList(listEventId, itemToRemove, deps);
			expect(result.success).toBe(false);
			expect(result.error).toContain(`List event with ID ${listEventId} not found locally`);
			expect(mockGetEventById).toHaveBeenCalledWith(listEventId);
			expect(signSpy).not.toHaveBeenCalled();
			expect(mockAddOrUpdateEvent).not.toHaveBeenCalled();
		});

		it('should return error if currentUser is not available', async () => {
			const depsWithoutUser: ListServiceDependencies = { ...deps, currentUser: null };
			const result = await removeItemFromList(listEventId, itemToRemove, depsWithoutUser);
			expect(result.success).toBe(false);
			expect(result.error).toBe('User not logged in');
		});

		it('should return error if NDK instance is not available', async () => {
			const depsWithoutNdk: ListServiceDependencies = { ...deps, ndkInstance: null };
			const result = await removeItemFromList(listEventId, itemToRemove, depsWithoutNdk);
			expect(result.success).toBe(false);
			expect(result.error).toBe('NDK not initialized');
		});

		it('should return error if signer is not available', async () => {
			const ndkWithoutSigner = { ...mockNdkInstance, signer: undefined } as Partial<NDK>;
			const depsWithoutSigner: ListServiceDependencies = { ...deps, ndkInstance: ndkWithoutSigner as NDK };
			const result = await removeItemFromList(listEventId, itemToRemove, depsWithoutSigner);
			expect(result.success).toBe(false);
			expect(result.error).toBe('Nostr signer not available (NIP-07?)');
		});

		it('should return error if event pubkey does not match currentUser.pubkey', async () => {
			mockGetEventById.mockResolvedValueOnce(otherUsersList);
			const result = await removeItemFromList(listEventId, itemToRemove, deps);
			expect(result.success).toBe(false);
			expect(result.error).toBe('Cannot modify an event belonging to another user.');
			expect(mockGetEventById).toHaveBeenCalledWith(listEventId);
			expect(signSpy).not.toHaveBeenCalled();
			expect(mockAddOrUpdateEvent).not.toHaveBeenCalled();
		});

		it('should return error if signing fails', async () => {
			mockGetEventById.mockResolvedValueOnce(baseList);
			const signError = new Error('Signature failed');
			signSpy.mockRejectedValueOnce(signError);
			const result = await removeItemFromList(listEventId, itemToRemove, deps);
			expect(result.success).toBe(false);
			expect(result.error).toContain(signError.message);
			expect(mockGetEventById).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(mockAddOrUpdateEvent).not.toHaveBeenCalled();
		});

		it('should return error if addOrUpdateEvent fails', async () => {
			const dbError = new Error('Database write failed');
			mockGetEventById.mockResolvedValueOnce(baseList);
			mockAddOrUpdateEvent.mockRejectedValueOnce(dbError);
			const result = await removeItemFromList(listEventId, itemToRemove, deps);
			expect(result.success).toBe(false);
			expect(result.error).toContain(dbError.message);
			expect(mockGetEventById).toHaveBeenCalledWith(listEventId);
			expect(signSpy).toHaveBeenCalledOnce();
			expect(mockAddOrUpdateEvent).toHaveBeenCalledOnce();
		});
	});
});
