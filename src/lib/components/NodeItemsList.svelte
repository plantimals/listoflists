<script lang="ts">
  // Imports and props will be added in subsequent steps
  import type { TreeNodeData } from '$lib/types'; // Add basic type import
  import ItemWrapper from './ItemWrapper.svelte';
  import { isOnline } from '$lib/networkStatusStore'; // Import the store

  // Add props as needed, starting with node for components that need it directly
  export let node: TreeNodeData; // Example: uncomment if needed
  export let level: number; // Pass level down for correct padding

  console.log('Component initialized:', 'NodeItemsList');
</script>

<!-- Render Items when Expanded (logic moved from TreeNode) -->
<div class="pl-6" style="padding-left: {level * 1.5 + 1.5}rem;">
    {#each node.items as item (item.value)} <!-- Use item.value as key -->
        <!-- Removed old flex container, ItemWrapper now provides it -->
        <ItemWrapper
                {item}
                listId={node.eventId}
                listPubkey={node.pubkey}
                isOnline={$isOnline}
                />
    {/each}
</div>

<style>
  /* Component-specific styles can go here */
</style> 