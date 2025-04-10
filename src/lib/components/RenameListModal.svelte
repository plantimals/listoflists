<script lang="ts">
    import { renameList } from '$lib/listService';
    import { refreshTrigger } from '$lib/refreshStore';
    import { onMount } from 'svelte';

    // Props
    export let currentListId: string | null = null;
    export let currentListName: string = '';

    // State
    let newName: string = '';
    let isSaving: boolean = false;
    let errorMessage: string | null = null;
    let dialogElement: HTMLDialogElement;

    // Reactive assignment: Update newName when currentListName changes
    $: newName = currentListName;

    async function saveRename() {
        if (!currentListId) {
            errorMessage = 'Error: List ID is missing.';
            return;
        }
        const trimmedName = newName.trim();
        if (!trimmedName) {
            errorMessage = 'List name cannot be empty.';
            return;
        }

        isSaving = true;
        errorMessage = null;

        try {
            const result = await renameList(currentListId, trimmedName);
            if (result.success) {
                console.log(`List ${currentListId} renamed successfully to ${trimmedName}, new event: ${result.newEventId}`);
                refreshTrigger.update(n => n + 1); // Trigger global refresh
                dialogElement.close(); // Close modal on success
            } else {
                errorMessage = result.error || 'Failed to rename list.';
            }
        } catch (err: any) {
            console.error("Error calling renameList:", err);
            errorMessage = err.message || 'An unexpected error occurred during rename.';
        } finally {
            isSaving = false;
        }
    }

    function handleClose() {
        // Reset state when the dialog closes
        errorMessage = null;
        isSaving = false;
        // newName is reactively set by currentListName, no need to reset here explicitly unless desired
        // currentListId = null; // Let the parent handle resetting props if needed
        // currentListName = '';
        console.log("Rename modal closed, state reset.");
    }

    function cancelAndClose() {
        if (dialogElement) {
            dialogElement.close();
        }
    }

    // Expose the close method if needed externally (usually not required with direct DOM manipulation)
    // export function close() {
    //     dialogElement?.close();
    // }

</script>

<dialog id="rename_list_modal" class="modal" bind:this={dialogElement} on:close={handleClose}>
    <div class="modal-box">
        <h3 class="font-bold text-lg">Rename List</h3>

        <form method="dialog" on:submit|preventDefault={saveRename}>
            <div class="py-4">
                <label for="list-new-name" class="label">
                    <span class="label-text">New list name:</span>
                </label>
                <input
                    id="list-new-name"
                    type="text"
                    placeholder="Enter new name"
                    class="input input-bordered w-full"
                    bind:value={newName}
                    required
                    disabled={isSaving}
                />
                {#if errorMessage}
                    <p class="text-error text-sm mt-2">{errorMessage}</p>
                {/if}
            </div>

            <div class="modal-action">
                <!-- Cancel Button -->
                <button class="btn" type="button" on:click={cancelAndClose} disabled={isSaving}>
                    Cancel
                </button>
                <!-- Save Button -->
                <button class="btn btn-primary" type="submit" disabled={isSaving || !newName.trim()}>
                    {#if isSaving}
                        <span class="loading loading-spinner loading-sm"></span> Saving...
                    {:else}
                        Save Changes
                    {/if}
                </button>
            </div>
        </form>
    </div>
    <!-- Optional: Click outside to close -->
    <form method="dialog" class="modal-backdrop">
        <button>close</button>
    </form>
</dialog> 