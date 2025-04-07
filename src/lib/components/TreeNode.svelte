<script lang="ts">
    // Keep the props definition
    // import type { TreeNodeData } from '$lib/hierarchyService'; // Import path might need adjustment based on project structure
    import type { TreeNodeData } from '$lib/types'; // Assuming types.ts holds the definition
    import UserItem from './UserItem.svelte'; // Import UserItem
    import NoteItem from './NoteItem.svelte'; // Import NoteItem
    import { get } from 'svelte/store';
    import { user } from '$lib/userStore';
    import { ndk } from '$lib/ndkStore';
    import { refreshTrigger } from '$lib/refreshStore';
    import { addItemToList, removeItemFromList, type ListServiceDependencies } from '$lib/listService'; // Import list service functions
    import AddItemModal from './AddItemModal.svelte'; // Import the modal

    export let node: TreeNodeData;
    export let level: number = 0;

    let expanded: boolean = false; // State for expand/collapse
    let isAdding: boolean = false;
    let isRemovingItemId: string | null = null; // Store which item is being removed

    // Reference to the modal component instance
    let addItemModalInstance: AddItemModal;

    async function handleRemoveItem(item: { type: 'p' | 'e'; value: string }) {
        const itemIdentifier = `${item.type}:${item.value}`;
        isRemovingItemId = itemIdentifier; // Set loading state for *this* item

        const currentUser = get(user);
        const ndkInstance = get(ndk);

        if (!currentUser || !ndkInstance) {
            console.error('Remove Item Error: User or NDK instance not available.');
            // Potentially show a user-facing error message
            alert('Login required to remove items.');
            isRemovingItemId = null; // Reset loading state
            return;
        }

        const deps: ListServiceDependencies = { currentUser, ndkInstance };

        try {
            // Use node.eventId as the list identifier
            const result = await removeItemFromList(node.eventId, item, deps);

            if (result.success) {
                console.log(`Item ${item.type}:${item.value} removed locally from list ${node.eventId}. Triggering refresh.`);
                // Trigger global refresh mechanism
                refreshTrigger.update(n => n + 1);
                // Optional: Could update local node state optimistically here, but global refresh handles it
            } else {
                console.error(`Failed to remove item from list ${node.eventId}:`, result.error);
                // Show user-facing error
                alert(`Failed to remove item: ${result.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error(`Error calling removeItemFromList for list ${node.eventId}:`, error);
            alert('An unexpected error occurred while removing the item.');
        } finally {
            isRemovingItemId = null; // Reset loading state regardless of outcome
        }
    }

    function openAddItemModal() {
        if (addItemModalInstance) {
            // Pass the current node's event ID as the target list ID
            addItemModalInstance.targetListId = node.eventId;
            addItemModalInstance.open(); // Call the modal's open method
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
    title="{node.name} (Event ID: {node.eventId})"
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
        {#each node.items as item (item.type + item.value)}
            {@const itemIdentifier = `${item.type}:${item.value}`}
            <div class="flex items-center justify-between space-x-2 group hover:bg-base-200/50 rounded pr-2">
                 <!-- Item Component -->
                 <div class="flex-grow">
                    {#if item.type === 'p'}
                        <UserItem pubkey={item.value} />
                    {:else if item.type === 'e'}
                        <NoteItem eventId={item.value} />
                    {/if}
                 </div>
                 <!-- Remove Button -->
                 <button
                    class="btn btn-xs btn-ghost btn-circle text-error opacity-0 group-hover:opacity-100 transition-opacity"
                    class:loading={isRemovingItemId === itemIdentifier}
                    title="Remove Item"
                    on:click|stopPropagation={() => handleRemoveItem(item)}
                    disabled={isRemovingItemId !== null}
                 >
                    {#if isRemovingItemId !== itemIdentifier}
                      <span>✕</span>
                    {/if}
                 </button>
            </div>
        {/each}

         <!-- Add Item Button - Now opens the modal -->
         <div class="mt-2">
             <button
                 class="btn btn-xs btn-outline btn-primary"
                 on:click|stopPropagation={openAddItemModal}
                 disabled={isRemovingItemId !== null}
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
      <svelte:self node={childNode} level={level + 1}/>
    {/each}
  </div>
{/if}

<!-- AddItemModal Instance -->
<!-- Render the modal; it will be hidden by default -->
<!-- We pass targetListId when opening, so initial value doesn't strictly matter here -->
<AddItemModal bind:this={addItemModalInstance} targetListId={node.eventId} /> 