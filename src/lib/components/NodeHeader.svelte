<script lang="ts">
  // Imports and props will be added in subsequent steps
  import type { TreeNodeData } from '$lib/types'; // Add basic type import
  // Removed Icon, PencilSquare, Trash imports as buttons moved
  // Removed user store import
  // Removed isOnline store import
  import { createEventDispatcher } from 'svelte';
  import { Icon, ChevronRight, ChevronDown } from 'svelte-hero-icons';

  // Add props as needed, starting with node for components that need it directly
  export let node: TreeNodeData; // Example: uncomment if needed
  export let depth: number = 0;
  export let isExpanded: boolean = true;
  export let isEditingName: boolean = false;
  export let editedName: string = '';
  export let inputRef: HTMLInputElement | null = null; // For focusing the input
  export let currentUserPubkey: string | null = null; // Added prop

  // Dispatch only events controlled by NodeHeader itself
  const dispatch = createEventDispatcher<{
    toggle: void; // For expanding/collapsing
    startedit: void; // Triggered by rename action 
    canceledit: void;
    submitname: string;
  }>();

  $: indent = depth * 1.5; // 1.5rem per depth level
  $: isExternal = !!(currentUserPubkey && node.pubkey && node.pubkey !== currentUserPubkey);

  console.log('Component initialized:', 'NodeHeader');

  // Local state/handlers needed by the header (e.g., isDeleting if handleDeleteList moves here)
  // let isDeleting = false; // Keep isDeleting state in TreeNode for now as handler is there

  function handleNodeClick() {
    // Clicking the header only toggles expansion if it has children/items
    // Profile viewing is triggered by clicking profile *items*, not the list header
    if ((node.children && node.children.length > 0) || (node.items && node.items.length > 0)) {
      dispatch('toggle');
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      dispatch('submitname', editedName);
    } else if (event.key === 'Escape') {
      dispatch('canceledit');
    }
  }

  // Removed forward functions for events originating in NodeActions
</script>

<!-- Main row for the node -->
<div
    class="flex items-center justify-between group py-1 pl-2 pr-1 rounded hover:bg-base-200 transition-colors duration-100 cursor-pointer relative"
    class:bg-base-300={isExternal}
    class:bg-opacity-30={isExternal}
    style="padding-left: calc({indent}rem + 0.5rem);"
>
    <!-- Change this div to a button for accessibility -->
    <button 
        type="button"
        class="flex items-center space-x-2 flex-grow min-w-0 text-left" 
        on:click={handleNodeClick}
    >
        {#if (node.children && node.children.length > 0) || (node.items && node.items.length > 0)}
            <!-- Changed inner button to a span, removed click handler -->
            <span
                class="btn btn-ghost btn-xs p-0 -ml-1 text-base-content/50 hover:text-base-content"
                title={isExpanded ? 'Collapse' : 'Expand'} 
            >
                <Icon src={isExpanded ? ChevronDown : ChevronRight} class="w-4 h-4" />
            </span>
        {:else}
            <span class="w-4 h-4 inline-block"></span> 
        {/if}

        {#if isEditingName}
            <input
                type="text"
                bind:this={inputRef}
                bind:value={editedName}
                class="input input-bordered input-xs w-full"
                on:keydown={handleKeyDown}
                on:blur={() => dispatch('canceledit')}
            />
        {:else}
            <!-- Display name with conditional (External) label -->
            <span class="truncate" title="{node.name}{isExternal ? ' (External)' : ''}">
                {node.name}
                {#if isExternal}
                    <span class="text-xs opacity-70 ml-1">(External)</span>
                {/if}
            </span>
        {/if}
    </button> <!-- End of the new button -->

    <!-- Badges -->
    <div class="flex items-center flex-shrink-0 space-x-1 ml-auto">
        {#if node.kind}
        <div class="badge badge-neutral badge-sm font-mono" title="Kind">K:{node.kind}</div>
        {/if}
        {#if node.dTag}
            <div class="badge badge-outline badge-sm font-mono" title="dTag">{node.dTag}</div>
        {/if}
        {#if node.itemCount !== undefined}
        <div class="badge badge-outline badge-sm" title="Items in this list">{node.itemCount} items</div>
        {/if}

        <!-- Slot for Actions -->
        {#if !isEditingName}
            <div
                class="flex-shrink-0 transition-opacity duration-100" 
            >
                <slot name="actions"></slot>
            </div>
        {/if}
    </div>
</div>

<style>
  /* Component-specific styles can go here */
</style> 