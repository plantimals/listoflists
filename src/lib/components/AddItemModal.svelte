<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { get } from 'svelte/store';
    import { user } from '$lib/userStore';
    import { ndk } from '$lib/ndkStore';
    import { addItemToList, type ListServiceDependencies } from '$lib/listService';
    import { refreshTrigger } from '$lib/refreshStore'; // Import refresh trigger

    export let targetListId: string; // The event ID of the list to add to

    const dispatch = createEventDispatcher();

    let itemType: 'p' | 'e' = 'p'; // Default to 'p' (profile)
    let itemValue: string = '';
    let isSaving: boolean = false;
    let errorMessage: string | null = null;

    const modalId = `add_item_modal_${targetListId || Math.random().toString(36).substring(7)}`; // Unique enough ID

    function closeModal() {
        const modal = document.getElementById(modalId) as HTMLDialogElement | null;
        modal?.close();
        // Reset state when closing
        itemType = 'p';
        itemValue = '';
        errorMessage = null;
        isSaving = false; // Ensure saving state is reset
    }

    async function saveAddItem() {
        if (!itemValue.trim()) {
            errorMessage = 'Item value cannot be empty.';
            return;
        }
        if (!targetListId) {
             errorMessage = 'Target list ID is missing.';
             return;
        }

        // Basic validation (improve as needed)
        if (itemType === 'p' && (itemValue.length !== 64 || !/^[0-9a-f]+$/.test(itemValue))) {
            errorMessage = 'Invalid pubkey format (must be 64 hex characters).';
            return;
        }
         if (itemType === 'e' && (itemValue.length !== 64 || !/^[0-9a-f]+$/.test(itemValue))) {
            // Could add bech32 validation later if needed for event IDs
            errorMessage = 'Invalid event ID format (must be 64 hex characters).';
            return;
        }


        errorMessage = null;
        isSaving = true;

        const currentUser = get(user);
        const ndkInstance = get(ndk);

        if (!currentUser || !ndkInstance) {
            errorMessage = 'User or NDK instance not available. Please log in.';
            isSaving = false;
            return;
        }

        const deps: ListServiceDependencies = { currentUser, ndkInstance };
        const itemToAdd = { type: itemType, value: itemValue.trim() };

        try {
            const result = await addItemToList(targetListId, itemToAdd, deps);

            if (result.success) {
                console.log(`Item ${itemToAdd.type}:${itemToAdd.value} added locally to list ${targetListId}. Triggering refresh.`);
                refreshTrigger.update(n => n + 1); // Trigger global refresh
                closeModal(); // Close modal on success
            } else {
                errorMessage = `Failed to add item: ${result.error || 'Unknown error'}`;
            }
        } catch (error: any) {
            console.error(`Error calling addItemToList for list ${targetListId}:`, error);
            errorMessage = `An unexpected error occurred: ${error.message || error}`;
        } finally {
            isSaving = false;
        }
    }

     // Public method to open the modal
    export function open() {
        const modal = document.getElementById(modalId) as HTMLDialogElement | null;
        modal?.showModal();
    }

</script>

<dialog id="{modalId}" class="modal modal-bottom sm:modal-middle">
    <div class="modal-box">
        <h3 class="font-bold text-lg">Add Item to List</h3>

        <form method="dialog" on:submit|preventDefault={saveAddItem}>
             <!-- Close button (form method="dialog" handles closing) -->
             <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" type="button" on:click={closeModal}>✕</button>

            <div class="py-4 space-y-4">
                <!-- Item Type Selection -->
                <div>
                    <label class="label">
                        <span class="label-text">Item Type</span>
                    </label>
                    <div class="flex space-x-4">
                        <label class="label cursor-pointer">
                            <input type="radio" name="itemType" class="radio checked:bg-primary" value="p" bind:group={itemType} />
                            <span class="label-text ml-2">Profile (pubkey)</span>
                        </label>
                        <label class="label cursor-pointer">
                            <input type="radio" name="itemType" class="radio checked:bg-secondary" value="e" bind:group={itemType} />
                            <span class="label-text ml-2">Event (ID)</span>
                        </label>
                    </div>
                </div>

                <!-- Item Value Input -->
                <div>
                    <label class="label" for="{modalId}_value">
                        <span class="label-text">{itemType === 'p' ? 'Public Key (hex)' : 'Event ID (hex)'}</span>
                    </label>
                    <input
                        type="text"
                        id="{modalId}_value"
                        bind:value={itemValue}
                        placeholder={itemType === 'p' ? 'Enter 64-char pubkey...' : 'Enter 64-char event ID...'}
                        class="input input-bordered w-full"
                        required
                        minlength="64"
                        maxlength="64"
                        pattern="^[0-9a-f]{64}$"
                        disabled={isSaving}
                    />
                </div>

                <!-- Error Message -->
                {#if errorMessage}
                    <div role="alert" class="alert alert-error text-sm p-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2 2m2-2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span>{errorMessage}</span>
                    </div>
                {/if}
            </div>

            <div class="modal-action">
                 <!-- Add type="submit" to the save button -->
                <button class="btn btn-primary" type="submit" disabled={isSaving}>
                    {#if isSaving}
                        <span class="loading loading-spinner"></span>
                        Saving...
                    {:else}
                        Save Item
                    {/if}
                </button>
                 <!-- Close button that resets state -->
                 <button class="btn" type="button" on:click={closeModal} disabled={isSaving}>Close</button>
            </div>
        </form>
    </div>
     <!-- Click outside to close -->
    <form method="dialog" class="modal-backdrop">
        <button on:click={closeModal}>close</button>
    </form>
</dialog> 