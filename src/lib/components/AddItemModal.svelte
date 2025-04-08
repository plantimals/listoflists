<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    // import { get } from 'svelte/store'; // Remove if only used for ndk
    // import { ndk } from '$lib/ndkStore'; // Removed
    import { ndkService } from '$lib/ndkService'; // Added
    import { NDKEvent, type NDKTag, NDKList } from '@nostr-dev-kit/ndk';
    import { nip19 } from 'nostr-tools';
    import { localDb } from '$lib/localDb';
    import { addItemToList, type ListServiceDependencies } from '$lib/listService';

    /**
     * The target list ID (a-tag coordinate or event ID) to add the item to.
     * Passed in when the modal is opened.
     */
    export let targetListId: string | null = null;
    /**
     * The display name of the target list.
     * Passed in when the modal is opened.
     */
    export let targetListName: string = '';

    $: {
        console.log(`AddItemModal: Received/Updated props - targetListId = ${targetListId}, targetListName = ${targetListName}`);
    }

    let itemInput: string = '';
    let isSaving: boolean = false;
    let errorMessage: string | null = null;

    const dispatch = createEventDispatcher();

    async function saveAddItem() {
        console.log(`AddItemModal -> saveAddItem START: Current prop values - targetListId = ${targetListId}, targetListName = ${targetListName}, itemInput = ${itemInput}`);

        if (!targetListId || !itemInput.trim()) {
            console.error(`AddItemModal -> saveAddItem ERROR: Check failed. targetListId=${targetListId}, itemInput=${itemInput}`);
            errorMessage = 'Missing list context or item value.';
            return;
        }

        isSaving = true;
        errorMessage = null;

        // const currentUser = get(user); // Removed
        // if (!currentUser) {
        //     errorMessage = 'User not available. Cannot save item.';
        //     isSaving = false;
        //     return;
        // }

        // const ndkInstance = get(ndk); // Removed
        // if (!ndkInstance) {
        //     errorMessage = 'NDK instance not available. Cannot save item.';
        //     isSaving = false;
        //     return;
        // }

        // Use NDK Service to get signer
        const signer = ndkService.getSigner();
        if (!signer) {
            errorMessage = 'Signer not available. Cannot save item.';
            isSaving = false;
            return;
        }

        // Use NDK Service to get the underlying NDK instance for event creation
        const ndkInstanceForEvent = ndkService.getNdkInstance();
        if (!ndkInstanceForEvent) {
            errorMessage = 'NDK instance not available for event creation.';
            isSaving = false;
            return;
        }

        const deps: ListServiceDependencies = { currentUser: null, ndkInstance: ndkInstanceForEvent };
        const trimmedInput = itemInput.trim();

        try {
            console.log(`AddItemModal: Calling addItemToList for list '${targetListId}' with input: '${trimmedInput}'`);
            const result = await addItemToList(targetListId, trimmedInput, deps);

            if (result.success) {
                console.log(`AddItemModal: Item added successfully to list '${targetListId}'.`);
                dispatch('itemadded');
                // Close the modal programmatically
                const modalElement = document.getElementById('add_item_modal') as HTMLDialogElement | null;
                modalElement?.close(); // This automatically triggers the handleClose via the 'close' event
                // Resetting state is handled in handleClose
            } else {
                console.error(`AddItemModal: Failed to add item to list '${targetListId}':`, result.error);
                errorMessage = result.error || 'Failed to add item. Unknown error.';
            }
        } catch (error) {
            console.error(`AddItemModal: Unexpected error adding item to list '${targetListId}':`, error);
            errorMessage = 'An unexpected error occurred while saving.';
        } finally {
            isSaving = false;
        }
    }

    function handleClose() {
        // Reset state when the modal is closed (either programmatically or via backdrop/close button)
        console.log('AddItemModal: Closing and resetting state.');
        itemInput = '';
        errorMessage = null;
        isSaving = false;
        // Resetting targetListId/Name is not strictly necessary here as they are props
        // but might be good practice if the parent doesn't always reset them before opening.
        // targetListId = null;
        // targetListName = '';
    }
</script>

<dialog id="add_item_modal" class="modal" on:close={handleClose}>
    <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Add Item to '{targetListName || 'List'}'</h3>

        {#if errorMessage}
            <div class="alert alert-error mb-4">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="stroke-current shrink-0 h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                </svg>
                <span>Error: {errorMessage}</span>
            </div>
        {/if}

        <textarea
            class="textarea textarea-bordered w-full"
            rows="3"
            placeholder="Enter npub, naddr, note1, nevent, hex ID, or coordinate (kind:pubkey:dTag)..."
            bind:value={itemInput}
            disabled={isSaving}
        ></textarea>

        <div class="modal-action">
            <form method="dialog">
                <!-- Standard close button -->
                <button class="btn" disabled={isSaving}>Close</button>
            </form>
            <button
                class="btn btn-primary"
                on:click={saveAddItem}
                disabled={isSaving || !itemInput.trim()}
            >
                {#if isSaving}
                    <span class="loading loading-spinner loading-xs"></span>
                    Saving...
                {:else}
                    Save Item
                {/if}
            </button>
        </div>
    </div>
    <!-- Modal Backdrop -->
    <form method="dialog" class="modal-backdrop">
        <!-- Clicking backdrop closes modal -->
        <button disabled={isSaving}>close</button>
    </form>
</dialog> 