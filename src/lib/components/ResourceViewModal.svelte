<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy } from 'svelte';
    import { NDKEvent, NDKKind, type NDKFilter } from '@nostr-dev-kit/ndk';
    import { localDb, type StoredEvent } from '$lib/localDb';
    import { ndkService } from '$lib/ndkService';
    import UserItem from '$lib/components/UserItem.svelte'; // For displaying author
    import MarkdownIt from 'markdown-it'; // ADDED: Import markdown-it

    export let coordinate: string | null = null;
    export let open: boolean = false;
    export let isOnline: boolean = true; // Assume online by default, parent should provide

    let isLoading = false;
    let error: string | null = null;
    let resourceEvent: StoredEvent | NDKEvent | null = null;
    let title = '';
    let content = '';
    let authorPubkey: string | null = null;
    let createdAt: number | undefined = undefined;
    let kind: NDKKind | number | undefined = undefined;

    const dispatch = createEventDispatcher();

    const md = new MarkdownIt(); // ADDED: Instantiate markdown-it

    // Reactive statement to fetch data when coordinate changes
    $: if (coordinate && open) {
        fetchResourceData(coordinate);
    }

    // Reset state when modal closes or coordinate becomes null
    $: if (!open || !coordinate) {
        resetState();
    }

    function resetState() {
        isLoading = false;
        error = null;
        resourceEvent = null;
        title = '';
        content = '';
        authorPubkey = null;
        createdAt = undefined;
        kind = undefined;
    }

    async function fetchResourceData(coord: string) {
        if (!coord) {
            error = "No resource coordinate provided.";
            return;
        }

        resetState();
        isLoading = true;

        try {
            const parts = coord.split(':');
            if (parts.length < 3) {
                throw new Error("Invalid address coordinate format.");
            }

            const parsedKind = parseInt(parts[0], 10);
            const pubkey = parts[1];
            const dTag = parts[2];

            if (isNaN(parsedKind) || !pubkey || !/^[a-f0-9]{64}$/i.test(pubkey) || !dTag) {
                throw new Error("Invalid kind, pubkey, or dTag in coordinate.");
            }

            kind = parsedKind; // Store kind early for display
            authorPubkey = pubkey; // Store pubkey early for UserItem

            console.log(`ResourceViewModal: Fetching details for coordinate: ${coord}`);

            // 1. Check local DB
            let localEvent = await localDb.getLatestEventByCoord(parsedKind, pubkey, dTag);

            if (localEvent) {
                console.log(`ResourceViewModal: Found data locally for ${coord}`);
                resourceEvent = localEvent;
            } else if (isOnline) {
                 // 2. Fetch from network if online and not found locally
                console.warn(`ResourceViewModal: Event not found locally for ${coord}. Attempting network fetch...`);
                const filter: NDKFilter = { kinds: [parsedKind], authors: [pubkey], "#d": [dTag], limit: 1 };
                const fetchedEvent: NDKEvent | null = await ndkService.fetchEvent(filter);

                if (fetchedEvent) {
                    console.log(`ResourceViewModal: Fetched event from network for ${coord}`);
                    resourceEvent = fetchedEvent;
                    // Save to local DB for future use
                    const storedEventData: StoredEvent = {
                        id: fetchedEvent.id,
                        kind: fetchedEvent.kind,
                        pubkey: fetchedEvent.pubkey,
                        created_at: fetchedEvent.created_at ?? 0,
                        tags: fetchedEvent.tags,
                        content: fetchedEvent.content,
                        sig: fetchedEvent.sig ?? '',
                        dTag: dTag,
                        published: true // Assume fetched events are published
                    };
                    // No need to await this, can happen in background
                    localDb.addOrUpdateEvent(storedEventData).catch(err => console.error("Error saving fetched event to DB:", err));
                } else {
                    throw new Error("Resource not found locally or on the network.");
                }
            } else {
                 throw new Error("Resource not found locally (App is offline).");
            }

            // Process the found event (local or fetched)
            if (resourceEvent) {
                 title = resourceEvent.tags?.find(t => t[0] === 'title')?.[1] || dTag; // Fallback to dTag for title
                 content = resourceEvent.content || '';
                 createdAt = resourceEvent.created_at;
                 // AuthorPubkey and Kind already set
            }

        } catch (e: any) {
            console.error(`ResourceViewModal: Error fetching data for ${coord}`, e);
            error = `Error loading resource: ${e.message}`;
            resourceEvent = null; // Ensure no stale data displayed on error
        } finally {
            isLoading = false;
        }
    }

    function closeModal() {
        open = false; // Allow binding to update parent state
        dispatch('close'); // Also dispatch event for explicit handling if needed
    }

</script>

<dialog class="modal modal-bottom sm:modal-middle" class:modal-open={open}>
    <div class="modal-box">
        <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" on:click={closeModal}>✕</button>

        {#if isLoading}
            <div class="flex justify-center items-center h-32">
                <span class="loading loading-lg loading-spinner"></span>
            </div>
        {:else if error}
            <div class="alert alert-error">
                <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2 2m2-2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span>{error}</span>
                 {#if coordinate}<code class="text-xs opacity-70 block mt-1">{coordinate}</code>{/if}
            </div>
        {:else if resourceEvent}
            <!-- Title -->
            <h3 class="font-bold text-xl mb-4 break-words">{title}</h3>

            <!-- Author and Timestamp -->
            <div class="flex flex-wrap justify-between items-center mb-4 text-sm text-base-content/80">
                {#if authorPubkey}
                    <div class="flex-shrink-0 mr-4 mb-2 sm:mb-0">
                         <UserItem pubkey={authorPubkey} />
                    </div>
                {/if}
                 {#if createdAt}
                    <span class="tooltip tooltip-left" data-tip={new Date(createdAt * 1000).toLocaleString()}>
                        {new Date(createdAt * 1000).toLocaleString()}
                    </span>
                 {/if}
            </div>


            <!-- Content -->
             <div class="prose max-w-none bg-base-200 p-4 rounded-md my-4 break-words">
                {#if content}
                    {@html md.render(content || '')} <!-- UPDATED: Render content as markdown -->
                {:else}
                    <p class="italic text-base-content/60">[No content available]</p>
                {/if}
            </div>

            <!-- Metadata Footer -->
            <div class="text-xs text-base-content/60 mt-6 border-t border-base-300 pt-2">
                <p>Kind: {kind ?? 'N/A'}</p>
                {#if coordinate}
                    <p class="truncate" title={coordinate}>Coordinate: {coordinate}</p>
                 {/if}
            </div>

        {:else}
             <div class="alert alert-warning">
                <span>Resource data could not be loaded.</span>
                 {#if coordinate}<code class="text-xs opacity-70 block mt-1">{coordinate}</code>{/if}
            </div>
        {/if}

        <!-- Modal Actions -->
        <div class="modal-action mt-6">
            <button class="btn" on:click={closeModal}>Close</button>
        </div>
    </div>

     <!-- Click outside to close -->
    <form method="dialog" class="modal-backdrop">
        <button on:click={closeModal}>close</button>
    </form>
</dialog> 