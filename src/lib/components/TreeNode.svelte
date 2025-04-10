<script lang="ts">
    // Keep the props definition
    // import type { TreeNodeData } from '$lib/hierarchyService'; // Import path might need adjustment based on project structure
    import type { TreeNodeData } from '$lib/types'; // Corrected import and type name
    import UserItem from '$lib/components/UserItem.svelte'; // Import UserItem
    import NoteItem from '$lib/components/NoteItem.svelte'; // Import NoteItem
    import { get } from 'svelte/store';
    import { user } from '$lib/userStore';
    import { refreshTrigger } from '$lib/refreshStore';
    import { addItemToList, removeItemFromList } from '$lib/listService'; // Removed ListServiceDependencies import
    // import AddItemModal from './AddItemModal.svelte'; // Import the modal - Removed
    import { createEventDispatcher } from 'svelte'; // Import dispatcher
    import { localDb, type StoredEvent } from '$lib/localDb';
    import { ndkService } from '$lib/ndkService'; // Added
    import { NDKEvent } from '@nostr-dev-kit/ndk';
    import { nip19 } from 'nostr-tools'; // Import nip19
    import { isOnline } from '$lib/networkStatusStore'; // <-- Ensure isOnline is imported
    // Import Icon component and the specific icon definition
    import { Icon, PencilSquare } from 'svelte-hero-icons';

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
            const originalListEventData = await localDb.getEventById(node.eventId); // Use list ID from node
            if (!originalListEventData) {
                throw new Error(`Original list event ${node.eventId} not found locally.`);
            }

            // Create a new NDKEvent instance using the NDK instance from the service
            const newListEvent = new NDKEvent(ndkInstanceForEvent); // Pass the NDK instance
            newListEvent.kind = originalListEventData.kind;
            newListEvent.content = originalListEventData.content;

            // Filter out the tag to be removed
            newListEvent.tags = originalListEventData.tags.filter(tag => !(tag[0] === itemType && tag[1] === itemId));

            // Re-add replaceable list identifier tags if needed (e.g., 'd')
            const dTagValue = originalListEventData.tags.find(tag => tag[0] === 'd')?.[1];
            if (dTagValue && !newListEvent.tags.some(tag => tag[0] === 'd')) {
                newListEvent.tags.push(['d', dTagValue]);
            }
            const titleValue = originalListEventData.tags.find(tag => tag[0] === 'title')?.[1];
             if (titleValue && !newListEvent.tags.some(tag => tag[0] === 'title')) {
                newListEvent.tags.push(['title', titleValue]);
            }

            // Sign using the signer from the service
            await newListEvent.sign(signer);
            console.log('Signed event after item removal:', newListEvent);

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
                 dTag: dTagValue, // Use stored dTagValue
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

    // Function to dispatch event for opening the rename modal
    function openRenameModal() {
        if (!node.id || !node.name) {
            console.error("Cannot dispatch openrenamemodal: Node ID or Name is missing.");
            return;
        }
        console.log(`%cTreeNode: Dispatching openrenamemodal with listId: '${node.id}', listName: '${node.name}'`, 'color: orange;', node);
        dispatch('openrenamemodal', {
            listId: node.id, // Use node.id which should be the coordinate
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

    <!-- Badges and Add Button (Merged) -->
    <div class="flex items-center flex-shrink-0 space-x-1 ml-auto">
        <!-- Badges -->
        <div class="badge badge-neutral badge-sm font-mono" title="Kind">K:{node.kind}</div>
        {#if node.dTag}
            <div class="badge badge-outline badge-sm font-mono" title="dTag">{node.dTag}</div>
        {/if}
        <div class="badge badge-outline badge-sm" title="Items">{node.itemCount} items</div>

        <!-- Add Button -->
        {#if node.pubkey === $user?.pubkey}
            <button
                class="btn btn-ghost btn-xs p-1 text-base-content/70 hover:text-accent disabled:text-base-content/30"
                title="Add item to this list"
                on:click|stopPropagation={openAddItemModal}
                disabled={!$isOnline} 
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
                    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
            </button>
            <!-- +++ NEW RENAME BUTTON +++ -->
            {#if $isOnline} <!-- Rename only available when online for now -->
                <button
                    class="btn btn-ghost btn-xs p-1 text-base-content/70 hover:text-primary"
                    title="Rename this list"
                    on:click|stopPropagation={openRenameModal}
                >
                    <!-- Use Icon component with src prop -->
                    <Icon src={PencilSquare} class="w-4 h-4" />
                </button>
            {/if}
        {/if}
    </div>
</div>

<!-- Render Items when Expanded -->
{#if expanded && node.items && node.items.length > 0}
    <div class="pl-6" style="padding-left: {level * 1.5 + 1.5}rem;">
        {#each node.items as item (item.value)} <!-- Use item.value as key -->
            <div class="flex items-center py-1 hover:bg-base-300 rounded text-sm">
                {#if item.type === 'p'}
                    <UserItem pubkey={item.value} />
                {:else if item.type === 'e'}
                    <NoteItem eventId={item.value} /> <!-- Corrected prop name: noteId -> eventId -->
                {/if}

                <!-- Remove Item Button -->
                <button
                    class="btn btn-xs btn-ghost text-error ml-auto mr-1"
                    on:click={() => handleRemoveItem(item.value, item.type)}
                    disabled={isRemovingItemId !== null || !$isOnline}
                    title={!$isOnline ? 'Cannot remove item while offline' : (isRemovingItemId !== null ? 'Removing...' : 'Remove item')}
                >
                    {#if isRemovingItemId === item.value}
                        <span class="loading loading-spinner loading-xs"></span>
                    {:else}
                        ✕
                    {/if}
                </button>
            </div>
        {/each}
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