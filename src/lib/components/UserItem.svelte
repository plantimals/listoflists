<script lang="ts">
    import { onMount, createEventDispatcher } from 'svelte';
    // import { get } from 'svelte/store'; // Removed
    // import { ndk } from '$lib/ndkStore'; // Removed
    import { ndkService } from '$lib/ndkService'; // Added
    import { localDb, type StoredEvent } from '$lib/localDb';
    import type { NDKUserProfile, NDKEvent } from '@nostr-dev-kit/ndk';
    import { nip19 } from 'nostr-tools'; // Import nip19

    /**
     * The public key (hex) of the user to display.
     */
    export let pubkey: string;

    let profile: NDKUserProfile | null = null;
    let isLoading: boolean = true;

    const dispatch = createEventDispatcher(); // Create dispatcher instance

    // Shortened pubkey for display if profile not found
    $: shortPubkey = pubkey ? `${pubkey.substring(0, 8)}...${pubkey.substring(pubkey.length - 4)}` : 'invalid pubkey';

    // Convert hex pubkey to npub for event detail
    $: npub = pubkey ? nip19.npubEncode(pubkey) : '';

    function handleClick() {
        if (npub) {
            console.log(`UserItem: Dispatching viewprofile for npub: ${npub}`);
            dispatch('viewprofile', { npub: npub });
        } else {
            console.error('UserItem: Cannot dispatch viewprofile, invalid pubkey/npub.');
        }
    }

    onMount(async () => {
        isLoading = true;
        profile = null; // Reset profile on mount/pubkey change

        if (!pubkey) {
            console.error('UserItem: No pubkey provided.');
            isLoading = false;
            return;
        }

        console.log(`UserItem (${pubkey.substring(0, 6)}): Checking local DB...`);
        try {
            // 1. Try Local First
            const localProfileData = await localDb.getProfile(pubkey);

            if (localProfileData?.profile) {
                console.log(`UserItem (${pubkey.substring(0, 6)}): Found profile in local DB.`);
                profile = localProfileData.profile as NDKUserProfile;
                isLoading = false;
                return; // Found locally, no need to fetch network
            }

            // 2. Not Found Locally - Try Network
            console.log(`UserItem (${pubkey.substring(0, 6)}): Not found locally. Fetching from network...`);
            // const ndkInstance = get(ndk); // Removed
            // if (!ndkInstance) { // Service handles NDK availability
            //    console.error(`UserItem (${pubkey.substring(0, 6)}): NDK instance not available for network fetch.`);
            //    isLoading = false;
            //    return;
            // }

            try {
                // await ndkInstance.connect(); // Removed - Service handles connection
                const filter = { kinds: [0], authors: [pubkey], limit: 1 };
                // Fetch using the service
                const fetchedEvent: NDKEvent | null = await ndkService.fetchEvent(filter);

                if (fetchedEvent) {
                    console.log(`UserItem (${pubkey.substring(0, 6)}): Fetched profile event from network.`);
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
                    await localDb.addOrUpdateProfile(storedEventData); // Use the profile-specific method
                    console.log(`UserItem (${pubkey.substring(0, 6)}): Saved fetched event to local DB.`);

                    // 4. Re-read from DB to get the final state (including parsed profile)
                    const finalProfileData = await localDb.getProfile(pubkey);
                    if (finalProfileData?.profile) {
                         profile = finalProfileData.profile as NDKUserProfile;
                         console.log(`UserItem (${pubkey.substring(0, 6)}): Set profile state from re-read DB.`);
                    } else {
                         console.warn(`UserItem (${pubkey.substring(0, 6)}): Profile not found in DB even after saving. Event content might be invalid.`);
                         profile = null;
                    }

                } else {
                    console.log(`UserItem (${pubkey.substring(0, 6)}): No profile event found on network.`);
                    profile = null; // Ensure profile is null if not found
                }
            } catch (networkError) {
                console.error(`UserItem (${pubkey.substring(0, 6)}): Failed during network fetch or DB save:`, networkError);
                profile = null; // Ensure profile is null on error
            } finally {
                 isLoading = false; // Stop loading indicator after network attempt
            }

        } catch (error) {
            console.error(`UserItem (${pubkey.substring(0, 6)}): Error during initial local DB check:`, error);
            isLoading = false; // Ensure loading stops on initial DB error too
        }
    });
</script>

<div class="py-1 flex items-center space-x-2 cursor-pointer hover:bg-base-200 rounded px-1" on:click={handleClick}>
    {#if isLoading}
        <span class="loading loading-spinner loading-xs"></span>
        <span class="text-xs italic text-base-content/50">Loading profile...</span>
    {:else if profile}
        <!-- Using DaisyUI Avatar -->
        <div class="avatar" title={pubkey}>
            <div class="w-6 h-6 rounded-full ring-primary ring-offset-base-100 ring-offset-1">
                {#if profile.image}
                    <img src={profile.image} alt={profile.displayName || profile.name || 'avatar'} />
                {:else}
                    <!-- Placeholder within the ring -->
                    <div class="flex items-center justify-center w-full h-full bg-neutral text-neutral-content text-xs">
                        {(profile.displayName || profile.name || '?').charAt(0).toUpperCase()}
                    </div>
                {/if}
            </div>
        </div>
        <span class="text-sm font-medium truncate" title={profile.displayName || profile.name || shortPubkey}>
            {profile.displayName || profile.name || shortPubkey}
        </span>
    {:else}
        <!-- Fallback: Placeholder Avatar & Short Pubkey -->
         <div class="avatar placeholder" title={pubkey}>
            <div class="bg-neutral text-neutral-content rounded-full w-6 h-6 ring ring-neutral ring-offset-base-100 ring-offset-1">
                <span class="text-xs">?</span>
            </div>
        </div>
        <span class="text-sm text-base-content/70 font-mono truncate" title={pubkey}>{shortPubkey}</span>
    {/if}
</div> 