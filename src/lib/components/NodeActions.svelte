<script lang="ts">
  // Imports and props will be added in subsequent steps
  import type { TreeNodeData } from '$lib/types'; // Add basic type import
  import { Icon, PencilSquare, Trash } from 'svelte-hero-icons'; // Icons needed for buttons
  import { createEventDispatcher } from 'svelte';

  // Add props as needed, starting with node for components that need it directly
  export let node: TreeNodeData; // Needed for context if actions require node info later
  export let currentUserPubkey: string | null | undefined; // Pass $user?.pubkey as prop
  export let isOnline: boolean; // Pass $isOnline as prop

  // State for button loading (delete button)
  export let isDeleting: boolean = false; // Pass isDeleting state down if managed by TreeNode

  const dispatch = createEventDispatcher();

  console.log('Component initialized:', 'NodeActions');
</script>

{#if node.pubkey === currentUserPubkey}
    <div class="flex items-center space-x-1">
        <!-- Add Item Button -->
        <button
            class="btn btn-ghost btn-xs p-1 text-base-content/70 hover:text-accent disabled:text-base-content/30"
            title="Add item to this list"
            on:click|stopPropagation={() => dispatch('openadditem')}
            disabled={!isOnline}
        >
            +
        </button>
        <!-- Rename Button -->
        <button
            class="btn btn-ghost btn-xs p-1 text-base-content/70 hover:text-warning disabled:text-base-content/30"
            title="Rename this list"
            on:click|stopPropagation={() => dispatch('openrenamemodal')}
            disabled={!isOnline}
        >
            <Icon src={PencilSquare} class="w-4 h-4" />
        </button>
        <!-- Delete Button -->
            <button
                class="btn btn-ghost btn-xs p-1 text-base-content/70 hover:text-error disabled:text-base-content/30"
                title="Delete this list"
                on:click|stopPropagation={() => dispatch('deletelist')}
                disabled={!isOnline || isDeleting}
            >
                {#if isDeleting}
                    <span class="loading loading-spinner loading-xs"></span>
                {:else}
                    <Icon src={Trash} class="w-4 h-4" />
                {/if}
            </button>
    </div>
{/if}

<style>
  /* Component-specific styles can go here */
</style> 