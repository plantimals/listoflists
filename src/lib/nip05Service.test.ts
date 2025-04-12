import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip05 } from 'nostr-tools';
import { verifyNip05 } from '$lib/nip05Service';
import type { Nip05VerificationStateType } from '$lib/types';

// Mock the nostr-tools nip05 module
vi.mock('nostr-tools', async (importOriginal) => {
    const actual = await importOriginal() as typeof import('nostr-tools');
    return {
        ...actual, // Preserve other exports
        nip05: {
            ...actual.nip05,
            queryProfile: vi.fn(), // Mock queryProfile
        }
    };
});

// Cast the mocked function for type safety in tests
// Use 'any' to bypass potential Vitest global type issues
const mockedQueryProfile = nip05.queryProfile as any;

describe('nip05Service - verifyNip05', () => {

    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();
    });

    it('should return status: match when resolved pubkey matches cached pubkey', async () => {
        const identifier = 'test@example.com';
        const cachedNpub = 'abc';
        const expectedState: Nip05VerificationStateType = { status: 'match', newlyResolvedNpub: null, errorMsg: null };

        mockedQueryProfile.mockResolvedValue({ pubkey: 'abc', relays: [] });

        const result = await verifyNip05(identifier, cachedNpub);

        expect(result).toEqual(expectedState);
        expect(mockedQueryProfile).toHaveBeenCalledWith(identifier);
        expect(mockedQueryProfile).toHaveBeenCalledTimes(1);
    });

    it('should return status: mismatch when resolved pubkey does not match cached pubkey', async () => {
        const identifier = 'test@example.com';
        const cachedNpub = 'abc';
        const resolvedNpub = 'def'
        const expectedState: Nip05VerificationStateType = { status: 'mismatch', newlyResolvedNpub: resolvedNpub, errorMsg: null };

        mockedQueryProfile.mockResolvedValue({ pubkey: resolvedNpub, relays: [] });

        const result = await verifyNip05(identifier, cachedNpub);

        expect(result).toEqual(expectedState);
        expect(mockedQueryProfile).toHaveBeenCalledWith(identifier);
    });

    it('should return status: failed when queryProfile resolves to null', async () => {
        const identifier = 'notfound@example.com';
        const cachedNpub = 'xyz';
        const expectedState: Nip05VerificationStateType = { status: 'failed', newlyResolvedNpub: null, errorMsg: "NIP-05 resolution failed or profile has no pubkey." };

        mockedQueryProfile.mockResolvedValue(null);

        const result = await verifyNip05(identifier, cachedNpub);

        expect(result).toEqual(expectedState);
        expect(mockedQueryProfile).toHaveBeenCalledWith(identifier);
    });

    it('should return status: failed when queryProfile resolves to a profile without a pubkey', async () => {
        const identifier = 'nopubkey@example.com';
        const cachedNpub = 'xyz';
        const expectedState: Nip05VerificationStateType = { status: 'failed', newlyResolvedNpub: null, errorMsg: "NIP-05 resolution failed or profile has no pubkey." };

        // Mocking a profile object without a pubkey field
        mockedQueryProfile.mockResolvedValue({ relays: [] } as any);

        const result = await verifyNip05(identifier, cachedNpub);

        expect(result).toEqual(expectedState);
        expect(mockedQueryProfile).toHaveBeenCalledWith(identifier);
    });

    it('should return status: failed and error message when queryProfile throws an error', async () => {
        const identifier = 'error@example.com';
        const cachedNpub = '123';
        const errorMessage = 'Network Error';
        const expectedState: Nip05VerificationStateType = { status: 'failed', newlyResolvedNpub: null, errorMsg: errorMessage };

        mockedQueryProfile.mockRejectedValue(new Error(errorMessage));

        const result = await verifyNip05(identifier, cachedNpub);

        expect(result).toEqual(expectedState);
        expect(mockedQueryProfile).toHaveBeenCalledWith(identifier);
    });

    it('should handle null cachedNpub correctly (treat as mismatch if resolved)', async () => {
        const identifier = 'new@example.com';
        const cachedNpub = null;
        const resolvedNpub = 'newpubkey'
        const expectedState: Nip05VerificationStateType = { status: 'mismatch', newlyResolvedNpub: resolvedNpub, errorMsg: null };

        mockedQueryProfile.mockResolvedValue({ pubkey: resolvedNpub, relays: [] });

        const result = await verifyNip05(identifier, cachedNpub);

        expect(result).toEqual(expectedState);
        expect(mockedQueryProfile).toHaveBeenCalledWith(identifier);
    });

}); 