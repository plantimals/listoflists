<script lang="ts">
    // Keep the props definition
    // import type { TreeNodeData } from '$lib/hierarchyService'; // Import path might need adjustment based on project structure
    import type { TreeNodeData, ListItem, Nip05VerificationStateType } from '$lib/types'; // Corrected import and type name
    // Removed UserItem import
    // Removed NoteItem import
    import NodeHeader from '$lib/components/NodeHeader.svelte'; // Use $lib alias for import
    import NodeActions from './NodeActions.svelte'; // Import the new actions component
    import NodeItemsList from '$lib/components/NodeItemsList.svelte'; // Use $lib alias for import
    import { get } from 'svelte/store';
    import { user } from '$lib/userStore';
    import { refreshTrigger } from '$lib/refreshStore';
    // Removed removeItemFromList import
    import * as listService from '$lib/listService'; // Import listService namespace
    // import AddItemModal from './AddItemModal.svelte'; // Import the modal - Removed
    import { createEventDispatcher, onMount, onDestroy } from 'svelte'; // Import dispatcher and lifecycle functions
    import { localDb, type StoredEvent } from '$lib/localDb'; // Re-added for removeListFromParent
    import { ndkService } from '$lib/ndkService'; // Re-added for removeListFromParent
    import { NDKEvent } from '@nostr-dev-kit/ndk'; // Re-added for removeListFromParent
    import { nip19 } from 'nostr-tools'; // Import nip19
    import { isOnline } from '$lib/networkStatusStore'; // <-- Ensure isOnline is imported
    import ItemWrapper from './ItemWrapper.svelte'; // Import ItemWrapper
    import Nip05Item from './Nip05Item.svelte'; // Import Nip05Item

    export let node: TreeNodeData;
    export let depth: number = 0; // Use depth
    export let verificationStates: { [id: string]: Nip05VerificationStateType }; // <-- Use the imported type
    export let currentUserPubkey: string | null = null; // Added prop
    export let showAddLinkButtonForDiscover = false;

    let expanded: boolean = false; // State for expand/collapse
    let isAdding: boolean = false;
    // Removed isRemovingItemId state
    let errorMessage: string | null = null; // Declare errorMessage (keep for handleDeleteList)
    let isDeleting: boolean = false; // Add loading state for delete (keep for handleDeleteList)
    let isEditingName: boolean = false; // For rename state
	let editedName: string = ''; // For rename input
	let inputRef: HTMLInputElement | null = null; // For rename input focus

    // State for external list items
    let isLoadingExternalItems: boolean = false;
    let externalItemsError: string | null = null;
    let externalItems: ListItem[] = [];
    let itemsLoaded: boolean = false; // To prevent re-fetching on collapse/expand

    // State for Add Item Modal context - Removed
    // let addItemTargetListId: string | null = null;
    // let addItemTargetListName: string = '';

    const dispatch = createEventDispatcher(); // Instantiate dispatcher

    // Reference to the modal component instance - Removed
    // let addItemModalInstance: AddItemModal;

    // Corrected reactive check for external list
    $: isExternalList = node.pubkey !== currentUserPubkey;

    // Function to load items for external lists
    async function loadExternalItems() {
        if (!node.kind || !node.pubkey || !node.dTag) {
            externalItemsError = "Cannot load list: Missing coordinate data (kind, pubkey, dTag).";
            itemsLoaded = true; // Mark as loaded to prevent retries
            return;
        }

        isLoadingExternalItems = true;
        externalItemsError = null;
        itemsLoaded = true; // Mark as loaded even if error occurs below

        let fetchedListEventData: StoredEvent | undefined;
        try {
            console.log(`TreeNode: Loading external list event for ${node.id} (Coord: ${node.kind}:${node.pubkey}:${node.dTag})`);
            fetchedListEventData = await localDb.getLatestEventByCoord(node.kind, node.pubkey, node.dTag);

            if (!fetchedListEventData) {
                console.warn(`TreeNode: External list content not found locally for ${node.id}`);
                externalItemsError = "List content not found locally. Sync may be needed.";
                externalItems = [];
            } else {
                console.log(`TreeNode: Found external list event ${fetchedListEventData.id}. Extracting items...`);
                const items: ListItem[] = [];
                fetchedListEventData.tags.forEach(tag => {
                    if ((tag[0] === 'p' || tag[0] === 'e' || tag[0] === 'a') && tag[1]) {
                        items.push({ type: tag[0], value: tag[1], relayHint: tag[2] });
                    } else if (tag[0] === 'nip05' && tag[1] && tag[2]) {
                        items.push({ type: 'nip05', identifier: tag[1], cachedNpub: tag[2], value: tag[1] /* Use identifier for key */ });
                    }
                });
                externalItems = items;
                console.log(`TreeNode: Extracted ${externalItems.length} items for external list ${node.id}.`);
            }
        } catch (error: any) {
            console.error(`TreeNode: Error loading external list event for ${node.id}:`, error);
            externalItemsError = `Error loading list items: ${error.message || 'Unknown error'}`;
            externalItems = [];
        } finally {
            isLoadingExternalItems = false;
        }

        // After loading the list structure, trigger background fetches for item details
        if (externalItems.length > 0) {
            const identifiersToFetch = {
                pubkeys: [] as string[],
                eventIds: [] as string[],
                coordinates: [] as string[]
            };

            for (const item of externalItems) {
                if (item.type === 'p') {
                    identifiersToFetch.pubkeys.push(item.value);
                } else if (item.type === 'e') {
                    identifiersToFetch.eventIds.push(item.value);
                } else if (item.type === 'a') {
                    // Don't try to fetch details for nested lists ('a' tag pointing to kind 3xxxx)
                    // Need to parse the coordinate to check the kind
                    try {
                        const parts = item.value.split(':');
                        if (parts.length >= 1) {
                            const kind = parseInt(parts[0], 10);
                            if (!isNaN(kind) && !(kind >= 30000 && kind < 40000) && !(kind >= 10000 && kind < 20000)) {
                                // Only fetch if it's NOT a list kind
                                identifiersToFetch.coordinates.push(item.value);
                            }
                        }
                    } catch (e) {
                        console.warn(`[TreeNode] Failed to parse coordinate for 'a' tag: ${item.value}`, e);
                    }
                }
            }

            if (identifiersToFetch.pubkeys.length > 0 || identifiersToFetch.eventIds.length > 0 || identifiersToFetch.coordinates.length > 0) {
                console.log(`[TreeNode] Triggering background fetch for external item details:`, identifiersToFetch);
                // Call ndkService non-blockingly (fire and forget)
                ndkService.fetchAndCacheItemDetails(identifiersToFetch).catch(err => {
                     console.error("[TreeNode] Background item detail fetch failed:", err);
                });
            }
        }
    }

    // Reactive statement to trigger loading
    $: if (expanded && isExternalList && !itemsLoaded && !isLoadingExternalItems) {
        console.log(`TreeNode: Triggering loadExternalItems for expanded external node ${node.id}`);
        loadExternalItems();
    }

    // Make function exportable for testing
    export function toggleExpand() {
        expanded = !expanded;
        console.log(`TreeNode ${node.id}: Expanded set to ${expanded}`);
    }

    // Removed ListItem type definition

    // Removed handleRemoveItem function

    // Event Handlers/Forwarders (triggered by NodeActions)
    function openAddItemModal(event: CustomEvent<{ parentId: string }>) { 
        console.log(`TreeNode: Forwarding openadditem for parent ${event.detail.parentId}`);
        dispatch('openadditem', event.detail); 
    }
    function openRenameModal(event: CustomEvent<{ listNodeId: string; currentName: string }>) { 
        console.log(`TreeNode: Forwarding openrenamemodal for list ${event.detail.listNodeId}`);
        dispatch('openrenamemodal', event.detail); 
    }
    async function handleDeleteList(event: CustomEvent<{ listNodeId: string; listName: string }>) {
        // Kept the version that accepts event detail
        console.log(`TreeNode: Handling deletelist for list ${event.detail.listNodeId}`);
        if (!window.confirm(`Delete list "${event.detail.listName}"?`)) return;
        isDeleting = true;
        errorMessage = null;
        try {
            const result = await listService.deleteList(event.detail.listNodeId);
            if (!result.success) {
                errorMessage = result.error || 'Failed to delete list.';
                console.error(`Failed to delete list ${event.detail.listNodeId}:`, errorMessage);
            } else {
                console.log(`Successfully initiated deletion for list ${event.detail.listNodeId}`);
            }
        } catch (error: any) {
            errorMessage = 'An unexpected error occurred during deletion.';
            console.error("Unexpected error calling listService.deleteList:", error);
        } finally {
            isDeleting = false;
        }
    }
    
    // Event Handlers (triggered by NodeHeader)
    function handleStartEdit() { 
        editedName = node.name;
		isEditingName = true;
		setTimeout(() => { inputRef?.focus(); inputRef?.select(); }, 0);
    }
	function handleCancelEdit() { isEditingName = false; }
	async function handleSubmitName(event: CustomEvent<string>) {
        isEditingName = false;
        const newName = event.detail.trim();
		if (newName && newName !== node.name) {
            console.log(`TreeNode: Handling submitname for list ${node.id} to ${newName}`);
            errorMessage = null;
            try {
                const result = await listService.renameList(node.id, newName);
                if (!result.success) {
                    errorMessage = result.error || 'Failed to rename list.';
                     console.error(`Failed to rename list ${node.id}:`, errorMessage);
                } else {
                    console.log(`Successfully renamed list ${node.id} to ${newName}`);
                }
            } catch (error: any) {
                errorMessage = 'An unexpected error occurred during rename.';
                console.error("Unexpected error calling listService.renameList:", error);
            }
		}
	}

    // Event Forwarding (from NodeHeader or NodeItemsList)
	function forwardViewFeed(event: CustomEvent<{ listNodeId: string; listName: string }>) { 
        console.log(`TreeNode: Forwarding viewfeed for list ${event.detail.listNodeId}`);
        dispatch('viewfeed', event.detail); 
    }
    function forwardViewProfile(event: CustomEvent<{ npub: string }>) { 
        console.log(`TreeNode: Forwarding viewprofile for ${event.detail.npub}`);
        dispatch('viewprofile', event.detail); 
    }

    // Generic forwarder function
    function forwardEvent(event: CustomEvent<any>) {
        console.log(`TreeNode: Forwarding event type '${event.type}' with detail:`, event.detail);
        dispatch(event.type, event.detail);
    }

    // Forward checknip05 from NodeItemsList
    function forwardCheckNip05(event: CustomEvent<any>) {
        dispatch('checknip05', event.detail);
    }

    // Kept removeListFromParent - Requires localDb, ndkService, NDKEvent
    async function removeListFromParent(childListId: string, parentListId: string) {
        console.log(`Removing child list ${childListId} from parent ${parentListId}`);

        // Get signer from service
        const signer = ndkService.getSigner();
        const ndkInstanceForEvent = ndkService.getNdkInstance();
        if (!signer || !ndkInstanceForEvent) {
             console.error('Signer or NDK instance not available. Cannot remove list.');
            return;
        }

        try {
            // 1. Fetch the latest version of the parent list event using ID
            const parentEventData = await localDb.getEventById(parentListId); // Use getEventById
            if (!parentEventData) {
                throw new Error(`Parent list event ${parentListId} not found in local DB.`);
            }

            // 2. Create a new event based on the parent, removing the child tag
            const updatedEvent = new NDKEvent(ndkInstanceForEvent);
            updatedEvent.kind = parentEventData.kind;
            updatedEvent.content = parentEventData.content;
            // Ensure tags are copied before filtering
            updatedEvent.tags = parentEventData.tags.filter(tag => !(tag[0] === 'a' && tag[1].includes(childListId))); // Assuming 'a' tag format includes coordinate

            // 3. Sign the updated event
            await updatedEvent.sign(signer);
            console.log('Signed updated parent list event:', updatedEvent);

            // 4. Publish the updated event
            const publishedTo = await ndkService.publish(updatedEvent);

            if (publishedTo.size === 0) {
                throw new Error('Updated parent list event was not published to any relays.');
            }

            dispatch('listremoved', { parentId: parentListId, childId: childListId });
            refreshTrigger.update(n => n + 1);
        } catch (error: any) {
            console.error('Error removing list from parent:', error);
            alert('An error occurred while removing the list from its parent.');
        }
    }
