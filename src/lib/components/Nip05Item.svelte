<script lang="ts">
    import { onMount } from 'svelte';
    import { ndkService } from '$lib/ndkService';
    import { localDb, type StoredEvent } from '$lib/localDb';
    import type { NDKUserProfile, NDKEvent } from '@nostr-dev-kit/ndk';
    import { createEventDispatcher } from 'svelte';
    import type { ListItem } from '$lib/types';
    // Assuming a spinner component exists or will be created:
    // import LoadingSpinner from './LoadingSpinner.svelte'; 
    // Temporary placeholder for LoadingSpinner
    import { ExclamationCircle } from 'svelte-hero-icons'; // Example icon

    // --- Props --- 
    export let item: Extract<ListItem, { type: 'nip05' }>; // Ensure correct type for item
    export let listId: string;
    export let isOnline: boolean;
    export let status: 'idle' | 'checking' | 'match' | 'mismatch' | 'failed' = 'idle';
    export let newlyResolvedNpub: string | null = null;
    export let errorMsg: string | null = null;
    // --- End Props ---

    let profile: NDKUserProfile | null = null;
    let isLoading: boolean = true;

    // Use identifier for fallback display if profile not found
    $: fallbackDisplay = item.identifier || 'N/A';

    // Shortened pubkey for title attribute if available
    $: shortPubkey = item.cachedNpub ? `${item.cachedNpub.substring(0, 8)}...${item.cachedNpub.substring(item.cachedNpub.length - 4)}` : 'N/A';

    const dispatch = createEventDispatcher<{
        checknip05: { identifier: string; cachedNpub: string; listId: string };
        updatenip05: { identifier: string; listId: string; newNpub: string };
    }>();

    function handleCheck() {
        if (status === 'checking' || !isOnline) return;
        console.log(`Nip05Item: Dispatching checknip05 for ${item.identifier}`);
        dispatch('checknip05', {
            identifier: item.identifier,
            cachedNpub: item.cachedNpub,
            listId: listId
        });
    }

    function handleUpdate() {
        if (status !== 'mismatch' || !newlyResolvedNpub) return;
        dispatch('updatenip05', {
            identifier: item.identifier,
            listId: listId,
            newNpub: newlyResolvedNpub
        });
    }

    $: buttonDisabled = !isOnline || status === 'checking';
    $: truncatedNpub = newlyResolvedNpub ? `${newlyResolvedNpub.substring(0, 6)}...${newlyResolvedNpub.substring(newlyResolvedNpub.length - 4)}` : '';

    onMount(async () => {
        isLoading = true;
        profile = null; // Reset profile on mount/pubkey change

        if (!item.cachedNpub) {
            console.error(`Nip05Item (${item.identifier}): No pubkey provided for identifier.`);
            isLoading = false;
            return;
        }

        console.log(`Nip05Item (${item.identifier} -> ${item.cachedNpub.substring(0, 6)}): Checking local DB...`);
        try {
            // 1. Try Local First
            const localProfileData = await localDb.getProfile(item.cachedNpub);

            if (localProfileData?.profile) {
                console.log(`Nip05Item (${item.identifier}): Found profile in local DB.`);
                profile = localProfileData.profile as NDKUserProfile;
                isLoading = false;
                return; // Found locally
            }

            // 2. Not Found Locally - Try Network
            console.log(`Nip05Item (${item.identifier}): Not found locally. Fetching from network...`);
            try {
                const filter = { kinds: [0], authors: [item.cachedNpub], limit: 1 };
                const fetchedEvent: NDKEvent | null = await ndkService.fetchEvent(filter);

                if (fetchedEvent) {
                    console.log(`Nip05Item (${item.identifier}): Fetched profile event from network.`);
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
                    console.log(`Nip05Item (${item.identifier}): Saved fetched event to local DB.`);

                    // 4. Re-read from DB
                    const finalProfileData = await localDb.getProfile(item.cachedNpub);
                    if (finalProfileData?.profile) {
                         profile = finalProfileData.profile as NDKUserProfile;
                         console.log(`Nip05Item (${item.identifier}): Set profile state from re-read DB.`);
                    } else {
                         console.warn(`Nip05Item (${item.identifier}): Profile not found in DB even after saving.`);
                         profile = null;
                    }
                } else {
                    console.log(`Nip05Item (${item.identifier}): No profile event found on network.`);
                    profile = null;
                }
            } catch (networkError) {
                console.error(`Nip05Item (${item.identifier}): Failed during network fetch or DB save:`, networkError);
                profile = null;
            } finally {
                 isLoading = false;
            }
        } catch (error) {
            console.error(`Nip05Item (${item.identifier}): Error during initial local DB check:`, error);
            isLoading = false;
        }
    });
