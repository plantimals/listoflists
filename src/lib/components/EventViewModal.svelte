<script lang="ts">
    import { onMount, createEventDispatcher } from 'svelte';
    import type { NDKEvent } from '@nostr-dev-kit/ndk';
    import { localDb, type StoredEvent } from '$lib/localDb';
    import { ndkService } from '$lib/ndkService';
    import UserItem from './UserItem.svelte'; // Import UserItem
    import { Icon, ClipboardDocument, CheckCircle } from 'svelte-hero-icons'; // Import icons
    import MarkdownIt from 'markdown-it'; // ADDED: Import markdown-it

    export let eventId: string | null = null;
    export let open: boolean = false;

    let isLoading = false;
    let error: string | null = null;
    let eventData: StoredEvent | NDKEvent | null = null; // Can hold data from DB or NDK fetch
    let copied = false; // State for copy feedback

    let dialogElement: HTMLDialogElement; // To control the dialog programmatically if needed

    const md = new MarkdownIt(); // ADDED: Instantiate markdown-it

    // Shortened event ID for display
    $: shortEventId = eventId
        ? eventId.length > 12
            ? `${eventId.substring(0, 8)}...${eventId.substring(eventId.length - 4)}`
            : eventId
        : 'N/A';

    // Reactive fetching when eventId changes and the modal is intended to be open
    $: if (eventId && open) {
        fetchEventData(eventId);
    } else if (!open) {
        // Reset state when modal closes
        eventData = null;
        error = null;
        isLoading = false;
        copied = false; // Reset copy state too
    }

    async function fetchEventData(id: string) {
        if (!id) return;
        console.log(`EventViewModal: Fetching data for eventId: ${id}`);
        isLoading = true;
        error = null;
        eventData = null;
        copied = false;

        try {
            // 1. Try Local First
            console.debug(`EventViewModal (${shortEventId}): Checking local DB...`);
            const localEvent = await localDb.getEventById(id);

            if (localEvent) {
                console.debug(`EventViewModal (${shortEventId}): Found event in local DB.`);
                eventData = localEvent;
                isLoading = false;
                return;
            }

            // 2. Fetch from Network
            console.log(`EventViewModal (${shortEventId}): Fetching from network...`);
            const filter = { ids: [id], limit: 1 };
            const fetchedEvent = await ndkService.fetchEvent(filter);

            if (fetchedEvent) {
                console.log(`EventViewModal (${shortEventId}): Fetched event from network.`);
                eventData = fetchedEvent; // Use the NDKEvent directly for display

                // Optionally save to local DB (might want to convert NDKEvent to StoredEvent first)
                // This part is optional based on whether you want to cache *all* viewed events
                // const storedEventData: StoredEvent = { ... }; // Conversion logic
                // await localDb.addOrUpdateEvent(storedEventData);

            } else {
                console.debug(`EventViewModal (${shortEventId}): Event not found on network.`);
                error = "Event not found.";
            }
        } catch (err) {
            console.error(`EventViewModal (${shortEventId}): Error fetching event data:`, err);
            error = "Failed to load event details.";
            if (err instanceof Error) {
                error += ` ${err.message}`;
            }
        } finally {
            isLoading = false;
            // Ensure the dialog is open if fetching finished while 'open' is true
            if (open && dialogElement && !dialogElement.open) {
                 dialogElement.showModal();
            }
        }
    }

    // Function to copy full event ID
    async function copyEventIdToClipboard() {
        if (!eventId) {
            console.error("Cannot copy: eventId is null.");
            return;
        }
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
            console.error("Clipboard API not available.");
            // Consider showing a user-facing message here
            return;
        }

        try {
            await navigator.clipboard.writeText(eventId);
            console.log("Event ID copied to clipboard:", eventId);
            copied = true;
            setTimeout(() => { copied = false; }, 1500);
        } catch (err) {
            console.error("Failed to copy Event ID:", err);
            // Consider showing a user-facing message here
        }
    }

    // Function to close the modal (can be called by buttons or clicking backdrop)
    function closeModal() {
        if (dialogElement) {
            dialogElement.close();
            // Optionally dispatch an event or update a prop to signal closure
            // dispatch('close'); // Example
        }
    }

     // Sync dialog state with 'open' prop
    $: if (dialogElement) {
        if (open && !dialogElement.open) {
            dialogElement.showModal();
        } else if (!open && dialogElement.open) {
            dialogElement.close();
        }
    }

</script>

<dialog bind:this={dialogElement} class="modal" on:close={() => open = false}>
    <div class="modal-box w-11/12 max-w-2xl">
        {#if isLoading}
            <div class="flex justify-center items-center h-40">
                <span class="loading loading-spinner loading-lg"></span>
            </div>
        {:else if error}
            <h3 class="font-bold text-lg text-error">Error Loading Event</h3>
            <p class="py-4">{error}</p>
            <p class="text-sm text-base-content/50">Event ID: {shortEventId}</p>
        {:else if eventData}
            <!-- Event Author -->
            <div class="mb-4">
                <h3 class="font-bold text-lg mb-2">Event Details</h3>
                <UserItem pubkey={eventData.pubkey} />
            </div>

            <!-- Event Content -->
            <div class="bg-base-200 p-3 rounded-md mb-4">
                <p class="text-sm font-semibold mb-1">Content:</p>
                <div class="prose max-w-none text-base-content/90 break-words">
                    {@html md.render(eventData.content || '(No content)')}
                </div>
            </div>

            <!-- Event Metadata -->
            <div class="text-xs text-base-content/70 space-y-1">
                <p>
                    <span class="font-semibold">Timestamp:</span>
                    {#if eventData.created_at}
                        {new Date(eventData.created_at * 1000).toLocaleString()}
                    {:else}
                        N/A
                    {/if}
                </p>
                 <p>
                    <span class="font-semibold">Kind:</span> {eventData.kind ?? 'N/A'}
                </p>
                 <p class="flex items-center">
                    <span class="font-semibold mr-1">Event ID:</span>
                    <code class="font-mono" title={eventId}>{shortEventId}</code>
                    {#if eventId}
                        <button
                            class="btn btn-xs btn-ghost btn-square ml-1"
                            title={copied ? "Copied!" : "Copy full Event ID"}
                            on:click={copyEventIdToClipboard}
                            disabled={!navigator.clipboard}
                        >
                            {#if copied}
                                <Icon src={CheckCircle} class="h-4 w-4 text-success" />
                            {:else}
                                <Icon src={ClipboardDocument} class="h-4 w-4" />
                            {/if}
                        </button>
                    {/if}
                </p>
                 <!-- Optionally display other tags or info -->
            </div>

        {:else}
             <p class="py-4 text-center text-base-content/60">No event data to display.</p>
        {/if}

        <div class="modal-action">
            <form method="dialog">
                <button class="btn">Close</button>
            </form>
        </div>
    </div>
     <!-- Optional: Click outside to close -->
     <form method="dialog" class="modal-backdrop">
       <button>close</button>
     </form>
</dialog> 