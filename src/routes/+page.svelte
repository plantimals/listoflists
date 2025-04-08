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
  import { NDKEvent, type NDKUser, type NDKUserProfile, type NDKFilter, NDKNip07Signer, type NDKSigner, type NDKList, NDKKind } from '@nostr-dev-kit/ndk';
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
  let isLoadingInitialLists: boolean = false; // Initial load from local + potentially network
  let isSyncing: boolean = false; // Manual sync process
  let isInitialSyncing: boolean = false; // Tracks background fetch after initial load
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
          isInitialSyncing = false;
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
      // Initially clear the profile to avoid showing stale data if local is empty
      // This might be adjusted later based on UX preference.
      profile.set(null);

      try {
          // 1. Immediate Local Read & Update
          const initialLocalProfileData = await localDb.getProfile(pubkey);
          if (initialLocalProfileData?.profile) {
              profile.set(initialLocalProfileData.profile as NDKUserProfile);
              console.log('User profile loaded from local DB for initial display', initialLocalProfileData.profile);
          } else {
              // Explicitly set to null if nothing found locally (already done above, but for clarity)
              profile.set(null);
              console.log('No user profile found in local DB for pubkey:', pubkey);
          }

          // 2. Update Loading State - Initial load complete
          isLoadingProfile = false; // <- Moved up

          // 3. Handle Network Fetch (Subsequent Update)
          if (!ndkService.getNdkInstance()) {
              console.error('NDK not initialized, cannot fetch profile from network');
              // No further action needed here as local load was attempted
              return;
          }

          console.log('Attempting to fetch latest user profile from network for pubkey:', pubkey);
          const latestProfile = await ndkService.fetchProfile(pubkey);

          if (latestProfile) {
              console.log('Fetched profile from network:', latestProfile);
              // Store the fetched profile in local DB (this replaces the old one if it exists)
              await localDb.saveProfile(pubkey, latestProfile);

              // TODO: PF1.2 - Refine this update: Only update the store if the fetched
              // profile is different from or newer than the initially loaded local one.
              // For now, we'll update it unconditionally after fetch.
              profile.set(latestProfile);
          } else {
              console.log('No profile found on network for pubkey:', pubkey);
              // If network fetch fails *after* a local load, we keep the local profile displayed.
              // If there was no local profile either, it remains null.
          }
      } catch (error) {
          console.error('Error loading user profile:', error);
          // Even if fetch fails, ensure loading state is false if it wasn't already
          isLoadingProfile = false;
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
      isLoadingProfile = true; // Profile load starts
      isLoadingInitialLists = true; // Indicate initial list loading phase
      isHierarchyLoading.set(true); // Indicate hierarchy calculation phase
      isInitialSyncing = false; // Ensure background sync flag is false initially
      listHierarchy.set([]); // Clear old hierarchy
      profile.set(null); // Clear old profile before loading new one

      try {
          // 1. Load User Profile (non-awaited)
          // loadUserProfile handles its own isLoadingProfile flag and updates UI quickly
          loadUserProfile(pubkey);

          // 2. Build Hierarchy *FIRST* from Local Data
          console.log("Attempting to build hierarchy from local DB for:", pubkey);
          const usersLists: StoredEvent[] = await localDb.getUsersNip51Lists(pubkey);
          console.log(`Found ${usersLists.length} lists in local DB for hierarchy build.`);
          if (usersLists.length > 0) {
              const hierarchy = await buildHierarchy(usersLists);
              console.log('Initial hierarchy built from local data (structure hidden).');
              const currentLoggedInPubkey = get(user)?.pubkey;
              if (currentLoggedInPubkey === pubkey) {
                   listHierarchy.set(hierarchy);
                   console.log('Hierarchy store updated with local data.');
              } else {
                  console.log("User changed during initial hierarchy build, discarding local results.");
              }
          } else {
              const currentLoggedInPubkey = get(user)?.pubkey;
              if (currentLoggedInPubkey === pubkey) listHierarchy.set([]);
              console.log("No lists found in local DB for initial hierarchy build.");
          }

          // >>>>> Update Loading States After Local Build <<<<<
          // Local build attempt is complete, turn off main loading indicators
          const currentLoggedInPubkeyAfterBuild = get(user)?.pubkey;
          if (currentLoggedInPubkeyAfterBuild === pubkey) {
              isLoadingInitialLists = false;
              isHierarchyLoading.set(false);
              console.log("Initial local load/build complete. Main loading indicators off.");
          } else {
              console.log("User changed after local build, not updating loading flags yet.");
              // Flags will be reset correctly if user changes again or on next full load
          }
          // >>>>> End Update Loading States <<<<<


          // 3. Fetch List Updates from Network (Background)
          console.log("Initiating background fetch for list updates from network for:", pubkey);
          // Set background sync flag
          isInitialSyncing = true;

          // Use an async IIFE to track completion and reset the flag
          (async () => {
              try {
                  await fetchAndStoreUserLists(pubkey);
                  console.log("Background list fetch/store completed successfully.");
                  // Potentially trigger a refresh here if needed, or rely on manual sync/refreshTrigger
                  // For now, just update the flag.
              } catch (fetchError) {
                  console.error("Error during background list fetch/store:", fetchError);
              } finally {
                   // Only reset flag if still the same user
                  const currentLoggedInPubkeyAfterFetch = get(user)?.pubkey;
                  if (currentLoggedInPubkeyAfterFetch === pubkey) {
                        isInitialSyncing = false;
                        console.log("Background sync flag reset.");
                  } else {
                       console.log("User changed during background fetch, background sync flag not reset.");
                  }

              }
          })();
          console.log("Background list fetch/store process initiated.");


      } catch (error) {
            console.error("Error during loadDataAndBuildHierarchy:", error);
            const currentLoggedInPubkey = get(user)?.pubkey;
            // Reset all relevant flags on error, but only if it's for the current user
            if (currentLoggedInPubkey === pubkey) {
                 listHierarchy.set([]);
                 isLoadingInitialLists = false;
                 isHierarchyLoading.set(false);
                 isInitialSyncing = false; // Also reset background flag on main error
            }
      }
      // The finally block is removed as flag resets are handled after local build and in the IIFE.
  }
  // ---- END REFACTORED FUNCTION ----


  // ---- IMPLEMENTED SYNC HANDLER ----
  async function handleSync(options?: { isInitialSync?: boolean }) {
    // 2. Determine Context
    const isInitial = options?.isInitialSync ?? false;
    const syncContext = isInitial ? 'initial' : 'manual';
    console.log(`Starting sync process (context: ${syncContext})...`);

    if (!browser) return; // Still need browser check

    // Prevent concurrent *manual* syncs, initial sync runs regardless
    // Also check main isSyncing flag only for manual syncs
    if (!isInitial && isSyncing) { // Guard adjusted for manual syncs
      console.warn('Manual sync attempt ignored, already syncing.');
      return;
    }

    // 3. Conditional isSyncing State (Setting True)
    if (!isInitial) {
      isSyncing = true;
    }
    let refreshNeeded = false; // Reset flag at the start of each sync

    try {
      const pubkey = get(user)?.pubkey; // Get current user pubkey
      if (!pubkey) {
        console.error('Cannot sync without user pubkey.');
        // Optionally set an error state here
        // Reset syncing flag *only* if it was set for manual sync
        if (!isInitial) isSyncing = false;
        return;
      }

      // 1. Fetch latest NIP-51 list events for the user from relays
      console.log(`[Sync ${syncContext}] Fetching latest NIP-51 events for ${pubkey}...`);
      // Using original DB access pattern
      const lastSyncTimestamp = (await localDb.settings.get('lastSyncTimestamp'))?.value ?? 0;
      const since = lastSyncTimestamp > 0 ? lastSyncTimestamp : undefined;
      console.log(`[Sync ${syncContext}] Fetching lists created since: ${since ? new Date(since * 1000) : 'beginning'}`);

      // Using original filter structure & NDKKind
      const userListsEvents = await ndkService.fetchEvents([
        { kinds: [NDKKind.CategorizedPeopleList], authors: [pubkey], since: since },
        { kinds: [NDKKind.PinList], authors: [pubkey], since: since }
      ]);
      console.log(`[Sync ${syncContext}] Fetched ${userListsEvents.size} NIP-51 list/set events.`);

      // 2. Fetch associated profiles and notes
      const referencedPubkeys = new Set<string>();
      const referencedEventIds = new Set<string>();
      for (const listEvent of userListsEvents) {
        listEvent.tags.forEach((tag) => {
          if (tag[0] === 'p' && tag[1]) referencedPubkeys.add(tag[1]);
          if (tag[0] === 'e' && tag[1]) referencedEventIds.add(tag[1]);
          // 'a' tag handling placeholder
        });
      }

      const profilesToFetch = Array.from(referencedPubkeys);
      const notesToFetch = Array.from(referencedEventIds);
      let referencedEvents = new Set<NDKEvent>();

      if (profilesToFetch.length > 0) {
        console.log(`[Sync ${syncContext}] Fetching ${profilesToFetch.length} referenced profiles...`);
        referencedEvents = new Set([
          ...referencedEvents,
          ...(await ndkService.fetchEvents({ kinds: [NDKKind.Profile], authors: profilesToFetch }))
        ]);
      }
      if (notesToFetch.length > 0) {
        console.log(`[Sync ${syncContext}] Fetching ${notesToFetch.length} referenced notes...`);
        referencedEvents = new Set([
          ...referencedEvents,
          ...(await ndkService.fetchEvents({ kinds: [NDKKind.Text], ids: notesToFetch }))
        ]);
      }
      console.log(`[Sync ${syncContext}] Fetched ${referencedEvents.size} referenced profile/note events.`);

      // 3. Store fetched events
      const allFetchedEvents = [...userListsEvents, ...referencedEvents];
      if (allFetchedEvents.length > 0) {
        // Using original DB access pattern
        const changes = await localDb.storeEvents(allFetchedEvents);
        if (changes.added > 0 || changes.updated > 0) {
          refreshNeeded = true;
          console.log(`[Sync ${syncContext}] Stored/Updated events in DB: ${changes.added} added, ${changes.updated} updated.`);
        } else {
          console.log(`[Sync ${syncContext}] No new or updated events to store in DB.`);
        }
      } else {
        console.log(`[Sync ${syncContext}] No events fetched from relays.`);
      }

      // 4. Update last sync timestamp
      const newSyncTimestamp = Math.floor(Date.now() / 1000);
      // Using original DB access pattern
      await localDb.settings.put({ key: 'lastSyncTimestamp', value: newSyncTimestamp });
      console.log(`[Sync ${syncContext}] Updated last sync timestamp to: ${new Date(newSyncTimestamp * 1000)}`);

      // 5. (Post-MVP) Publish queued local changes placeholder
      console.log(`[Sync ${syncContext}] Publishing local changes (Not Implemented)`);
      // await publishLocalChanges();

      // 4. Conditional Data Refresh
      if (!isInitial && refreshNeeded) {
        console.log("Data changed during manual sync, reloading hierarchy...");
        // Re-fetch pubkey in case of context switch during async ops
        const currentPubkey = get(user)?.pubkey;
        if (currentPubkey) {
            await loadDataAndBuildHierarchy(currentPubkey);
        } else {
            console.warn("Cannot refresh hierarchy, user pubkey changed or became null during sync.");
        }
      } else if (isInitial && refreshNeeded) {
        console.log("Data changed during initial sync, refresh skipped as UI was just loaded.");
      } else {
        // Added log for clarity when no changes detected in either context
        console.log("[Sync ${syncContext}] No data changes detected, refresh skipped.");
      }

    } catch (error) {
      console.error('Error during sync process:', error);
      // Optionally set an error state here
    } finally {
      // 5. Conditional isSyncing State (Setting False)
      if (!isInitial) {
        isSyncing = false;
      }
      console.log(`Sync process finished (context: ${syncContext}).`);
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
                isInitialSyncing = false;
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
        <button class="btn btn-secondary btn-sm" on:click={() => handleSync({ isInitialSync: false })} disabled={isSyncing || $isHierarchyLoading || isLoadingInitialLists || isInitialSyncing || !$user}> <!-- Also disable during initial load -->
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