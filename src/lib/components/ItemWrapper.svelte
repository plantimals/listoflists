<script lang="ts">
  import type { ListItem } from '$lib/types'; // Adjust import as needed
  import UserItem from '$lib/components/UserItem.svelte';
  import NoteItem from '$lib/components/NoteItem.svelte';
  import Nip05Item from '$lib/components/Nip05Item.svelte'; // Import the new component
  import AddressableItem from '$lib/components/AddressableItem.svelte'; // <-- Import this
  import { localDb, type StoredEvent } from '$lib/localDb';
  import { ndkService } from '$lib/ndkService';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { refreshTrigger } from '$lib/refreshStore';
  import { createEventDispatcher } from 'svelte'; // Removed CustomEvent import
  import { isOnline } from '$lib/networkStatusStore'; // <-- Import isOnline store

  export let item: ListItem;
  export let listId: string; // The ID (coordinate or event ID) of the parent list
  export let listPubkey: string; // The pubkey of the parent list owner

  let isRemovingItem: boolean = false; // Moved state from TreeNode
  let itemErrorMessage: string | null = null; // Local error message state
  const dispatch = createEventDispatcher();

  console.log('Component initialized:', 'ItemWrapper', item);

  // Moved from TreeNode.svelte
  async function handleRemoveItem() {
      isRemovingItem = true; // Use local state
      itemErrorMessage = null;

      const signer = ndkService.getSigner();
      const ndkInstanceForEvent = ndkService.getNdkInstance();

      if (!signer || !ndkInstanceForEvent) {
          itemErrorMessage = 'Signer or NDK instance not available.';
          console.error(itemErrorMessage);
          isRemovingItem = false;
          return;
      }
      
      try {
          // Use listId prop here
          const originalListEventData = await localDb.getEventById(listId);
          if (!originalListEventData) {
              throw new Error(`Original list event ${listId} not found locally.`);
          }

          const newListEvent = new NDKEvent(ndkInstanceForEvent);
          newListEvent.kind = originalListEventData.kind;
          newListEvent.content = originalListEventData.content;

          // Filter out the tag to be removed using item prop
          newListEvent.tags = originalListEventData.tags.filter(tag => !(tag[0] === item.type && tag[1] === item.value));

          // Re-add replaceable list identifier tags
          const dTagValue = originalListEventData.tags.find(tag => tag[0] === 'd')?.[1];
          if (dTagValue && !newListEvent.tags.some(tag => tag[0] === 'd')) {
              newListEvent.tags.push(['d', dTagValue]);
          }
           const titleValue = originalListEventData.tags.find(tag => tag[0] === 'title')?.[1];
            if (titleValue && !newListEvent.tags.some(tag => tag[0] === 'title')) {
               newListEvent.tags.push(['title', titleValue]);
           }

          await newListEvent.sign(signer);
          console.log('Signed event after item removal:', newListEvent);

          const storedEventData: StoredEvent = {
              id: newListEvent.id,
              kind: newListEvent.kind,
              pubkey: newListEvent.pubkey,
              created_at: newListEvent.created_at ?? 0,
              tags: newListEvent.tags,
              content: newListEvent.content,
              sig: newListEvent.sig ?? '',
              dTag: dTagValue, 
              published: false
          };
          await localDb.addOrUpdateEvent(storedEventData);
          console.log('Updated list event saved locally.');

          // Don't dispatch itemremoved, refreshTrigger handles UI update
          refreshTrigger.update(n => n + 1);

      } catch (err: any) {
          console.error('Error removing item:', err);
          itemErrorMessage = `Failed to remove item: ${err.message}`;
          // Optionally dispatch an error event if parent needs to know
          // dispatch('removeerror', { error: itemErrorMessage });
      } finally {
          isRemovingItem = false; // Use local state
      }
  }

</script>

<div class="flex items-center py-1 hover:bg-base-300 rounded text-sm">
    <!-- Item Display Logic -->
    {#if item.type === 'p'}
        <UserItem pubkey={item.value} on:viewprofile={(event) => dispatch('viewprofile', event.detail)} />
    {:else if item.type === 'e'}
        <NoteItem eventId={item.value} on:viewevent={(event) => dispatch('viewevent', event.detail)} />
    {:else if item.type === 'nip05'}
        <Nip05Item item={item} listId={listId} isOnline={$isOnline} />
    {:else if item.type === 'a'}
        <AddressableItem coordinate={item.value} isOnline={$isOnline} />
    {/if}

    <!-- Remove Item Button -->
    <button
        class="btn btn-xs btn-ghost text-error ml-auto mr-1"
        on:click={handleRemoveItem}
        disabled={isRemovingItem || !$isOnline}
        title={!$isOnline ? 'Cannot remove item while offline' : (isRemovingItem ? 'Removing...' : 'Remove item')}
    >
        {#if isRemovingItem}
            <span class="loading loading-spinner loading-xs"></span>
        {:else}
            ✕
        {/if}
    </button>
</div>

{#if itemErrorMessage}
    <div class="text-error text-xs pl-2">{itemErrorMessage}</div>
{/if}

<style>
  /* Component-specific styles can go here */
</style> 