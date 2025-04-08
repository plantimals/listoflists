<script lang="ts">
    // Keep the props definition
    // import type { TreeNodeData } from '$lib/hierarchyService'; // Import path might need adjustment based on project structure
    import type { TreeNodeData } from '$lib/types'; // Corrected import and type name
    import UserItem from '$lib/components/UserItem.svelte'; // Import UserItem
    import NoteItem from '$lib/components/NoteItem.svelte'; // Import NoteItem
    import { get } from 'svelte/store';
    import { user } from '$lib/userStore';
    import { refreshTrigger } from '$lib/refreshStore';
    import { addItemToList, removeItemFromList, type ListServiceDependencies } from '$lib/listService'; // Import list service functions
    // import AddItemModal from './AddItemModal.svelte'; // Import the modal - Removed
    import { createEventDispatcher } from 'svelte'; // Import dispatcher
    import { localDb, type StoredEvent } from '$lib/localDb';
    import { ndkService } from '$lib/ndkService'; // Added
    import { NDKEvent } from '@nostr-dev-kit/ndk';
    import { nip19 } from 'nostr-tools'; // Import nip19

    export let node: TreeNodeData; // Corrected type annotation
    export let level: number = 0;

    let expanded: boolean = false; // State for expand/collapse
    let isAdding: boolean = false;
    let isRemovingItemId: string | null = null; // Store which item is being removed
    let errorMessage: string | null = null; // Declare errorMessage

    // State for Add Item Modal context - Removed
    // let addItemTargetListId: string | null = null;
    // let addItemTargetListName: string = '';

    const dispatch = createEventDispatcher(); // Instantiate dispatcher

    // Reference to the modal component instance - Removed
    // let addItemModalInstance: AddItemModal;

    let collapsed = false;

    function toggleCollapse() {
        collapsed = !collapsed;
    }

    // Define the item type explicitly, matching the structure used in listService/hierarchyService
    type ListItem = { type: 'p' | 'e'; value: string };

    async function handleRemoveItem(itemId: string, itemType: 'p' | 'e') {
        isRemovingItemId = itemId;
        errorMessage = null;

        // Get Signer and NDK Instance from Service
        const signer = ndkService.getSigner();
        const ndkInstanceForEvent = ndkService.getNdkInstance();

        if (!signer || !ndkInstanceForEvent) {
            errorMessage = 'Signer or NDK instance not available.';
            console.error(errorMessage);
            isRemovingItemId = null;
            return;
        }
        
        // Removed currentUser check as it's implicit via signer
        // Removed get(ndk) and related check

        try {
            const originalListEventData = await localDb.getEventById(node.id); // Use list ID from node
            if (!originalListEventData) {
                throw new Error(`Original list event ${node.id} not found locally.`);
            }

            // Create a new NDKEvent instance using the NDK instance from the service
            const newListEvent = new NDKEvent(ndkInstanceForEvent); // Pass the NDK instance
            newListEvent.kind = originalListEventData.kind;
            newListEvent.content = originalListEventData.content;

            // Filter out the tag to be removed
            newListEvent.tags = originalListEventData.tags.filter(tag => !(tag[0] === itemType && tag[1] === itemId));

            // Re-add replaceable list identifier tags if needed (e.g., 'd')
            const dTag = originalListEventData.tags.find(tag => tag[0] === 'd');
            if (dTag && !newListEvent.tags.some(tag => tag[0] === 'd')) {
                newListEvent.tags.push(dTag);
            }
            const titleTag = originalListEventData.tags.find(tag => tag[0] === 'title');
             if (titleTag && !newListEvent.tags.some(tag => tag[0] === 'title')) {
                newListEvent.tags.push(titleTag);
            }

            // Sign using the signer from the service
            await newListEvent.sign(signer);
            console.log('Signed event after item removal:', newListEvent);

            // Publish using the service
            const publishedTo = await ndkService.publish(newListEvent);
            if (publishedTo.size === 0) {
                throw new Error('Updated list event was not published to any relays.');
            }

            // Save updated event to local DB
            const storedEventData: StoredEvent = {
                // ... map fields from newListEvent ...
                 id: newListEvent.id,
                 kind: newListEvent.kind,
                 pubkey: newListEvent.pubkey,
                 created_at: newListEvent.created_at ?? 0,
                 tags: newListEvent.tags,
                 content: newListEvent.content,
                 sig: newListEvent.sig ?? '',
                 dTag: dTag?.[1], // Add dTag if present
                 published: false // Mark as unpublished until sync confirms
            };
            await localDb.addOrUpdateEvent(storedEventData);
            console.log('Updated list event saved locally.');

            dispatch('itemremoved', { listId: node.id }); // Notify parent
            // Update the store value to trigger listeners
            refreshTrigger.update(n => n + 1);

        } catch (err: any) {
            console.error('Error removing item:', err);
            errorMessage = `Failed to remove item: ${err.message}`;
        } finally {
            isRemovingItemId = null;
        }
    }

    // Function to dispatch event for opening the modal
    function openAddItemModal() {
        if (!node.id || !node.name) {
             console.error("Cannot dispatch openadditem: Node ID or Name is missing.");
             // Optionally alert the user if needed, but primarily log the error
             // alert("Cannot open add item modal: List details missing.");
             return;
        }
        // *** Debug Log: Check node.id before dispatch ***
        console.log(`%cTreeNode: Dispatching openadditem with listId: '${node.id}', listName: '${node.name}'`, 'color: blue;', node);

        // Dispatch the event with necessary details
        dispatch('openadditem', {
            listId: node.id,
            listName: node.name
        });
    }

    // Function to handle the event dispatched by the modal - Removed
    // function handleItemAdded() {
    //     console.log('TreeNode: Item added event received from modal. Triggering listchanged.');
    //     dispatch('listchanged'); // Dispatch event up to parent
    // }

    async function removeListFromParent(childListId: string, parentListId: string) {
        console.log(`Removing child list ${childListId} from parent ${parentListId}`);

        // const ndkInstance = get(ndk); // Removed
        // if (!ndkInstance) {
        //     console.error('NDK instance not available.');
        //     return;
        // }
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

    // No other script logic needed for this step
</script>

<!-- Main row for the node -->
<div
    class="flex items-center space-x-2 py-1 hover:bg-base-200 rounded cursor-pointer"
    style="padding-left: {level * 1.5}rem;"
    on:click={() => {
        // Toggle only if items exist or children exist
        if ((node.items && node.items.length > 0) || (node.children && node.children.length > 0)) {
            expanded = !expanded;
        }
    }}
    title="{node.name} (Event ID: {node.id})"
>
    <!-- Expander Icon Area -->
    <div class="w-4 h-4 flex-shrink-0 flex items-center justify-center">
        {#if node.children && node.children.length > 0}
            <!-- Expander for children -->
            <span
                class="cursor-pointer text-accent text-xs"
                on:click|stopPropagation={() => expanded = !expanded}
                title={expanded ? 'Collapse' : 'Expand'}
            >
                {#if expanded}
                    ▼
                {:else}
                    ▶
                {/if}
            </span>
        {:else if node.items && node.items.length > 0}
            <!-- Indicator that items can be expanded (if no children) -->
            <span class="w-4 text-xs text-base-content/50" title="Expand to show items">•</span>
        {:else}
            <!-- Placeholder for alignment -->
            <span class="w-4"></span>
        {/if}
    </div>

    <!-- Node Name -->
    <span class="flex-grow font-medium truncate">
        {node.name}
    </span>

    <!-- Badges -->
    <div class="flex-shrink-0 space-x-1">
        <div class="badge badge-neutral badge-sm font-mono" title="Kind">K:{node.kind}</div>
        {#if node.dTag}
            <div class="badge badge-outline badge-sm font-mono" title="dTag">{node.dTag}</div>
        {/if}
        <div class="badge badge-outline badge-sm" title="Items">{node.itemCount} items</div>
    </div>
</div>

<!-- Render Items when Expanded -->
{#if expanded && node.items && node.items.length > 0}
    <div class="ml-6 mt-1 border-l border-base-300 pl-3 space-y-1 py-1" style="margin-left: {(level + 1) * 1.5}rem;">
        {#each node.items as item (item.value)}
            <!-- Wrapper div for item + button -->
            <div class="flex items-center justify-between space-x-2 group hover:bg-base-200/50 rounded pr-1 py-0.5">
                 <!-- Item Component -->
                 <div class="flex-grow min-w-0"> <!-- Added min-w-0 for better truncation -->
                    {#if item.type === 'p'}
                        <UserItem pubkey={item.value} />
                    {:else if item.type === 'e'}
                        <NoteItem eventId={item.value} />
                    {/if}
                 </div>
                 <!-- Remove Button (re-integrated) -->
                 {#if $user}
                    <button
                        class="btn btn-xs btn-circle btn-ghost text-error opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                        title="Remove item"
                        on:click|stopPropagation={() => handleRemoveItem(item.value, item.type)}
                        disabled={isRemovingItemId !== null}
                    >
                        {#if isRemovingItemId === item.value}
                            <span class="loading loading-spinner loading-xs"></span>
                        {:else}
                            ✕
                        {/if}
                    </button>
                 {/if}
            </div>
        {/each}

        <!-- Add Item Button (Connects to openAddItemModal) -->
        <div class="mt-2 pl-4">
            <button
                class="btn btn-xs btn-outline btn-primary"
                on:click|stopPropagation={openAddItemModal}
                disabled={isRemovingItemId !== null || !$user}
            >
                <span>+ Add Item</span>
            </button>
        </div>
    </div>
{/if}

<!-- Recursive Children -->
{#if expanded && node.children && node.children.length > 0}
  <div class="mt-1" style="margin-left: 0;"> <!-- Adjust margin if needed, or keep consistent -->
    {#each node.children as childNode (childNode.id)}
      <svelte:self node={childNode} level={level + 1} on:listchanged={() => dispatch('listchanged')} />
    {/each}
  </div>
{/if}

<!-- Render AddItemModal Instance (ensure it's outside loops/conditionals if needed once per TreeNode is okay) - Removed -->
<!-- Pass reactive props and handle the event - Removed -->
<!-- <AddItemModal targetListId={addItemTargetListId} targetListName={addItemTargetListName} on:itemadded={handleItemAdded} /> --> 