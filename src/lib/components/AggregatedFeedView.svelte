<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { aggregateContentItems } from '$lib/hierarchyService';
	import { localDb, type StoredEvent, isReplaceableKind } from '$lib/localDb';
	import { listHierarchy } from '$lib/hierarchyStore'; // Corrected path
	import { isOnline } from '$lib/networkStatusStore'; // Corrected path
	import type { TreeNodeData } from '$lib/types';
	import UserItem from '$lib/components/UserItem.svelte';
	import { NDKKind } from '@nostr-dev-kit/ndk'; // For kind constants

	export let listNodeId: string;
	export let listName: string;

	let isLoadingFeed = true;
	let feedError: string | null = null;
	let feedItems: Array<{
		id: string; // Event ID for 'e', Coordinate for 'a'
		type: 'e' | 'a';
		value: string; // Event ID for 'e', Coordinate for 'a'
		created_at: number;
		pubkey?: string;
		content?: string; // For notes ('e')
		name?: string; // For articles/resources ('a')
		kind?: number;
		dTag?: string; // For articles/resources ('a')
	}> = [];

	onMount(async () => {
		console.log(`AggregatedFeedView: Mounting for list ID: ${listNodeId}, Name: ${listName}`);
		isLoadingFeed = true;
		feedError = null;
		feedItems = [];
		// Use get() for initial hierarchy value, handle potential undefined
		const initialHierarchy = get(listHierarchy) ?? [];

		// Find the starting node in the current hierarchy
		// Accept undefined for nodes parameter
		function findNodeById(nodes: TreeNodeData[] | undefined, id: string): TreeNodeData | null {
			if (!nodes) return null; // Handle undefined case
			for (const node of nodes) {
				if (node.id === id) return node;
				if (node.children?.length > 0) {
					// Check children exist
					const foundInChildren = findNodeById(node.children, id);
					if (foundInChildren) return foundInChildren;
				}
			}
			return null;
		}

		// Pass initialHierarchy directly (without cast)
		const startNode = findNodeById(initialHierarchy, listNodeId);

		if (!startNode) {
			feedError = 'Could not find the starting list node in the current hierarchy.';
			isLoadingFeed = false;
			return;
		}

		try {
			const collectedItemIdentifiers = new Set<string>();
			const visitedNodes = new Set<string>();
			console.log('AggregatedFeedView: Starting content item aggregation...');
			// Pass the confirmed startNode
			await aggregateContentItems(startNode, collectedItemIdentifiers, visitedNodes);
			console.log(`AggregatedFeedView: Found ${collectedItemIdentifiers.size} unique item identifiers.`);

			if (collectedItemIdentifiers.size === 0) {
				isLoadingFeed = false;
				return; // Nothing to fetch
			}

			// Fetch details for each identifier
			const itemPromises = Array.from(collectedItemIdentifiers).map(async (identifier) => {
				try {
					if (/^\d+:[a-f0-9]{64}:.+$/.test(identifier)) {
						// 'a' tag coordinate
						const parts = identifier.split(':');
						const kind = parseInt(parts[0], 10);
						const pubkey = parts[1];
						const dTag = parts[2];
						const eventData = await localDb.getLatestEventByCoord(kind, pubkey, dTag);
						if (eventData) {
							const name =
								eventData.tags.find((t) => t[0] === 'title')?.[1] ||
								dTag ||
								`Kind ${kind} Item`;
							return {
								id: eventData.id,
								type: 'a',
								value: identifier,
								created_at: eventData.created_at,
								pubkey: eventData.pubkey,
								kind: eventData.kind,
								name: name,
								dTag: dTag
							};
						}
					} else if (/^[a-f0-9]{64}$/.test(identifier)) {
						// 'e' tag event ID
						const eventData = await localDb.getEventById(identifier);
						if (eventData) {
							if (!isReplaceableKind(eventData.kind)) {
								return {
									id: eventData.id,
									type: 'e',
									value: identifier,
									created_at: eventData.created_at,
									pubkey: eventData.pubkey,
									content: eventData.content,
									kind: eventData.kind
								};
							} else {
								console.warn(
									`AggregateFeedView: Skipping replaceable kind ${eventData.kind} event ${identifier}`
								);
							}
						}
					} else {
						console.warn(`AggregateFeedView: Skipping invalid identifier format: ${identifier}`);
					}
				} catch (fetchErr: any) {
					console.error(`AggregateFeedView: Error fetching details for item ${identifier}:`, fetchErr);
				}
				return null;
			});

			const fetchedItems = (await Promise.all(itemPromises)).filter((item) => item !== null);

			// Sort by created_at descending
			fetchedItems.sort((a, b) => (b?.created_at ?? 0) - (a?.created_at ?? 0));

			feedItems = fetchedItems as Array<typeof feedItems[number]>; // Assert correct type
			console.log(`AggregatedFeedView: Prepared ${feedItems.length} items for display.`);
		} catch (aggErr: any) {
			console.error('AggregatedFeedView: Error during item aggregation:', aggErr);
			feedError = `Failed to aggregate items: ${aggErr.message}`;
		} finally {
			isLoadingFeed = false;
		}
	}); // End onMount
</script>

<div class="p-4 space-y-4">
    <h2 class="text-xl font-semibold">Aggregated Feed: {listName}</h2>
    {#if isLoadingFeed}
        <div class="flex items-center justify-center space-x-2 py-10">
            <span class="loading loading-spinner text-primary"></span>
            <span>Loading feed items...</span>
        </div>
    {:else if feedError}
        <div class="alert alert-error">
            <span>Error loading feed: {feedError}</span>
        </div>
    {:else if feedItems.length > 0}
         <div class="space-y-4">
               {#each feedItems as item (item.id || item.value)}
                  <div class="card card-compact card-bordered bg-base-100/50">
                    <div class="card-body">
                      {#if item.type === 'e'}
                        <p class="text-sm text-base-content/90 break-words whitespace-pre-wrap">{item.content || '(Empty note)'}</p>
                      {:else if item.type === 'a'}
                        <div class="flex items-center space-x-2">
                           <span title={`Type: Resource (Kind ${item.kind})`}>
                               {#if item.kind === NDKKind.Article}📰{:else}📄{/if} </span>
                           <span class="font-semibold">{item.name || 'Unnamed Resource'}</span>
                           <code class="text-xs text-base-content/60" title="Identifier: {item.dTag}">({item.dTag})</code>
                           </div>
                      {/if}
                      {#if item.pubkey && item.created_at}
                          <div class="text-xs text-base-content/60 mt-2 pt-1 border-t border-base-300/30 flex items-center space-x-1">
                             <span>By: <UserItem pubkey={item.pubkey} /></span>
                             <span>| {new Date(item.created_at * 1000).toLocaleString()}</span>
                             <code class="text-xs" title={item.id}>({item.id.substring(0,6)}...)</code>
                          </div>
                      {/if}
                    </div>
                  </div>
               {/each}
           </div>
    {:else}
         <p class="italic text-base-content/70">No content items found in this list or its sub-lists.</p>
    {/if}
</div> 