</script>

<!-- Use the new NodeHeader component -->
<NodeHeader 
    {node} 
    {depth} 
    currentUserPubkey={currentUserPubkey}
    expanded={expanded}  
    on:toggle={toggleExpand} 
    bind:isEditingName={isEditingName}
    bind:editedName={editedName}
    bind:inputRef={inputRef} 
    on:submitname={handleSubmitName}
    on:canceledit={handleCancelEdit}
    on:startedit={handleStartEdit}
    {showAddLinkButtonForDiscover}
>
    <!-- Pass node actions through a slot -->
    <div slot="actions">
        <NodeActions
            {node}
            currentUserPubkey={currentUserPubkey}
            on:viewprofile
            on:viewevent
            on:viewresource
        />
    </div>
</NodeHeader>

<!-- Render Items OR External List Content when Expanded -->
{#if expanded}
    {#if isExternalList}
        <!-- External List Content -->
        {#if isLoadingExternalItems}
            <div class="flex items-center justify-center py-2 pl-6" style="padding-left: {(depth + 1) * 1.5 + 1.5}rem;">
                <span class="loading loading-spinner loading-sm text-primary mr-2"></span> Loading items...
            </div>
        {:else if externalItemsError}
            <div class="alert alert-warning alert-sm shadow-lg my-1 mx-2" style="margin-left: {(depth + 1) * 1.5 + 0.5}rem;">
                <div>
                    <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current flex-shrink-0 h-4 w-4" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <span class="text-xs">{externalItemsError}</span>
                </div>
            </div>
        {:else}
            <div class="pl-6" style="padding-left: {(depth + 1) * 1.5 + 1.5}rem;"> <!-- External items container -->
                {#each externalItems as item (item.value)} <!-- Use item.value as key -->
                    {#if item.type === 'p' || item.type === 'e' || item.type === 'a'}
                        <ItemWrapper
                            {item}
                            listId={node.eventId} 
                            listPubkey={node.pubkey} 
                            on:viewprofile={forwardEvent}
                            on:viewevent={forwardEvent}
                            on:navigatelist={forwardEvent}
                            on:viewresource={forwardEvent}
                        />
                    {:else if item.type === 'nip05'}
                        {@const nip05Item = item as Extract<ListItem, { type: 'nip05' }>} <!-- Cast to Nip05 type -->
                        <Nip05Item 
                            item={nip05Item}
                            listId={node.eventId}
                            isOnline={$isOnline}
                            status={verificationStates[nip05Item.identifier]?.status || 'idle'}
                            newlyResolvedNpub={verificationStates[nip05Item.identifier]?.newlyResolvedNpub || null}
                            errorMsg={verificationStates[nip05Item.identifier]?.errorMsg || null}
                            on:checknip05={forwardCheckNip05}
                        />
                    {/if}
                {/each}
                {#if externalItems.length === 0 && !isLoadingExternalItems && !externalItemsError}
                    <p class="text-xs italic text-base-content/50 pl-6" style="padding-left: {(depth + 1) * 1.5 + 1.5}rem;">(No items found in this external list)</p>
                {/if}
            </div>
        {/if}
    {:else}
        <!-- Owned List Items -->
        {#if node.items && node.items.length > 0}
            <NodeItemsList 
              {node} 
              level={depth} 
              {verificationStates} 
              on:checknip05={forwardCheckNip05}
              on:viewprofile={forwardEvent}
              on:viewevent={forwardEvent}
              on:navigatelist={forwardEvent}
              on:viewresource={forwardEvent}
            /> 
        {:else if node.kind === 30001 || node.kind === 30000 || node.kind === 10001 || node.kind === 10000 } <!-- Only show for list kinds -->
             <p class="text-xs italic text-base-content/50 pl-6" style="padding-left: {(depth + 1) * 1.5 + 1.5}rem;">(List is empty)</p>
        {/if}
    {/if}
{/if}

<!-- Recursive Children -->
{#if expanded && node.children && node.children.length > 0}
  <div class="mt-1" style="margin-left: 0;"> 
    {#each node.children as childNode (childNode.id)}
      <svelte:self 
          node={childNode} 
          depth={depth + 1} 
          verificationStates={verificationStates}
          currentUserPubkey={currentUserPubkey}
          on:listchanged 
          on:openadditem 
          on:openrenamemodal
          on:viewprofile
          on:viewfeed
          on:viewevent
          on:navigatelist
          on:viewresource
          on:checknip05
          {showAddLinkButtonForDiscover}
      />
    {/each}
  </div>
{/if}