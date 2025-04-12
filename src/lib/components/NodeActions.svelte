<script lang="ts">
  // Imports and props will be added in subsequent steps
  import type { TreeNodeData } from '$lib/types'; // Add basic type import
  import { createEventDispatcher } from 'svelte';
  import { Icon, PencilSquare, Trash, Plus, QueueList } from 'svelte-hero-icons';

  // Add props as needed, starting with node for components that need it directly
  export let node: TreeNodeData; // Needed for context if actions require node info later
  export let currentUserPubkey: string | null = null; // Pass $user?.pubkey as prop
  export let isOnline: boolean; // Pass $isOnline as prop
  export let isRootNode: boolean = false;
  export let isEditingName: boolean = false;

  // State for button loading (delete button)
  export let isDeleting: boolean = false; // Pass isDeleting state down if managed by TreeNode

  const dispatch = createEventDispatcher<{
    additem: { parentId: string };
    deletelist: { listNodeId: string; listName: string };
    renamelist: { listNodeId: string; currentName: string };
    viewprofile: { npub: string }; // Ensure this still exists if used elsewhere
    viewfeed: { listNodeId: string; listName: string };
  }>();

  function handleAdd() {
    dispatch('additem', { parentId: node.id });
  }
</script>

{#if node.pubkey === currentUserPubkey}
  <div class="flex items-center space-x-0.5">
    {#if !isRootNode}
      <button
        class="btn btn-ghost btn-xs p-1 text-base-content/70 hover:text-warning disabled:text-base-content/30"
        title="Rename List"
        on:click|stopPropagation={() =>
          dispatch('renamelist', { listNodeId: node.id, currentName: node.name })}
        disabled={isEditingName || isDeleting}
      >
        <Icon src={PencilSquare} class="w-4 h-4" />
      </button>
    {/if}
    <button
      class="btn btn-ghost btn-xs p-1 text-base-content/70 hover:text-success disabled:text-base-content/30"
      title="Add Item to List"
      on:click|stopPropagation={handleAdd}
      disabled={isDeleting}
    >
      <Icon src={Plus} class="w-4 h-4" />
    </button>
    <button
      class="btn btn-ghost btn-xs p-1 text-base-content/70 hover:text-info disabled:text-base-content/30"
      title="View Aggregated Feed"
      on:click|stopPropagation={() => dispatch('viewfeed', { listNodeId: node.id, listName: node.name })}
      disabled={!node.items || node.items.length === 0 || isDeleting}
    >
      <Icon src={QueueList} class="w-4 h-4" />
    </button>
    {#if !isRootNode}
      <button
        class="btn btn-ghost btn-xs p-1 text-base-content/70 hover:text-error disabled:text-base-content/30"
        title="Delete List"
        on:click|stopPropagation={() =>
          dispatch('deletelist', { listNodeId: node.id, listName: node.name })}
        disabled={isDeleting}
      >
        {#if isDeleting}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}
          <Icon src={Trash} class="w-4 h-4" />
        {/if}
      </button>
    {/if}
  </div>
{/if}

<style>
  /* Component-specific styles can go here */
</style> 