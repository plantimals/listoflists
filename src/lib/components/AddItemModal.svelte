<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    // import { get } from 'svelte/store'; // Remove if only used for ndk
    // import { ndk } from '$lib/ndkStore'; // Removed
    import { ndkService } from '$lib/ndkService'; // Added
    import { NDKEvent, type NDKTag, NDKList } from '@nostr-dev-kit/ndk';
    import { nip19 } from 'nostr-tools';
    import { localDb } from '$lib/localDb';
    import { addItemToList } from '$lib/listService'; // Removed ListServiceDependencies import

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

    let itemInput: string = '';
    let isSaving: boolean = false;
    let errorMessage: string | null = null;

    const dispatch = createEventDispatcher();

    async function saveAddItem() {
        console.log(`AddItemModal -> saveAddItem START: Current prop values - targetListId = ${targetListId}, targetListName = ${targetListName}, itemInput = ${itemInput}`);
        if (!targetListId || !itemInput.trim()) {
            errorMessage = 'Missing list context or item value.';
            return;
        }
        isSaving = true;
        errorMessage = null;

        const signer = ndkService.getSigner();
        if (!signer) {
            errorMessage = 'Signer not available. Cannot save item.';
            isSaving = false;
            return;
        }
        const ndkInstanceForEvent = ndkService.getNdkInstance();
        if (!ndkInstanceForEvent) {
            errorMessage = 'NDK instance not available for event creation.';
            isSaving = false;
            return;
        }

        const trimmedInput = itemInput.trim();
        try {
            const result = await addItemToList(targetListId, trimmedInput);
            if (result.success) {
                console.log(`AddItemModal: Item added successfully. Dispatching 'itemadded'.`);
                dispatch('itemadded');
            } else {
                console.error(`AddItemModal: Failed to add item:`, result.error);
                errorMessage = result.error || 'Failed to add item. Unknown error.';
            }
        } catch (error) {
            console.error(`AddItemModal: Unexpected error adding item:`, error);
            errorMessage = 'An unexpected error occurred while saving.';
        } finally {
            isSaving = false;
        }
    }

    function handleClose() {
        console.log("AddItemModal: Dialog 'close' event triggered. Resetting state.");
        if (itemInput !== '' || errorMessage !== null || isSaving !== false) {
            itemInput = '';
            errorMessage = null;
            isSaving = false;
        }
    }
</script>

<!-- Ensure dialog has the correct ID and on:close handler -->
<dialog id="add_item_modal" class="modal" on:close={handleClose}>
    <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Add Item to '{targetListName || 'List'}'</h3>

        {#if errorMessage}
            <div class="alert alert-error mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Error: {errorMessage}</span>
            </div>
        {/if}

        <textarea
            class="textarea textarea-bordered w-full"
            rows="3"
            placeholder="Enter npub, naddr, note1, nevent, hex ID, coordinate (kind:pubkey:dTag), or NIP-05 (user@domain.com)..."
            bind:value={itemInput}
            disabled={isSaving}
        ></textarea>

        <div class="modal-action">
            <!-- Standard DaisyUI close button using form method="dialog" -->
            <form method="dialog">
                 <button class="btn" disabled={isSaving}>Close</button>
             </form>
            <button
                class="btn btn-primary"
                on:click={saveAddItem}
                disabled={isSaving || !itemInput.trim()}
            >
                {#if isSaving}
                    <span class="loading loading-spinner loading-xs"></span> Saving...
                {:else}
                    Save Item
                {/if}
            </button>
        </div>
    </div>
    <!-- Standard backdrop closing mechanism -->
    <form method="dialog" class="modal-backdrop">
        <button disabled={isSaving}>close</button>
    </form>
</dialog> 