<script lang="ts">
  import { user } from '$lib/userStore';
  import { profile } from '$lib/profileStore';
  import { ndkService } from '$lib/ndkService';
  import { listHierarchy, isHierarchyLoading } from '$lib/hierarchyStore';
  import { buildHierarchy } from '$lib/hierarchyService';
  import { get } from 'svelte/store';
  import { refreshTrigger } from '$lib/refreshStore'; // <-- Import refresh trigger
  // import { Button } from '@skeletonlabs/skeleton'; // Removed Skeleton import
  // Separate NDK imports: Default and Named
  import { NDKEvent, type NDKUser, type NDKUserProfile, type NDKFilter, NDKNip07Signer, type NDKSigner, type NDKList } from '@nostr-dev-kit/ndk';
  import TreeNode from '$lib/components/TreeNode.svelte'; // Import the new component
  import type { TreeNodeData } from '$lib/types'; // Import the type
  import { localDb, type StoredEvent } from '$lib/localDb'; // Import localDb AND StoredEvent type
  import CreateListModal from '$lib/components/CreateListModal.svelte'; // Import the modal component
  import { browser } from '$app/environment'; // Import browser
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { nip19 } from 'nostr-tools';
  import AddItemModal from '$lib/components/AddItemModal.svelte'; // Import the Add Item modal

  let isLoadingProfile: boolean = false;
  let isLoadingInitialLists: boolean = false; // New state for the initial network fetch
  let isSyncing: boolean = false; // Add state for sync process
  let lastLoadedPubkey: string | null = null; // Guard against multiple triggers

  // Modal State
  let showCreateListModal = false;

  // Add Item Modal State
  let modalTargetListId: string | null = null;
  let modalTargetListName: string = '';
  let addItemModalInstance: AddItemModal; // Instance binding for AddItemModal

  let isLoading = writable(true); // Store for loading state
  let error: string | null = null; // Store for error messages

  let createListModalInstance: CreateListModal; // Instance binding

  // Mock data for testing TreeNode with nesting
  // const mockNestedNodeData: TreeNodeData = { ... };

  // ---- Refresh Trigger Subscription ----
  refreshTrigger.subscribe(value => {
    if (value > 0) { // Only trigger if incremented (initial value 0)
      const currentUser = get(user);
      if (currentUser?.pubkey && !isSyncing && !isLoadingInitialLists && !$isHierarchyLoading) {
        console.log('Refresh triggered! Reloading data...');
        // Re-use the main data loading function
        loadDataAndBuildHierarchy(currentUser.pubkey);
      }
    }
  });
  // -------------------------------------

  async function handleLogin() {
    const signer = ndkService.getSigner();

    if (!signer) {
      console.error('NDK Signer not available. Is a NIP-07 extension installed and enabled?');
      return;
    }

    try {
      console.log('Attempting NIP-07 login...');
      const loggedInUser: NDKUser = await signer.user();
      console.log('NIP-07 login successful:', loggedInUser);
      // Clear previous user data *before* setting the new user
      // This ensures the reactive block sees a change from null -> user
      // and also handles re-login scenarios cleanly.
      if (get(user)?.pubkey !== loggedInUser.pubkey) {
          profile.set(null);
          listHierarchy.set([]);
          isHierarchyLoading.set(false);
          isLoadingInitialLists = false;
          isLoadingProfile = false;
          isSyncing = false;
          lastLoadedPubkey = null; // Reset guard on new user login
      }
      user.set(loggedInUser); // This triggers reactive blocks
    } catch (error) {
      console.error('NIP-07 Login failed:', error);
    }
  }

  // Updated async function for L2.3: Ensure store reflects final DB state
  async function loadUserProfile(pubkey: string) {
      isLoadingProfile = true;
      let finalProfileToSet: NDKUserProfile | null = null; // Variable to hold the final state for the store

      try {
          // --- Initial local check (Optional: for logging or very quick UI update if desired) ---
          console.log('Attempting initial load from local DB for pubkey:', pubkey);
          const initialLocalProfileData = await localDb.getProfile(pubkey);
          if (initialLocalProfileData?.profile) {
              console.log('Profile found locally initially:', initialLocalProfileData.profile);
              // Optional: could set profile store here for instant UI update, but will be overwritten in finally
              // profile.set(initialLocalProfileData.profile as NDKUserProfile);
          } else {
              console.log('Profile not found locally initially or data empty.');
              // Optional: could clear profile store here
              // profile.set(null);
          }
          // --- End Initial Local Check ---


          // --- Network Fetch & DB Update Logic ---
          const profileFilter: NDKFilter = { kinds: [0], authors: [pubkey], limit: 1 };

          try {
              // Connect NDK if not already connected
              // await ndkInstance.connect(); // Removed - fetchEvent will ensure connection
              const fetchedEvent: NDKEvent | null = await ndkService.fetchEvent(profileFilter);

              if (fetchedEvent) {
                  console.log('Profile event fetched from network:', fetchedEvent);
                  const storedEventData: StoredEvent = {
                      id: fetchedEvent.id,
                      kind: fetchedEvent.kind,
                      pubkey: fetchedEvent.pubkey,
                      created_at: fetchedEvent.created_at ?? 0,
                      tags: fetchedEvent.tags,
                      content: fetchedEvent.content,
                      sig: fetchedEvent.sig ?? '',
                  };
                  // Attempt to update the profile in the DB
                  await localDb.addOrUpdateProfile(storedEventData);
                  console.log('Profile event sent to DB update.');
              } else {
                  console.log('No Kind 0 profile event found on network for pubkey:', pubkey);
              }
          } catch (networkError) {
              console.error('Failed to fetch or process profile event from network:', networkError);
              // Proceed to finally block even if network fails
          }
      } catch (error) {
          // Catch errors from the initial local DB read or other unexpected issues
          console.error('Error during profile loading sequence (before finally):', error);
      } finally {
          // --- Final Read from DB and Store Update ---
          console.log('Re-reading profile from local DB to set final state...');
          try {
              const finalProfileData = await localDb.getProfile(pubkey);
              if (finalProfileData?.profile) {
                  finalProfileToSet = finalProfileData.profile as NDKUserProfile;
                  console.log('Final profile state read from DB:', finalProfileToSet);
              } else {
                  finalProfileToSet = null;
                  console.log('Profile not found in DB or data empty for final state.');
              }
          } catch (dbReadError) {
               console.error('Error reading final profile state from local DB:', dbReadError);
               finalProfileToSet = null; // Ensure profile is null on final DB error
          }

          // Update the store with the definitive data from the DB
          profile.set(finalProfileToSet);
          console.log("Profile store updated with final state:", finalProfileToSet);

          // Set loading false only after all operations and the final store update
          isLoadingProfile = false;
          console.log("Profile loading sequence finished.");
          // --- End Final Read and Store Update ---
      }
  }

  // Fetches lists from network and stores them in DB
  async function fetchAndStoreUserLists(pubkey: string) {
    console.log(`Starting list fetch & store process for pubkey: ${pubkey}`);

    const listFilter: NDKFilter = {
        authors: [pubkey],
        kinds: [
            10000, // Mute List (Replaceable)
            10001, // Pin List (Replaceable, Kind:Parameterized Replaceable List)
            // 10002, // Relay List Metadata (Replaceable)
            30000, // Follow Set (Replaceable)
            30001, // Categorized People List (Kind:Parameterized Replaceable List)
            30003, // Categorized Bookmark List (Kind:Parameterized Replaceable List)
            // 30002, // Categorized Relay List (Kind:Parameterized Replaceable List)
            // NIP-51 recommends using 30000-39999 for Sets/Lists
        ]
    };

    try {
        // Ensure NDK is connected
        // await ndkInstance.connect(); // Removed - fetchEvents will ensure connection
        console.log('NDK service will connect if needed, fetching lists with filter:', listFilter);

        // Fetch events using the service
        const fetchedListEventsSet = await ndkService.fetchEvents(listFilter);
        console.log(`Fetched ${fetchedListEventsSet.size} list events from network for user ${pubkey}.`);

        if (fetchedListEventsSet.size > 0) {
             // Convert Set to Array
            const eventsToStore = Array.from(fetchedListEventsSet);

            // Convert NDKEvent to StoredEvent and save Each Event using the method designed in L1.2
            // It handles replaceables internally based on created_at and kind
            const storePromises = eventsToStore.map(event => {
                const storedEventData: StoredEvent = {
                    id: event.id,
                    kind: event.kind,
                    pubkey: event.pubkey,
                    created_at: event.created_at ?? 0,
                    tags: event.tags,
                    content: event.content,
                    sig: event.sig ?? '', // Ensure sig is a string
                };
                return localDb.addOrUpdateEvent(storedEventData);
            });

            await Promise.all(storePromises);
            console.log('Sent fetched lists to local DB update process.');
        } else {
            console.log('No list events found matching the filter.');
        }

    } catch (error) {
        console.error('Failed to fetch/store list events:', error);
    }
}

  // ---- REFACTORED DATA LOADING FUNCTION ----
  async function loadDataAndBuildHierarchy(pubkey: string) {
      console.log(`Initiating data load and hierarchy build for pubkey: ${pubkey}`);
      // Reset loading states for the new user load or refresh
      isLoadingProfile = true; // Assume profile needs loading initially
      isLoadingInitialLists = true;
      isHierarchyLoading.set(true);
      listHierarchy.set([]); // Clear old hierarchy
      profile.set(null); // Clear old profile before loading new one

      try {
          // 1. Load User Profile (manages isLoadingProfile internally now)
          // We await this individually to ensure profile is available sooner potentially
          await loadUserProfile(pubkey);

          // 2. Fetch Lists from Network, then Build Hierarchy
          // Note: This step still fetches *all* lists initially, sync fetches only newer ones
          await fetchAndStoreUserLists(pubkey);

          // 3. Build Hierarchy from DB after fetching/storing
          console.log("List fetch/store complete. Now building hierarchy from DB for:", pubkey);
          const usersLists: StoredEvent[] = await localDb.getUsersNip51Lists(pubkey);
          console.log(`Found ${usersLists.length} lists in local DB for hierarchy.`);
          if (usersLists.length > 0) {
              const hierarchy = await buildHierarchy(usersLists);
              console.log('Hierarchy built (structure hidden for brevity)');
              // Check if we are still processing the same user before setting store
              const currentLoggedInPubkey = get(user)?.pubkey;
              if (currentLoggedInPubkey === pubkey) {
                   listHierarchy.set(hierarchy);
                   console.log('Hierarchy store updated.');
              } else {
                  console.log("User changed during hierarchy build, discarding results.");
              }
          } else {
              const currentLoggedInPubkey = get(user)?.pubkey;
              if (currentLoggedInPubkey === pubkey) listHierarchy.set([]);
              console.log("No lists found in DB, setting empty hierarchy.");
          }
      } catch (error) {
            console.error("Error during loadDataAndBuildHierarchy:", error);
            const currentLoggedInPubkey = get(user)?.pubkey;
            // Reset hierarchy on error only if it's for the current user
            if (currentLoggedInPubkey === pubkey) listHierarchy.set([]);
      } finally {
            // Reset flags only if we are still on the same user
            const currentLoggedInPubkey = get(user)?.pubkey;
            if (currentLoggedInPubkey === pubkey) {
                 // isLoadingProfile is handled internally by loadUserProfile
                 isLoadingInitialLists = false;
                 isHierarchyLoading.set(false);
                 console.log("Data load and hierarchy build process finished for:", pubkey);
            } else {
                 console.log("User changed during finally block of load/build, flags not reset.");
            }
      }
  }
  // ---- END REFACTORED FUNCTION ----


  // ---- IMPLEMENTED SYNC HANDLER ----
  async function handleSync() {
      if (isSyncing || !browser) return;
      console.log('Starting sync process...');
      isSyncing = true; // [cite: 1191]
      let refreshNeeded = false; // Initialize refresh flag here [cite: 1191]

      // Get pubkey early for both phases
      const userPubkey = get(user)?.pubkey;
      if (!userPubkey) {
          console.error('User not logged in, cannot sync.');
          isSyncing = false; // Ensure state is reset
          // TODO: Maybe show a user-friendly message?
          return;
      }

      // --- Check NDK connection status ---
      // NDK doesn't have a simple 'isConnected' flag.
      // We rely on the fetchEvents call potentially timing out or failing
      // if relays aren't connected. A more robust check might involve
      // querying ndk.pool.relays map status, but fetchEvents is the
      // primary action needed, so we'll proceed and handle errors there.
      // console.log("NDK Pool Relays:", ndkInstance.pool.relays); // For debugging if needed

      try {
          // -----------------------------------------------\n          // Sync Phase 1: Fetch Incoming Events\n          // -----------------------------------------------\n          console.log("Sync Phase 1: Fetching incoming events..."); // [cite: 1515]

          // 1. Get Latest Timestamp [source: 1514, source: 1352]
          let latestTimestamp = 0; // Default to 0 if no events found
          try {
                latestTimestamp = await localDb.getLatestEventTimestamp(userPubkey);
                console.log(`[Sync Phase 1] Latest known local event timestamp for ${userPubkey}: ${latestTimestamp}`); // [cite: 1516]
          } catch (dbError) {
              console.error("[Sync Phase 1] Error fetching latest timestamp from DB:", dbError);
              // Decide if we should proceed with since = 0 or abort.
              // Proceeding with 0 is safer (might fetch duplicates, but won't miss events).
              console.warn("[Sync Phase 1] Proceeding with fetch since timestamp 0.");
          }


          // 2. Construct Filter [source: 1516]
          const listKinds = [10000, 10001, 30000, 30001, 30003]; // NIP-51 List Kinds [cite: 1377, 1478]
          const filter: NDKFilter = {
              authors: [userPubkey],
              kinds: listKinds,
              // Only add 'since' if we have a valid timestamp > 0
              ...(latestTimestamp > 0 && { since: latestTimestamp + 1 }) // Fetch events strictly *after* the latest known
          };
          console.log('[Sync Phase 1] Fetching events with filter:', JSON.stringify(filter)); // [cite: 1516]

          // 3. Fetch Events [source: 1517]
          console.log('[Sync Phase 1] Querying relays...');
          const fetchedEvents: Set<NDKEvent> = await ndkService.fetchEvents(filter);
          console.log(`[Sync Phase 1] Fetched ${fetchedEvents.size} new events from relays.`); // [cite: 1518]

          // 4. Store Fetched Events [source: 1519]
          if (fetchedEvents.size > 0) {
              let processedCount = 0;
              for (const event of fetchedEvents) {
                  try {
                      // Convert NDKEvent to StoredEvent [source: 1306]
                       // dTag extraction logic is now within addOrUpdateEvent
                      const storedEventData: StoredEvent = {
                          id: event.id,
                          pubkey: event.pubkey,
                          created_at: event.created_at,
                          kind: event.kind,
                          tags: event.tags,
                          content: event.content,
                          sig: event.sig ?? '',
                          published: true, // Mark as published since it came from a relay [cite: 1522]
                          // dTag is handled by addOrUpdateEvent
                      };

                      // Add/Update in IndexedDB [source: 1524]
                       // addOrUpdateEvent handles replaceable logic and dTag extraction/storage
                      await localDb.addOrUpdateEvent(storedEventData);
                      processedCount++;
                  } catch (storeError) {
                      console.error(`[Sync Phase 1] Error processing/storing event ${event.id}:`, storeError); // [cite: 1546]
                      // Continue processing other events
                  }
              }
              console.log(`[Sync Phase 1] Successfully processed and stored ${processedCount} events.`); // [cite: 1525]

              // 5. Set Refresh Flag [source: 1519, source: 1542]
              if (processedCount > 0) {
                 refreshNeeded = true;
                 console.log("[Sync Phase 1] Refresh needed due to new incoming events.");
              }

          } else {
              console.log("[Sync Phase 1] No new incoming events found.");
          }

          console.log("Sync Phase 1 Complete."); // [cite: 1218]

          // -----------------------------------------------\
          // Sync Phase 2: Publish Outgoing Unpublished Events\n          // -----------------------------------------------\
          console.log("[Sync Phase 2] Publishing outgoing events..."); // [cite: 1528, cite: 1219]
          let publishedSomething = false; // Track if any publish succeeded in this phase [cite: 1537]

          // 1. Get Unpublished Events [source: 1347, source: 1530]
          let unpublishedEvents: StoredEvent[] = [];
          try {
              unpublishedEvents = await localDb.getUnpublishedEvents(userPubkey);
              console.log(`[Sync Phase 2] Found ${unpublishedEvents.length} unpublished events locally for ${userPubkey}.`);
          } catch (dbError) {
              console.error("[Sync Phase 2] Error fetching unpublished events from DB:", dbError);
              // Do not proceed with publishing if DB read failed
              unpublishedEvents = []; // Ensure array is empty to skip the loop
          }

          // 2. Check for Events
          if (unpublishedEvents.length > 0) { // [cite: 1531]
              console.log(`[Sync Phase 2] Attempting to publish ${unpublishedEvents.length} events...`);

              // 3. Iterate and Reconstruct
              for (const storedEvent of unpublishedEvents) {
                  try {
                      // Reconstruct NDKEvent [source: 1531-1533]
                      const ndkInstanceForEvent = ndkService.getNdkInstance(); // Get the raw NDK instance
                      if (!ndkInstanceForEvent) {
                          console.warn(`[Sync Phase 2] Skipping publish for ${storedEvent.id}: NDK instance not available.`);
                          continue; // Skip if NDK isn't ready
                      }
                      const eventToPublish = new NDKEvent(ndkInstanceForEvent); // Associate with current NDK instance
                      eventToPublish.id = storedEvent.id;
                      eventToPublish.sig = storedEvent.sig;
                      eventToPublish.kind = storedEvent.kind;
                      eventToPublish.pubkey = storedEvent.pubkey;
                      eventToPublish.created_at = storedEvent.created_at;
                      eventToPublish.content = storedEvent.content;
                      eventToPublish.tags = storedEvent.tags;

                      // 4. Verify Signature [source: 1534]
                      if (!eventToPublish.sig) {
                          console.warn(`[Sync Phase 2] Skipping event ${storedEvent.id} (Kind: ${storedEvent.kind}): Missing signature. Cannot publish.`);
                          // Optionally, consider deleting this event from local DB if it's unsignable
                          // await localDb.deleteEvent(storedEvent.id); 
                          continue; // Skip this event
                      }

                      // 5. Publish Attempt [source: 1535]
                      console.log(`[Sync Phase 2] Publishing event ${eventToPublish.id} (Kind: ${eventToPublish.kind})...`);
                      // Use the service's publish method
                      const publishedToRelays = await ndkService.publish(eventToPublish);

                      // 6. Handle Publish Result [source: 1536]
                      if (publishedToRelays.size > 0) {
                          console.log(`[Sync Phase 2] Successfully published event ${eventToPublish.id} to ${publishedToRelays.size} relays.`);
                          // Mark as published in local DB [source: 1536]
                          await localDb.markEventAsPublished(eventToPublish.id);
                          console.log(`[Sync Phase 2] Marked event ${eventToPublish.id} as published in local DB.`);
                          publishedSomething = true; // Flag that at least one publish succeeded [cite: 1537]
                      } else {
                          console.warn(`[Sync Phase 2] Failed to publish event ${eventToPublish.id} to any connected write relays.`); // [cite: 1538]
                          // Event remains marked as unpublished for next sync attempt
                      }
                  } catch (publishOrMarkError) { // 8. Error Handling [source: 1539]
                      console.error(`[Sync Phase 2] Error publishing or marking event ${storedEvent.id} as published:`, publishOrMarkError);
                      // Continue to the next event
                  }
              } // End loop through unpublishedEvents

              console.log(`[Sync Phase 2] Finished publishing attempt for ${unpublishedEvents.length} events.`); // [cite: 1231]
          } else {
              console.log("[Sync Phase 2] No unpublished events found locally to publish."); // [cite: 1541, cite: 1232]
          }

          // 7. Set Refresh Flag [source: 1542]
          if (publishedSomething) {
              refreshNeeded = true; // Mark refresh needed if we published anything
              console.log("[Sync Phase 2] Refresh needed due to successfully published events.");
          }

          console.log("Sync Phase 2 Complete."); // [cite: 1232]

          // --------------------
          // Data Refresh
          // --------------------
          if (refreshNeeded) {
              console.log("Data changed during sync, reloading hierarchy...");
              await loadDataAndBuildHierarchy(userPubkey);
          } else {
              console.log("No data changes detected during sync.");
          }
          // --------------------

          console.log('Sync process completed successfully.');

      } catch (error) {
          console.error('Error during sync process:', error);
      } finally {
          isSyncing = false; // [cite: 1238]
          console.log('Sync process finished (finally block).');
      }
  }
  // ---- END SYNC HANDLER ----

  // Function to handle refresh after list creation
  function handleListCreated() {
    console.log("Modal dispatched 'listcreated', refreshing data...");
    const currentPubkey = get(user)?.pubkey;
    if (currentPubkey) {
      // Trigger the existing data load function
      loadDataAndBuildHierarchy(currentPubkey);
    } else {
      console.warn("Tried to refresh list after creation, but user is no longer logged in?");
    }
  }

  // Refactored Reactive Block using the new function
  $: {
      const currentPubkey = $user?.pubkey;

      if (currentPubkey) {
          // Only proceed if this pubkey hasn't been processed yet for the initial load
          if (currentPubkey !== lastLoadedPubkey) {
                console.log(`Detected new or changed user: ${currentPubkey}. Initiating initial data load.`);
                lastLoadedPubkey = currentPubkey; // Set the guard for *initial* load

                // Call the refactored function for initial load
                 // No need to await here, it manages its own state async
                loadDataAndBuildHierarchy(currentPubkey);
          } else {
             // console.log(`User ${currentPubkey} already processed for initial load.`);
          }

      } else {
          // --- Logout Logic --- 
          if (lastLoadedPubkey !== null) { // Only clear if we were previously logged in
                console.log("User logged out or became null, clearing states and guard.");
                profile.set(null);
                listHierarchy.set([]);
                isLoadingProfile = false;
                isLoadingInitialLists = false;
                isHierarchyLoading.set(false);
                isSyncing = false; // Reset sync state on logout
                lastLoadedPubkey = null; // Reset guard
          }
      }
  }

  // Remove the old reactive block that depended on nip51Lists store
  /*
  $:
    if ($nip51Lists.length > 0 && get(listHierarchy).length === 0 && !get(isHierarchyLoading)) {
        // ... old hierarchy build logic based on nip51Lists store ...
    }
  */

  // Function to handle the listchanged event from TreeNode
  function handleListChanged() {
    console.log('List changed event received in +page.svelte, triggering refresh...');
    const currentPubkey = get(user)?.pubkey;
    if (currentPubkey) {
      // Add a small delay to allow DB operations to potentially settle
      // Although Dexie transactions should handle consistency, a brief UI delay can feel smoother.
      setTimeout(() => {
         loadDataAndBuildHierarchy(currentPubkey);
      }, 100); // 100ms delay, adjust if needed
    } else {
       console.warn('Cannot refresh list: User pubkey not found.');
    }
  }

  // Function to handle the 'openadditem' event from TreeNode
  function handleOpenAddItem(event: CustomEvent<{ listId: string; listName: string }>) {
      // *** Debug Log: Check event detail received ***
      console.log(`%c+page.svelte: handleOpenAddItem received event with detail:`, 'color: green;', event.detail);

      modalTargetListId = event.detail.listId;
      modalTargetListName = event.detail.listName;
      console.log(`+page.svelte -> handleOpenAddItem: Setting modal context - ID=${modalTargetListId}, Name=${modalTargetListName}`);

      // Find the dialog element and show it
      const dialogElement = document.getElementById('add_item_modal') as HTMLDialogElement | null;
      if (dialogElement) {
           dialogElement.showModal();
      } else {
           console.error("Could not find dialog element with id 'add_item_modal'");
           alert("Error: Could not open the Add Item form."); // User feedback
      }
  }

  onMount(() => {
    // Initial load
    const currentPubkey = get(user)?.pubkey;
    if (currentPubkey) {
      loadDataAndBuildHierarchy(currentPubkey);
    }
    // Potentially trigger initial sync here too
  });

