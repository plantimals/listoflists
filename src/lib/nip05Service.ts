import { nip05 } from 'nostr-tools';
import type { Nip05VerificationStateType } from '$lib/types';

/**
 * Verifies a NIP-05 identifier against its expected pubkey.
 * 
 * @param identifier The NIP-05 identifier (e.g., user@domain.com).
 * @param cachedNpub The currently known/cached npub associated with the identifier.
 * @returns A promise resolving to the verification state object.
 */
export async function verifyNip05(identifier: string, cachedNpub: string | null): Promise<Nip05VerificationStateType> {
    console.log(`nip05Service: Verifying ${identifier} against cached ${cachedNpub ? cachedNpub.substring(0,6) : 'none'}`);
    try {
        const resolvedProfile = await nip05.queryProfile(identifier);

        if (resolvedProfile?.pubkey) {
            if (resolvedProfile.pubkey === cachedNpub) {
                console.log(`nip05Service: Match for ${identifier}`);
                return { status: 'match', newlyResolvedNpub: null, errorMsg: null };
            } else {
                console.log(`nip05Service: Mismatch for ${identifier}. Resolved: ${resolvedProfile.pubkey.substring(0,6)}, Cached: ${cachedNpub ? cachedNpub.substring(0,6) : 'none'}`);
                return { status: 'mismatch', newlyResolvedNpub: resolvedProfile.pubkey, errorMsg: null };
            }
        } else {
            console.warn(`nip05Service: Resolution failed for ${identifier} (null or no pubkey)`);
            return { status: 'failed', newlyResolvedNpub: null, errorMsg: "NIP-05 resolution failed or profile has no pubkey." };
        }
    } catch (error: any) {
        console.error(`nip05Service: Error during resolution for ${identifier}:`, error);
        return { status: 'failed', newlyResolvedNpub: null, errorMsg: error.message || "An unexpected error occurred during NIP-05 resolution." };
    }
} 