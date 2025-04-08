<script lang="ts">
  import { get } from 'svelte/store';
  import { user } from '$lib/userStore';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { createEventDispatcher } from 'svelte'; // Import event dispatcher
  import { localDb, type StoredEvent } from '$lib/localDb'; // Import DB and StoredEvent type
  import { ndkService } from '$lib/ndkService'; // Added
  import { nip19 } from 'nostr-tools';

  let listName: string = '';
  let isSaving: boolean = false; // To disable button during processing
  let errorMessage: string | null = null;

  const dispatch = createEventDispatcher(); // Instantiate dispatcher

  async function saveNewList() {
    errorMessage = null;
    isSaving = true;
    let dTag: string = ''; // Define dTag here to use in conversion

    const currentUser = get(user);
    if (!currentUser) {
      errorMessage = 'Error: User not logged in.';
      console.error(errorMessage);
      isSaving = false;
      return;
    }

    // Get signer from service
    const signer = ndkService.getSigner();
    if (!signer) {
      errorMessage = 'Signer (e.g., NIP-07 extension) is not available. Cannot create list.';
      console.error(errorMessage);
      isSaving = false;
      return;
    }

    // Get raw NDK instance from service for event creation
    const ndkInstanceForEvent = ndkService.getNdkInstance();
    if (!ndkInstanceForEvent) {
      errorMessage = 'NDK instance not available for event creation.';
      console.error(errorMessage);
      isSaving = false;
      return;
    }

    dTag = listName.trim();
    if (!dTag) {
      errorMessage = 'List name cannot be empty.';
      isSaving = false;
      return;
    }

    // Create the event object
    const event = new NDKEvent(ndkInstanceForEvent);
    event.kind = 30001; // Kind for Categorized People List (adjust if needed)
    event.pubkey = currentUser.pubkey;
    event.created_at = Math.floor(Date.now() / 1000);
    event.tags = [
        ['d', dTag],
        ['title', dTag]
    ];
    event.content = '';

    console.log('Attempting to sign new list event...');

    try {
      // Sign the event via the signer from the service
      await event.sign(signer);
      console.log('List event signed:', event);

      // Publish the event via the service
      const publishedTo = await ndkService.publish(event);

      if (publishedTo.size === 0) {
        throw new Error('Event was not published to any relays.');
      }

      // --- L7.3: Convert and Save to DB --- 
      const storedEventData: StoredEvent = {
        id: event.id,
        kind: event.kind,
        pubkey: event.pubkey,
        created_at: event.created_at ?? 0,
        tags: event.tags,
        content: event.content,
        sig: event.sig ?? '',
        dTag: dTag, // Add dTag explicitly
        published: false // L6.1: Mark newly created list as unpublished
      };

      try {
        await localDb.addOrUpdateEvent(storedEventData);
        console.log('Saved new list to local DB', storedEventData);

        // Dispatch event to notify parent page to refresh
        dispatch('listcreated');

        // Close the modal
        const modalElement = document.getElementById('create_list_modal') as HTMLDialogElement | null;
        modalElement?.close();

        // Reset form
        listName = '';

      } catch (dbErr) {
        errorMessage = 'Failed to save the list locally.';
        console.error('Failed to save list to DB:', dbErr);
        // Keep modal open to show error
      }
      // --- End L7.3 Save Logic ---

    } catch (signErr) {
      errorMessage = 'Failed to sign the event. Check browser extension and permissions.';
      console.error('Signing failed:', signErr);
      // Keep modal open to show error
    } finally {
      isSaving = false;
    }
  }

</script>

<dialog id="create_list_modal" class="modal">
  <div class="modal-box">
    <h3 class="font-bold text-lg mb-4">Create New List</h3>

    <!-- Error Message Display -->
    {#if errorMessage}
      <div class="alert alert-error shadow-lg mb-4">
        <div>
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span>{errorMessage}</span>
        </div>
      </div>
    {/if}

    <div class="form-control w-full mb-4">
      <label class="label" for="listNameInput">
        <span class="label-text">List Name (used as 'd' tag)</span>
      </label>
      <input
        id="listNameInput"
        type="text"
        placeholder="e.g., 'my-cool-bookmarks' or 'Tech People'"
        class="input input-bordered w-full"
        bind:value={listName}
        disabled={isSaving}
      />
    </div>

    <p class="text-xs text-base-content/70 mb-4">(Kind 30003 - Bookmark List. Item addition comes later.)</p>

    <div class="modal-action">
      <button type="button" class="btn btn-primary" on:click={saveNewList} disabled={isSaving}>
        {#if isSaving}
          <span class="loading loading-spinner loading-xs"></span>
          Saving...
        {:else}
          Save List
        {/if}
      </button>
      <form method="dialog">
        <button class="btn" disabled={isSaving}>Close</button>
      </form>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button disabled={isSaving}>close</button> <!-- Disable backdrop close while saving -->
  </form>
</dialog> 