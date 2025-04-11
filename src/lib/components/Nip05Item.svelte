<script lang="ts">
    import { onMount } from 'svelte';
    import { ndkService } from '$lib/ndkService';
    import { localDb, type StoredEvent } from '$lib/localDb';
    import type { NDKUserProfile, NDKEvent } from '@nostr-dev-kit/ndk';

    /**
     * The NIP-05 identifier (user@domain.com).
     */
    export let identifier: string;
    /**
     * The resolved public key (hex) associated with the NIP-05 identifier.
     */
    export let pubkey: string;

    let profile: NDKUserProfile | null = null;
    let isLoading: boolean = true;

    // Use identifier for fallback display if profile not found
    $: fallbackDisplay = identifier || 'N/A';

    // Shortened pubkey for title attribute if available
    $: shortPubkey = pubkey ? `${pubkey.substring(0, 8)}...${pubkey.substring(pubkey.length - 4)}` : 'N/A';

    onMount(async () => {
        isLoading = true;
        profile = null; // Reset profile on mount/pubkey change

        if (!pubkey) {
            console.error(`Nip05Item (${identifier}): No pubkey provided for identifier.`);
            isLoading = false;
            return;
        }

        console.log(`Nip05Item (${identifier} -> ${pubkey.substring(0, 6)}): Checking local DB...`);
        try {
            // 1. Try Local First
            const localProfileData = await localDb.getProfile(pubkey);

            if (localProfileData?.profile) {
                console.log(`Nip05Item (${identifier}): Found profile in local DB.`);
                profile = localProfileData.profile as NDKUserProfile;
                isLoading = false;
                return; // Found locally
            }

            // 2. Not Found Locally - Try Network
            console.log(`Nip05Item (${identifier}): Not found locally. Fetching from network...`);
            try {
                const filter = { kinds: [0], authors: [pubkey], limit: 1 };
                const fetchedEvent: NDKEvent | null = await ndkService.fetchEvent(filter);

                if (fetchedEvent) {
                    console.log(`Nip05Item (${identifier}): Fetched profile event from network.`);
                    // 3. Save Fetched Event to DB
                     const storedEventData: StoredEvent = {
                        id: fetchedEvent.id,
                        kind: fetchedEvent.kind,
                        pubkey: fetchedEvent.pubkey,
                        created_at: fetchedEvent.created_at ?? 0,
                        tags: fetchedEvent.tags,
                        content: fetchedEvent.content,
                        sig: fetchedEvent.sig ?? '',
                    };
                    await localDb.addOrUpdateProfile(storedEventData);
                    console.log(`Nip05Item (${identifier}): Saved fetched event to local DB.`);

                    // 4. Re-read from DB
                    const finalProfileData = await localDb.getProfile(pubkey);
                    if (finalProfileData?.profile) {
                         profile = finalProfileData.profile as NDKUserProfile;
                         console.log(`Nip05Item (${identifier}): Set profile state from re-read DB.`);
                    } else {
                         console.warn(`Nip05Item (${identifier}): Profile not found in DB even after saving.`);
                         profile = null;
                    }
                } else {
                    console.log(`Nip05Item (${identifier}): No profile event found on network.`);
                    profile = null;
                }
            } catch (networkError) {
                console.error(`Nip05Item (${identifier}): Failed during network fetch or DB save:`, networkError);
                profile = null;
            } finally {
                 isLoading = false;
            }
        } catch (error) {
            console.error(`Nip05Item (${identifier}): Error during initial local DB check:`, error);
            isLoading = false;
        }
    });
</script>

<div class="py-1 flex items-center space-x-2" title={`NIP-05: ${identifier}\nPubkey: ${pubkey || 'N/A'}`}>
    {#if isLoading}
        <span class="loading loading-spinner loading-xs"></span>
        <span class="text-xs italic text-base-content/50">Loading NIP-05...</span>
    {:else if profile}
        <!-- Profile Found: Display avatar and name/displayName -->
        <div class="avatar">
            <div class="w-6 h-6 rounded-full ring-accent ring-offset-base-100 ring-offset-1"> <!-- Use accent color for NIP-05 -->
                {#if profile.image}
                    <img src={profile.image} alt={profile.displayName || profile.name || identifier} />
                {:else}
                    <div class="flex items-center justify-center w-full h-full bg-neutral text-neutral-content text-xs">
                        {(profile.displayName || profile.name || identifier).charAt(0).toUpperCase()}
                    </div>
                {/if}
            </div>
        </div>
        <span class="text-sm font-medium truncate">
            {profile.displayName || profile.name || identifier} <!-- Display identifier if name missing -->
        </span>
         <!-- Optionally add a NIP-05 verified checkmark icon here later -->
    {:else}
        <!-- Fallback: NIP-05 Icon & Identifier -->
         <div class="avatar placeholder">
            <div class="bg-accent text-accent-content rounded-full w-6 h-6 ring ring-accent ring-offset-base-100 ring-offset-1"> <!-- Use accent color -->
                <span class="text-xs">@</span> <!-- Represent NIP-05 with '@' -->
            </div>
        </div>
        <span class="text-sm text-base-content/70 truncate">{identifier}</span>
    {/if}
</div> 