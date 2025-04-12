<script lang="ts">
    import { onMount } from 'svelte';
    import { localDb, type StoredEvent } from '$lib/localDb';
    import { nip19 } from 'nostr-tools';
    import type { NDKKind } from '@nostr-dev-kit/ndk'; // For type safety

    export let naddr: string;

    let listData: { name: string; kind: NDKKind | number; dTag?: string } | null = null;
    let isLoading = true;
    let error: string | null = null;
    let coordinate: string | null = null; // Store the parsed coordinate

    // Helper to parse coordinate from naddr (or assume naddr is already coordinate)
    function getCoordFromNaddr(addr: string): string | null {
        try {
            const decoded = nip19.decode(addr);
            if (decoded.type === 'naddr') {
                // Return the canonical coordinate format
                return `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`;
            }
        } catch (e) { /* Ignore decode errors, might already be a coordinate */ }
        // Basic coordinate check as fallback
        if (/^\d+:[a-f0-9]{64}:.+$/.test(addr)) {
             return addr;
        }
        return null;
    }

    onMount(async () => {
        isLoading = true;
        error = null;
        listData = null;
        coordinate = getCoordFromNaddr(naddr);

        if (!coordinate) {
            error = "Invalid list address format.";
            isLoading = false;
            return;
        }

        console.log(`LinkedListItem: Fetching details for coordinate: ${coordinate}`);
        const parts = coordinate.split(':');
        const kind = parseInt(parts[0], 10);
        const pubkey = parts[1];
        const dTag = parts[2];

        // Defensive check for parsing results
        if (isNaN(kind) || !pubkey || !dTag) {
             error = "Failed to parse coordinate from address.";
             console.error(`LinkedListItem: Failed parsing coordinate parts from ${coordinate}`);
             isLoading = false;
             return;
        }

        try {
            const listEvent = await localDb.getLatestEventByCoord(kind, pubkey, dTag);
            if (listEvent) {
                // Prioritize 'title' tag, fallback to 'd' tag, then generic name
                const name = listEvent.tags.find(t => t[0] === 'title')?.[1]
                             || listEvent.tags.find(t => t[0] === 'd')?.[1]
                             || `Kind ${listEvent.kind} List`;
                listData = { name: name, kind: listEvent.kind, dTag: dTag };
                console.log(`LinkedListItem: Found data for ${coordinate}`, listData);
            } else {
                error = "List data not found locally.";
                 console.warn(`LinkedListItem: List event not found locally for coordinate ${coordinate}`);
            }
        } catch (e: any) {
            error = `Error fetching list data: ${e.message}`;
             console.error(`LinkedListItem: Error fetching data for ${coordinate}`, e);
        } finally {
            isLoading = false;
        }
    });
</script>

{#if isLoading}
    <span class="loading loading-spinner loading-xs"></span>
    <span class="text-xs italic text-base-content/50 ml-1">Loading list link...</span>
{:else if listData}
    <div class="flex items-center space-x-2 py-1">
        <span class="text-accent">🔗</span>
        <span class="text-sm font-medium truncate" title="{listData.name} (Kind: {listData.kind})">{listData.name}</span>
        <span class="badge badge-sm badge-outline font-mono">Kind: {listData.kind}</span>
        {#if listData.dTag}
             <code class="text-xs text-base-content/60 font-mono" title="List Identifier (dTag)">({listData.dTag})</code>
        {/if}
    </div>
{:else}
    <div class="flex items-center space-x-2 text-error text-xs py-1">
        <span title={error || 'List link could not be loaded'}>⚠️ Error loading list link</span>
        {#if coordinate}
            <code class="font-mono">({coordinate})</code>
        {:else}
            <code class="font-mono break-all">({naddr})</code>
        {/if}
    </div>
{/if} 