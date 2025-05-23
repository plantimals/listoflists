<script lang="ts">
    import { onMount, createEventDispatcher } from 'svelte';
    import { get } from 'svelte/store';
    import { ndkService } from '$lib/ndkService';
    import { localDb, type StoredEvent } from '$lib/localDb';
    import type { NDKEvent } from '@nostr-dev-kit/ndk';

    /**
     * The event ID (hex) of the note to display.
     */
    export let eventId: string;

    let noteData: StoredEvent | null = null;
    let isLoading: boolean = true;

    // Create dispatcher
    const dispatch = createEventDispatcher();

    // Shortened event ID for display
    $: shortEventId = eventId ? `${eventId.substring(0, 8)}...${eventId.substring(eventId.length - 4)}` : 'invalid eventId';

    onMount(async () => {
        isLoading = true;
        noteData = null;

        if (!eventId) {
            console.error('NoteItem: No eventId provided.');
            isLoading = false;
            return;
        }

        console.debug(`NoteItem (${shortEventId}): Mounting with eventId:`, eventId);

        try {
            // 1. Try Local First
            console.debug(`NoteItem (${shortEventId}): Checking local DB...`);
            const localEventData = await localDb.getEventById(eventId);
            console.debug(`NoteItem (${shortEventId}): Local DB result:`, localEventData);

            if (localEventData) {
                console.debug(`NoteItem (${shortEventId}): Found event in local DB.`);
                noteData = localEventData;
                isLoading = false;
                return; // Found locally
            }

            // 2. Not found locally - Fetch from Network
            console.log(`NoteItem (${eventId.substring(0, 6)}): Fetching from network...`);

            try {
                const filter = { ids: [eventId] };
                // Fetch using service
                const fetchedEvent = await ndkService.fetchEvent(filter);

                if (fetchedEvent) {
                    console.log(`NoteItem (${eventId.substring(0, 6)}): Fetched note from network.`);
                    // 3. Convert NDKEvent to StoredEvent and Save to DB
                    const storedEventData: StoredEvent = {
                        id: fetchedEvent.id,
                        kind: fetchedEvent.kind,
                        pubkey: fetchedEvent.pubkey,
                        created_at: fetchedEvent.created_at ?? 0,
                        tags: fetchedEvent.tags,
                        content: fetchedEvent.content,
                        sig: fetchedEvent.sig ?? '',
                        // Add dTag for future use if needed, though less common for kind 1
                        dTag: (fetchedEvent.kind >= 30000 && fetchedEvent.kind < 40000) ? fetchedEvent.tags.find(t => t[0] === 'd')?.[1] : undefined,
                        // Mark as published since we fetched it
                        published: true,
                    };
                    console.debug(`NoteItem (${shortEventId}): Saving fetched event to DB...`, storedEventData);
                    await localDb.addOrUpdateEvent(storedEventData);
                    console.debug(`NoteItem (${shortEventId}): Saved fetched event.`);

                    // 4. Update component state with the (now stored) data
                    noteData = storedEventData;

                } else {
                    console.debug(`NoteItem (${shortEventId}): No event found on network.`);
                    noteData = null; // Ensure null if not found
                }
            } catch (networkError) {
                console.error(`NoteItem (${shortEventId}): Network fetch/save Error:`, networkError);
                noteData = null; // Ensure null on error
            } finally {
                 isLoading = false; // Stop loading indicator after network attempt
            }

        } catch (dbError) {
            console.error(`NoteItem (${shortEventId}): Initial DB check Error:`, dbError);
            isLoading = false; // Ensure loading stops on initial DB error too
        }
    });

</script>

<div
    class="py-1 pl-2 border-l-2 border-base-300 ml-1 cursor-pointer hover:bg-base-200"
    on:click={() => dispatch('viewevent', { eventId })}
>
    {#if isLoading}
        <span class="loading loading-spinner loading-xs"></span>
        <span class="text-xs italic text-base-content/50 ml-1">Loading note...</span>
    {:else if noteData}
        <p class="text-sm text-base-content/80 line-clamp-2 break-words" title={noteData.content}>
            {noteData.content || "(Empty note content)"}
        </p>
        <!-- TODO: Add author info using UserItem component -->
        <!-- Need to pass noteData.pubkey to UserItem -->
        <!-- <UserItem pubkey={noteData.pubkey} /> -->
    {:else}
        <p class="text-xs text-base-content/50 italic">
            Note <code class="font-mono">{shortEventId}</code> not found.
        </p>
    {/if}
</div> 