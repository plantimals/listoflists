<script lang="ts">
    // Keep the props definition
    // import type { TreeNodeData } from '$lib/hierarchyService'; // Import path might need adjustment based on project structure
    import type { TreeNodeData } from '$lib/types'; // Assuming types.ts holds the definition
    import UserItem from './UserItem.svelte'; // Import UserItem
    import NoteItem from './NoteItem.svelte'; // Import NoteItem

    export let node: TreeNodeData;
    export let level: number = 0;

    let expanded: boolean = false; // State for expand/collapse
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
    title={node.name}
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
            {#if item.type === 'p'}
                <UserItem pubkey={item.value} />
            {:else if item.type === 'e'}
                <NoteItem eventId={item.value} />
            {/if}
        {/each}
    </div>
{/if}

<!-- Placeholder for Recursive Children (Added in next step) --> 