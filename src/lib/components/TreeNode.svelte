<script lang="ts">
    // Keep the props definition
    // import type { TreeNodeData } from '$lib/hierarchyService'; // Import path might need adjustment based on project structure
    import type { TreeNodeData } from '$lib/types'; // Corrected import and type name
    // Removed UserItem import
    // Removed NoteItem import
    import NodeHeader from './NodeHeader.svelte'; // Import the new header component
    import NodeActions from './NodeActions.svelte'; // Import the new actions component
    import NodeItemsList from '$lib/components/NodeItemsList.svelte'; // Use $lib alias for import
    import { get } from 'svelte/store';
    import { user } from '$lib/userStore';
    import { refreshTrigger } from '$lib/refreshStore';
    // Removed removeItemFromList import
    import * as listService from '$lib/listService'; // Import listService namespace
    // import AddItemModal from './AddItemModal.svelte'; // Import the modal - Removed
    import { createEventDispatcher } from 'svelte'; // Import dispatcher
    import { localDb, type StoredEvent } from '$lib/localDb'; // Re-added for removeListFromParent
    import { ndkService } from '$lib/ndkService'; // Re-added for removeListFromParent
    import { NDKEvent } from '@nostr-dev-kit/ndk'; // Re-added for removeListFromParent
    import { nip19 } from 'nostr-tools'; // Import nip19
    import { isOnline } from '$lib/networkStatusStore'; // <-- Ensure isOnline is imported
    // Import Icon component and the specific icon definition
    // import { Icon, PencilSquare, Trash } from 'svelte-hero-icons';

    export let node: TreeNodeData;
    export let level: number = 0;

    let expanded: boolean = false; // State for expand/collapse
    let isAdding: boolean = false;
    // Removed isRemovingItemId state
    let errorMessage: string | null = null; // Declare errorMessage (keep for handleDeleteList)
    let isDeleting: boolean = false; // Add loading state for delete (keep for handleDeleteList)

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

    // Removed ListItem type definition

    // Removed handleRemoveItem function

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

    // Function to handle deleting the current list node
    async function handleDeleteList() {
        if (!node.id) {
            console.error("Cannot delete list: Node ID is missing.");
            errorMessage = "Cannot delete list: List details are missing."; // Show error in UI
            return;
        }

        if (!window.confirm(`Are you sure you want to delete the list \"${node.name}\"? This action cannot be undone.`)) {
            return;
        }

        isDeleting = true; // Start loading indicator
        errorMessage = null; // Clear previous errors

        try {
            console.log(`Calling listService.deleteList for coordinate: ${node.id}`);
            const result = await listService.deleteList(node.id);

            if (!result.success) {
                console.error(`Failed to delete list ${node.id}:`, result.error);
                errorMessage = result.error || 'Failed to delete list.';
            } else {
                console.log(`Successfully initiated deletion for list ${node.id}`);
                // The refreshTrigger in listService will update the main view
                // Optionally, provide success feedback here if needed, though removal is the main feedback
            }
        } catch (error: any) {
            console.error("Unexpected error calling listService.deleteList:", error);
            errorMessage = "An unexpected error occurred during deletion.";
        } finally {
            isDeleting = false; // Stop loading indicator
        }
    }

    // No other script logic needed for this step
</script>

<!-- Use the new NodeHeader component -->
<NodeHeader {node} {level} bind:expanded>
    <!-- Pass NodeActions into the header slot -->
    <NodeActions
        slot="actions"
        {node}
        currentUserPubkey={$user?.pubkey}
        isOnline={$isOnline}
        bind:isDeleting={isDeleting}
        on:openadditem={openAddItemModal} 
        on:openrenamemodal={openRenameModal} 
        on:deletelist={handleDeleteList}
    />
</NodeHeader>

<!-- Render Items using NodeItemsList when Expanded -->
{#if expanded && node.items && node.items.length > 0}
    <NodeItemsList {node} {level} />
{/if}


<!-- Recursive Children -->
{#if expanded && node.children && node.children.length > 0}
  <div class="mt-1" style="margin-left: 0;"> <!-- Adjust margin if needed, or keep consistent -->
    {#each node.children as childNode (childNode.id)}
      <svelte:self 
          node={childNode} 
          level={level + 1} 
          on:listchanged 
          on:openadditem 
          on:openrenamemodal
          />
    {/each}
  </div>
{/if}

<!-- Render AddItemModal Instance (ensure it's outside loops/conditionals if needed once per TreeNode is okay) - Removed -->
<!-- Pass reactive props and handle the event - Removed -->
<!-- <AddItemModal targetListId={addItemTargetListId} targetListName={addItemTargetListName} on:itemadded={handleItemAdded} /> --> 