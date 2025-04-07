<script lang="ts">
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { ndk } from '$lib/ndkStore';
    import { localDb, type StoredEvent } from '$lib/localDb';
    import type { NDKEvent } from '@nostr-dev-kit/ndk';

    /**
     * The event ID (hex) of the note to display.
     */
    export let eventId: string;

    let noteData: StoredEvent | null = null;
    let isLoading: boolean = true;

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

        console.log(`NoteItem (${shortEventId}): Checking local DB...`);
        try {
            // 1. Try Local First
            const localEventData = await localDb.getEventById(eventId);

            if (localEventData) {
                console.log(`NoteItem (${shortEventId}): Found event in local DB.`);
                noteData = localEventData;
                isLoading = false;
                return; // Found locally
            }

            // 2. Not Found Locally - Try Network
            console.log(`NoteItem (${shortEventId}): Not found locally. Fetching from network...`);
            const ndkInstance = get(ndk);
            if (!ndkInstance) {
                console.error(`NoteItem (${shortEventId}): NDK instance not available for network fetch.`);
                isLoading = false;
                return;
            }

            try {
                await ndkInstance.connect();
                // NDK's fetchEvent can take an ID directly or a filter { ids: [eventId] }
                const fetchedEvent: NDKEvent | null = await ndkInstance.fetchEvent(eventId);

                if (fetchedEvent) {
                    console.log(`NoteItem (${shortEventId}): Fetched event from network.`);
                    // 3. Convert NDKEvent to StoredEvent and Save to DB
                    const storedEventData: StoredEvent = {
                        id: fetchedEvent.id,
                        kind: fetchedEvent.kind,
                        pubkey: fetchedEvent.pubkey,
                        created_at: fetchedEvent.created_at ?? 0,
                        tags: fetchedEvent.tags,
                        content: fetchedEvent.content,
                        sig: fetchedEvent.sig ?? '',
                    };
                    await localDb.addOrUpdateEvent(storedEventData);
                    console.log(`NoteItem (${shortEventId}): Saved fetched event to local DB.`);

                    // 4. Update component state with the (now stored) data
                    noteData = storedEventData;

                } else {
                    console.log(`NoteItem (${shortEventId}): No event found on network.`);
                    noteData = null; // Ensure null if not found
                }
            } catch (networkError) {
                console.error(`NoteItem (${shortEventId}): Failed during network fetch or DB save:`, networkError);
                noteData = null; // Ensure null on error
            } finally {
                 isLoading = false; // Stop loading indicator after network attempt
            }

        } catch (error) {
            console.error(`NoteItem (${shortEventId}): Error during initial local DB check:`, error);
            isLoading = false; // Ensure loading stops on initial DB error too
        }
    });

</script>

<div class="py-1 pl-2 border-l-2 border-base-300 ml-1">
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