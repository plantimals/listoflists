<script lang="ts">
  // Imports and props will be added in subsequent steps
  import type { TreeNodeData } from '$lib/types'; // Add basic type import
  // Removed Icon, PencilSquare, Trash imports as buttons moved
  // Removed user store import
  // Removed isOnline store import
  // Removed createEventDispatcher import

  // Add props as needed, starting with node for components that need it directly
  export let node: TreeNodeData; // Example: uncomment if needed
  export let level: number = 0;
  export let expanded: boolean = false; // Needs to be two-way bindable

  // Removed dispatcher

  console.log('Component initialized:', 'NodeHeader');

  // Local state/handlers needed by the header (e.g., isDeleting if handleDeleteList moves here)
  // let isDeleting = false; // Keep isDeleting state in TreeNode for now as handler is there
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
    title="{node.name} (List Coordinate: {node.id})"
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
             <!-- Visual cue adjusted for clarity, original behavior was similar -->
            <span class="w-4 text-xs text-base-content/50" title="Items can be expanded">•</span>
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
    <div class="flex items-center flex-shrink-0 space-x-1 ml-auto">
        <div class="badge badge-neutral badge-sm font-mono" title="Kind">K:{node.kind}</div>
        {#if node.dTag}
            <div class="badge badge-outline badge-sm font-mono" title="dTag">{node.dTag}</div>
        {/if}
        <div class="badge badge-outline badge-sm" title="Items in this list">{node.itemCount} items</div>

        <!-- Slot for Actions -->
        <slot name="actions"></slot>
    </div>
</div>

<style>
  /* Component-specific styles can go here */
</style> 