</script>

<div class="container p-4 mx-auto">
  {#if $user}
    <!-- Render the modal (it's hidden by default) -->
    <CreateListModal bind:this={createListModalInstance} on:listcreated={handleListChanged} />

    <!-- Add Item Modal Instance -->
    <AddItemModal
        bind:this={addItemModalInstance}
        targetListId={modalTargetListId}
        targetListName={modalTargetListName}
        on:itemadded={handleListChanged} />

    <!-- Logged In State - Using DaisyUI -->
    <p class="mb-4 text-sm text-base-content/80">Logged In as: <code class="break-all font-mono bg-base-200 px-1 rounded">{$user.npub}</code></p>

    {#if isLoadingProfile}
      <!-- Loading Indicator -->
      <div class="flex justify-center items-center p-6">
        <span class="loading loading-spinner loading-lg text-primary"></span>
      </div>
    {:else if $profile}
      <!-- Profile Card - Adjusted Vertical Layout -->
      <div class="card bg-base-100 shadow-xl mt-4 max-w-md">
        <!-- Avatar outside card-body -->
        <div class="px-4 pt-4 flex justify-center"> <!-- Added padding and centering for avatar -->
          {#if $profile.image}
            <div class="avatar">
              <div class="w-16 rounded-full ring ring-primary ring-offset-base-100 ring-offset-2">
                <img src={$profile.image} alt="Profile avatar" />
              </div>
            </div>
          {:else}
            <!-- Placeholder Avatar -->
            <div class="avatar placeholder">
              <div class="bg-neutral text-neutral-content rounded-full w-16">
                <span class="text-xl">{$profile.displayName?.charAt(0) || $profile.name?.charAt(0) || '?'}</span>
              </div>
            </div>
          {/if}
        </div>
        <!-- Card body with adjusted padding and text clamping -->
        <div class="card-body items-center text-center pt-4"> <!-- Adjusted padding, added centering -->
          <h2 class="card-title">{$profile.displayName || $profile.name || 'Name not set'}</h2>
          {#if $profile.about}
             <!-- Added line-clamp and text styling -->
            <p class="text-sm text-base-content/70 line-clamp-3">{$profile.about}</p>
          {/if}
        </div>
      </div>
    {:else}
      <!-- Profile Not Found Fallback -->
      <p class="mt-4 italic text-base-content/70">(Profile data not found.)</p>
    {/if}

    <!-- ===== START: List Hierarchy Section ===== -->
    <div class="divider">My Lists</div>

    <!-- Hierarchy Display Section -->
    <div class="p-4 border border-base-300 rounded-lg bg-base-100/50 min-h-[200px]">
        {#if $isHierarchyLoading || isLoadingInitialLists } <!-- Check both flags -->
            {@const logState = console.log('TEMPLATE CHECK (loading): isLoading?', $isHierarchyLoading || isLoadingInitialLists, 'Hierarchy Length:', $listHierarchy.length)}
            {@const logLoading = console.log('TEMPLATE RENDERING: Loading state')}
            <div class="flex justify-center items-center h-full">
                <span class="loading loading-lg loading-spinner text-primary"></span>
                 <!-- Show specific message based on which phase is active -->
                 {#if isLoadingInitialLists}
                    <span class="ml-4 text-lg italic">Fetching lists from network...</span>
                 {:else}
                    <span class="ml-4 text-lg italic">Building hierarchy from local data...</span>
                 {/if}
            </div>
        {:else if $listHierarchy.length > 0}
             {@const logState = console.log('TEMPLATE CHECK (hierarchy): isLoading?', $isHierarchyLoading || isLoadingInitialLists, 'Hierarchy Length:', $listHierarchy.length)}
             {@const logHierarchy = console.log('TEMPLATE RENDERING: Hierarchy block')}
            <div class="mt-4 space-y-2 overflow-auto" style="max-height: 70vh;">
                {#each $listHierarchy as rootNode (rootNode.id)}
                    <TreeNode node={rootNode} on:listchanged={handleListChanged} on:openadditem={handleOpenAddItem} />
                {/each}
            </div>
        {:else} <!-- Only show 'no lists' if *not* loading -->
            {@const logState = console.log('TEMPLATE CHECK (empty): isLoading?', $isHierarchyLoading || isLoadingInitialLists, 'Hierarchy Length:', $listHierarchy.length)}
            {@const logEmpty = console.log('TEMPLATE RENDERING: No lists state')}
            <div class="flex justify-center items-center h-full">
                 <p class="text-lg text-base-content/70 italic">
                    (No lists found locally or hierarchy failed to build).
                     Try refreshing or checking relay connections.
                 </p>
            </div>
        {/if}
    </div>
    <!-- ===== END: List Hierarchy Section ===== -->

    <!-- Action Buttons Area -->
    <div class="mt-4 flex items-center gap-2">
        <h2 class="text-xl font-semibold flex-grow">My Lists</h2>
        <!-- Add Create List Button -->
        <button class="btn btn-primary btn-sm" on:click={() => (window as any).create_list_modal.showModal()}>
          Create New List
        </button>
        <!-- Existing Sync Button -->
        <button class="btn btn-secondary btn-sm" on:click={handleSync} disabled={isSyncing || $isHierarchyLoading || isLoadingInitialLists}> <!-- Also disable during initial load -->
          {#if isSyncing}
            <span class="loading loading-spinner loading-xs"></span>
            Syncing...
          {:else if $isHierarchyLoading || isLoadingInitialLists}
             <span class="loading loading-spinner loading-xs"></span> <!-- Optional: show spinner during initial load too -->
             Loading...
          {:else}
            Sync from Relays
          {/if}
        </button>
    </div>

  {:else}
    <!-- Logged Out State - Using DaisyUI -->
    <div class="flex flex-col items-center justify-center p-6">
        <h2 class="text-xl font-semibold mb-4">Login Required</h2>
        <p class="mb-4">Please log in using your Nostr browser extension (e.g., Alby, Nos2x).</p>
        <button class="btn btn-primary" on:click={handleLogin}>
          Login with Browser Extension
        </button>
    </div>
  {/if}
</div>