</script>

<div class="py-1 flex items-center space-x-2" title={`NIP-05: ${item.identifier}\nPubkey: ${item.cachedNpub || 'N/A'}`}>
    {#if isLoading}
        <span class="loading loading-spinner loading-xs"></span>
        <span class="text-xs italic text-base-content/50">Loading NIP-05...</span>
    {:else if profile}
        <!-- Profile Found: Display avatar and name/displayName -->
        <div class="avatar">
            <div class="w-6 h-6 rounded-full ring-accent ring-offset-base-100 ring-offset-1"> <!-- Use accent color for NIP-05 -->
                {#if profile.image}
                    <img src={profile.image} alt={profile.displayName || profile.name || item.identifier} />
                {:else}
                    <div class="flex items-center justify-center w-full h-full bg-neutral text-neutral-content text-xs">
                        {(profile.displayName || profile.name || item.identifier).charAt(0).toUpperCase()}
                    </div>
                {/if}
            </div>
        </div>
        <span class="text-sm font-medium truncate">
            {profile.displayName || profile.name || item.identifier} <!-- Display identifier if name missing -->
        </span>
         <!-- Optionally add a NIP-05 verified checkmark icon here later -->
    {:else}
        <!-- Fallback: NIP-05 Icon & Identifier -->
         <div class="avatar placeholder">
            <div class="bg-accent text-accent-content rounded-full w-6 h-6 ring ring-accent ring-offset-base-100 ring-offset-1"> <!-- Use accent color -->
                <span class="text-xs">@</span> <!-- Represent NIP-05 with '@' -->
            </div>
        </div>
        <span class="text-sm text-base-content/70 truncate">{item.identifier}</span>
    {/if}
</div>

<div class="flex items-center space-x-2 py-1 w-full">
    <span class="text-lg mr-1">📧</span> <!-- Simple icon -->
    <span class="flex-grow truncate font-mono text-sm" title={item.identifier}>{item.identifier}</span>
    
    <div class="flex-shrink-0 flex items-center space-x-2">
        {#if status === 'checking'}
            <!-- Replace with LoadingSpinner component when available -->
            <span class="text-xs italic">Checking...</span> 
        {:else if status === 'match'}
            <span class="text-success text-xs font-semibold">✅ Match</span>
        {:else if status === 'mismatch'}
            <span class="text-warning text-xs font-semibold" title={`Resolved to: ${newlyResolvedNpub}`}>⚠️ Mismatch ({truncatedNpub})</span>
            <button 
                class="btn btn-xs btn-warning"
                on:click={handleUpdate}
                disabled={!isOnline}
            >
                Update?
            </button>
        {:else if status === 'failed'}
            <span class="text-error text-xs font-semibold" title={errorMsg ?? 'Verification failed'}>❌ Failed</span>
        {/if}

        {#if status === 'idle' || status === 'failed'}
            <button 
                class="btn btn-xs btn-outline" 
                on:click={handleCheck}
                disabled={buttonDisabled}
            >
                Check
            </button>
        {/if}

        {#if status === 'checking'} 
            <button 
                class="btn btn-xs btn-outline" 
                disabled 
            >
                <span class="loading loading-spinner loading-xs"></span>
            </button>
        {/if}
    </div>
</div>

<style>
    /* Add any specific styles if needed */
</style> 