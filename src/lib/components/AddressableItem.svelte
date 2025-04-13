<script lang="ts">
    import { onMount, createEventDispatcher } from 'svelte';
    import { localDb, type StoredEvent } from '$lib/localDb';
    import { nip19 } from 'nostr-tools';
    import { NDKKind, NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk'; // Added NDKEvent, NDKFilter
    import { ndkService } from '$lib/ndkService'; // Added ndkService import

    // Accepts the full 'a' tag coordinate string (e.g., "30023:pubkey:dTag")
    export let coordinate: string;
    export let isOnline: boolean; // <-- Add isOnline prop

    let itemData: { name: string; kind: number; dTag?: string; pubkey: string } | null = null;
    let isLoading = true;
    let error: string | null = null;
    let itemTypeLabel = "Resource"; // Default label

    const dispatch = createEventDispatcher(); // Initialize dispatcher

    function handleItemClick() {
        if (!error) {
            dispatch('viewresource', { coordinate: coordinate });
        }
    }

    onMount(async () => {
        isLoading = true;
        error = null;
        itemData = null;
        itemTypeLabel = "Resource"; // Reset

        const parts = coordinate.split(':');
        if (parts.length < 3) {
            error = "Invalid address coordinate format.";
            isLoading = false;
            return;
        }

        const kind = parseInt(parts[0], 10);
        const pubkey = parts[1];
        const dTag = parts[2]; // dTag is mandatory for NIP-33 addressable events

        if (isNaN(kind) || !pubkey || !/^[a-f0-9]{64}$/i.test(pubkey) || !dTag) {
            error = "Invalid kind, pubkey, or dTag in coordinate.";
            isLoading = false;
            return;
        }

        console.log(`AddressableItem: Fetching details for coordinate: ${coordinate}`);

        try {
            // Check local DB first
            const localEvent = await localDb.getLatestEventByCoord(kind, pubkey, dTag);
            if (localEvent) {
                console.log(`AddressableItem: Found data locally for ${coordinate}`);
                const name = localEvent.tags.find(t => t[0] === 'title')?.[1]
                               || localEvent.tags.find(t => t[0] === 'd')?.[1]
                               || `Kind ${localEvent.kind} Item`;
                itemData = { name: name, kind: localEvent.kind, dTag: dTag, pubkey: localEvent.pubkey };

                // Set Label based on Kind (copied logic for DRY)
                if (localEvent.kind === NDKKind.Article) { itemTypeLabel = "Article"; }
                else if (localEvent.kind === NDKKind.CategorizedPeopleList || localEvent.kind === NDKKind.CategorizedBookmarkList) { itemTypeLabel = "List"; }
                else if (localEvent.kind === NDKKind.Highlight) { itemTypeLabel = "Highlight"; }
                // ... add more kinds if needed ...
                else { itemTypeLabel = "Resource"; }

            } else {
                // --- START: Network Fetch Fallback ---
                console.warn(`AddressableItem: Event not found locally for ${coordinate}. Attempting network fetch...`);
                if (isOnline) {
                    const filter: NDKFilter = { kinds: [kind], authors: [pubkey], "#d": [dTag], limit: 1 };
                    const fetchedEvent: NDKEvent | null = await ndkService.fetchEvent(filter);

                    if (fetchedEvent) {
                        console.log(`AddressableItem: Fetched event from network for ${coordinate}`);
                        const name = fetchedEvent.tags.find(t => t[0] === 'title')?.[1]
                                       || fetchedEvent.tags.find(t => t[0] === 'd')?.[1]
                                       || `Kind ${fetchedEvent.kind} Item`;
                        itemData = { name: name, kind: fetchedEvent.kind, dTag: dTag, pubkey: fetchedEvent.pubkey };

                        // Set Label based on Kind (copied logic for DRY)
                        if (fetchedEvent.kind === NDKKind.Article) { itemTypeLabel = "Article"; }
                        else if (fetchedEvent.kind === NDKKind.CategorizedPeopleList || fetchedEvent.kind === NDKKind.CategorizedBookmarkList) { itemTypeLabel = "List"; }
                        else if (fetchedEvent.kind === NDKKind.Highlight) { itemTypeLabel = "Highlight"; }
                        // ... add more kinds if needed ...
                        else { itemTypeLabel = "Resource"; }

                        // Save fetched event to local DB
                        const storedEventData: StoredEvent = {
                            id: fetchedEvent.id,
                            kind: fetchedEvent.kind,
                            pubkey: fetchedEvent.pubkey,
                            created_at: fetchedEvent.created_at ?? 0,
                            tags: fetchedEvent.tags,
                            content: fetchedEvent.content,
                            sig: fetchedEvent.sig ?? '',
                            dTag: dTag, // Add dTag explicitly
                            published: true // Assume fetched events are published
                        };
                        // Use regular add/update which handles replaceable logic internally
                        await localDb.addOrUpdateEvent(storedEventData);
                        console.log(`AddressableItem: Saved fetched event ${fetchedEvent.id} to local DB.`);
                    } else {
                        error = "Item data not found locally or on network.";
                        console.warn(`AddressableItem: Event not found on network for coordinate ${coordinate}`);
                    }
                } else {
                    error = "Item data not found locally (App is offline).";
                    console.warn(`AddressableItem: Cannot fetch network data for ${coordinate}, app is offline.`);
                }
                // --- END: Network Fetch Fallback ---
            }
        } catch (e: any) {
            error = `Error fetching item data: ${e.message}`;
             console.error(`AddressableItem: Error fetching data for ${coordinate}`, e);
        } finally {
            isLoading = false;
        }
    });
</script>

<div
    class="py-1 pl-2 border-l-2 border-neutral ml-1 w-full {error ? '' : 'cursor-pointer hover:bg-base-200'}"
    on:click={handleItemClick}
>
    {#if isLoading}
        <span class="loading loading-spinner loading-xs"></span>
        <span class="text-xs italic text-base-content/50 ml-1">Loading item link...</span>
    {:else if itemData}
        <div class="flex items-center space-x-2">
             <span class="tooltip tooltip-right" data-tip={`${itemTypeLabel} (Kind ${itemData.kind})`}>
                {#if itemTypeLabel === 'List'}
                    <span class="text-lg">🔗</span>
                {:else if itemTypeLabel === 'Article'}
                    <span class="text-lg">📰</span>
                {:else if itemTypeLabel === 'Highlight'}
                    <span class="text-lg">✨</span>
                {:else}
                    <span class="text-lg">📎</span>
                {/if}
             </span>
             <span class="text-sm font-medium truncate" title="{itemData.name} ({itemTypeLabel} Kind: {itemData.kind})">
                 {itemData.name}
             </span>
             <code class="text-xs text-base-content/60 tooltip tooltip-bottom" data-tip={`Coordinate: ${coordinate}`}>{itemData.dTag}</code>
         </div>
    {:else}
        <div class="flex items-center space-x-2 text-error text-xs">
            <span class="tooltip tooltip-right" data-tip={error || 'Item link could not be loaded'}>
                <span class="text-lg">⚠️</span> Error loading item
            </span>
            <code class="font-mono break-all" title={coordinate}>({coordinate || 'invalid coordinate'})</code>
        </div>
    {/if}
</div> 