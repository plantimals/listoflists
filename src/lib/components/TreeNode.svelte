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

    export let node: TreeNodeData;
    export let level: number = 0;

    let expanded: boolean = false; // State for expand/collapse
    let isAdding: boolean = false;
    let isRemovingItemId: string | null = null; // Store which item is being removed

    async function handleRemoveItem(item: { type: 'p' | 'e'; value: string }) {
        const itemIdentifier = `${item.type}:${item.value}`;
        isRemovingItemId = itemIdentifier; // Set loading for this specific item

        const currentUser = get(user);
        const ndkInstance = get(ndk);

        if (!currentUser || !ndkInstance) {
            console.error('Remove Item Error: User or NDK instance not available.');
            alert('User or NDK instance not available. Cannot remove item.');
            isRemovingItemId = null;
            return;
        }

        const deps: ListServiceDependencies = { currentUser, ndkInstance };

        try {
            const result = await removeItemFromList(node.eventId, item, deps);
            if (result.success) {
                console.log('Item removed successfully, triggering refresh...', result);
                refreshTrigger.update(n => n + 1); // Trigger refresh
            } else {
                console.error('Failed to remove item:', result.error);
                alert(`Failed to remove item: ${result.error}`);
            }
        } catch (error) {
            console.error('Error calling removeItemFromList:', error);
            alert('An unexpected error occurred while removing the item.');
        } finally {
            isRemovingItemId = null; // Clear loading state regardless of outcome
        }
    }

    async function handleAddItem() {
        const itemValue = prompt('Enter pubkey (or event ID) to add:'); // Simple prompt for now
        if (!itemValue) return; // User cancelled

        // Very basic check - better validation needed for real use
        const itemType = itemValue.length === 64 && /^[0-9a-f]+$/.test(itemValue) ? 'p' : 'e';

        const itemToAdd = { type: itemType as 'p' | 'e', value: itemValue.trim() };

        isAdding = true;
        const currentUser = get(user);
        const ndkInstance = get(ndk);

        if (!currentUser || !ndkInstance) {
            console.error('Add Item Error: User or NDK instance not available.');
            alert('User or NDK instance not available. Cannot add item.');
            isAdding = false;
            return;
        }

        const deps: ListServiceDependencies = { currentUser, ndkInstance };

        try {
            const result = await addItemToList(node.eventId, itemToAdd, deps);
            if (result.success) {
                console.log('Item added successfully, triggering refresh...', result);
                refreshTrigger.update(n => n + 1); // Trigger refresh
            } else {
                console.error('Failed to add item:', result.error);
                alert(`Failed to add item: ${result.error}`);
            }
        } catch (error) {
            console.error('Error calling addItemToList:', error);
            alert('An unexpected error occurred while adding the item.');
        } finally {
            isAdding = false;
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
                    <span>✕</span>
                 </button>
            </div>
        {/each}

         <!-- Add Item Button -->
         <div class="mt-2">
             <button
                 class="btn btn-xs btn-outline btn-primary"
                 class:loading={isAdding}
                 on:click|stopPropagation={handleAddItem}
                 disabled={isAdding || isRemovingItemId !== null}
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