<script lang="ts">
    // Keep the props definition
    // import type { TreeNodeData } from '$lib/hierarchyService'; // Import path might need adjustment based on project structure
    import type { TreeNodeData } from '$lib/types'; // Corrected import and type name
    import UserItem from './UserItem.svelte'; // Import UserItem
    import NoteItem from './NoteItem.svelte'; // Import NoteItem
    import { get } from 'svelte/store';
    import { user } from '$lib/userStore';
    import { ndk } from '$lib/ndkStore';
    import { refreshTrigger } from '$lib/refreshStore';
    import { addItemToList, removeItemFromList, type ListServiceDependencies } from '$lib/listService'; // Import list service functions
    // import AddItemModal from './AddItemModal.svelte'; // Import the modal - Removed
    import { createEventDispatcher } from 'svelte'; // Import dispatcher

    export let node: TreeNodeData; // Corrected type annotation
    export let level: number = 0;

    let expanded: boolean = false; // State for expand/collapse
    let isAdding: boolean = false;
    let isRemovingItemId: string | null = null; // Store which item is being removed

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

    async function handleRemoveItem(item: ListItem) {
        if (!node.id) {
            console.error("Cannot remove item: List node ID is missing.");
            alert("Cannot remove item: List node ID is missing.");
            return;
        }

        isRemovingItemId = item.value;

        const currentUser = get(user);
        const ndkInstance = get(ndk);

        if (!currentUser || !ndkInstance) {
            console.error("Cannot remove item: User or NDK not available.");
            alert("Action failed: User or NDK not available.");
            isRemovingItemId = null;
            return;
        }

        const deps: ListServiceDependencies = { currentUser, ndkInstance };

        try {
            console.log(`Attempting to remove item ${item.type}:${item.value} from list ${node.id}`);
            const result = await removeItemFromList(node.id, item, deps);

            if (result.success) {
                console.log(`Item ${item.type}:${item.value} removed successfully locally from list ${node.id}.`);
                dispatch('listchanged'); // Notify parent page to refresh
            } else {
                console.error(`Failed to remove item from list ${node.id}:`, result.error);
                alert(`Failed to remove item: ${result.error}`);
            }
        } catch (error) {
            console.error(`Unexpected error removing item from list ${node.id}:`, error);
            alert(`An unexpected error occurred while removing the item.`);
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
                        on:click|stopPropagation={() => handleRemoveItem(item)}
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