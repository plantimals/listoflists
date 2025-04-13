<script lang="ts">
  // Imports and props will be added in subsequent steps
  import type { ListItem, TreeNodeData } from '$lib/types'; // Add basic type import
  import ItemWrapper from './ItemWrapper.svelte';
  import Nip05Item from './Nip05Item.svelte'; // <-- Import the new component
  import { isOnline } from '$lib/networkStatusStore'; // Import the store
  import type { Nip05VerificationStateType } from '$lib/types'; // <-- Import the type from $lib/types
  import { createEventDispatcher } from 'svelte';

  // Add props as needed, starting with node for components that need it directly
  export let node: TreeNodeData; // Example: uncomment if needed
  export let level: number; // Pass level down for correct padding
  export let verificationStates: { [id: string]: Nip05VerificationStateType }; // <-- Add prop

  const dispatch = createEventDispatcher();

  console.log('Component initialized:', 'NodeItemsList', node);

  // Remove the incorrect reactive declarations
  // $: listId = node.listEvent?.id ?? 'unknown-list-id';
  // $: listPubkey = node.listEvent?.pubkey ?? 'unknown-pubkey';
</script>

<!-- Render Items when Expanded (logic moved from TreeNode) -->
<div class="pl-6" style="padding-left: {level * 1.5 + 1.5}rem;">
    {#each node.items as item (item.value)} <!-- Use item.value as key -->
        {#if item.type === 'p' || item.type === 'e' || item.type === 'a'}
          <!-- Handle standard p, e, a items with ItemWrapper -->
          <ItemWrapper
                  item={item}
                  listId={node.eventId}
                  listPubkey={node.pubkey}
                  on:viewprofile={(event) => dispatch('viewprofile', event.detail)}
                  on:viewevent={(event) => dispatch('viewevent', event.detail)}
                  />
        {:else if item.type === 'nip05'}
          <!-- Handle NIP05 items with the new component -->
          {@const nip05Item = item as Extract<ListItem, { type: 'nip05' }>}
          <Nip05Item 
            item={nip05Item}
            listId={node.eventId}
            isOnline={$isOnline}
            status={verificationStates[nip05Item.identifier]?.status || 'idle'}
            newlyResolvedNpub={verificationStates[nip05Item.identifier]?.newlyResolvedNpub || null}
            errorMsg={verificationStates[nip05Item.identifier]?.errorMsg || null}
            on:checknip05
          />
        {/if}
    {/each}
</div>

<style>
  /* Component-specific styles can go here */
</style> 