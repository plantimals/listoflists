<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let open = false; // Controlled by the parent
  // Add the userLists prop
  export let userLists: Array<{ id: string, name: string }> = [];

  // Dispatcher for events
  const dispatch = createEventDispatcher<{
    // Update the event detail to use destinationListId
    listselected: { destinationListId: string };
    close: void;
  }>();

  let dialogElement: HTMLDialogElement | null = null;
  // Add state to track selection
  let selectedListId: string | null = null;

  // Reactive statement to control the modal's visibility based on the 'open' prop
  $: {
    if (dialogElement) {
      if (open && !dialogElement.open) {
        console.log("SelectListModal: Opening modal programmatically.");
        dialogElement.showModal();
      } else if (!open && dialogElement.open) {
        console.log("SelectListModal: Closing modal programmatically.");
        dialogElement.close();
      }
    }
  }

  // Handle the dialog's native 'close' event
  function handleClose() {
    console.log("SelectListModal: Dialog close event triggered, resetting state.");
    selectedListId = null; // Reset selection on any close
    if (open) {
      open = false;
      dispatch('close');
    }
  }

  function handleCancel() {
    console.log("SelectListModal: Cancel button clicked.");
    // The form method="dialog" handles closing, which triggers handleClose
    // No need to manually call close or reset here, handleClose takes care of it.
  }

  // Function to handle confirmation
  function confirmSelection() {
    if (selectedListId) {
        console.log(`SelectListModal: Confirming selection, dispatching listselected with ID: ${selectedListId}`);
        // Dispatch the updated event structure
        dispatch('listselected', { destinationListId: selectedListId });
        // No need to manually close; parent will likely set open=false
        // If we want it to close immediately:
        if (dialogElement) dialogElement.close(); // Triggers handleClose
    } else {
        console.warn("SelectListModal: Confirm clicked but no list selected.");
    }
  }

</script>

<!-- DaisyUI Modal Structure -->
<dialog bind:this={dialogElement} id="select_list_modal" class="modal" on:close={handleClose}>
  <div class="modal-box">
    <h3 class="font-bold text-lg">Select Destination List</h3>

    <!-- Display User's Lists -->
    <div class="py-4 space-y-2 max-h-60 overflow-y-auto border-y border-base-300 my-4">
      {#if userLists.length > 0}
        {#each userLists as list (list.id)}
          <div class="form-control">
            <label class="label cursor-pointer p-2 rounded hover:bg-base-200/50">
              <span class="label-text truncate pr-2">{list.name} <code class="text-xs text-base-content/60 font-mono">({list.id.split(':')[2] || 'list'})</code></span>
              <input
                type="radio"
                name="list-selection-radio"
                class="radio radio-primary flex-shrink-0"
                bind:group={selectedListId}
                value={list.id}
              />
            </label>
          </div>
        {/each}
      {:else}
        <p class="text-center italic text-base-content/70 py-4">You haven't created any lists yet.</p>
        <!-- Optionally link to create list functionality -->
      {/if}
    </div>

    <div class="modal-action">
      <!-- Close button using form method -->
      <form method="dialog">
        <button class="btn btn-ghost" on:click={handleCancel}>Cancel</button>
      </form>
      <!-- Confirm button, calls dedicated function -->
      <button
        class="btn btn-primary"
        on:click={confirmSelection}
        disabled={!selectedListId}
      >
        Confirm Selection
      </button>
    </div>
  </div>
  <!-- Optional: click outside to close -->
  <form method="dialog" class="modal-backdrop">
    <button>close</button>
  </form>
</dialog> 