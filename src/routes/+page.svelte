<script lang="ts">
  import { user } from '$lib/userStore';
  import { profile } from '$lib/profileStore';
  import { ndk } from '$lib/ndkStore';
  import { listHierarchy, isHierarchyLoading } from '$lib/hierarchyStore';
  import { buildHierarchy } from '$lib/hierarchyService';
  import { get } from 'svelte/store';
  // import { Button } from '@skeletonlabs/skeleton'; // Removed Skeleton import
  import type { NDKUser, NDKUserProfile, NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
  import TreeNode from '$lib/components/TreeNode.svelte'; // Import the new component
  import type { TreeNodeData } from '$lib/types'; // Import the type
  import { localDb, type StoredEvent } from '$lib/localDb'; // Import localDb AND StoredEvent type

  let isLoadingProfile: boolean = false;
  let isLoadingInitialLists: boolean = false; // New state for the initial network fetch
  let lastLoadedPubkey: string | null = null; // Guard against multiple triggers

  // Mock data for testing TreeNode with nesting
  // const mockNestedNodeData: TreeNodeData = { ... };

  async function handleLogin() {
    const ndkInstance = get(ndk);

    if (!ndkInstance?.signer) {
      console.error('NDK Signer not available. Is a NIP-07 extension installed and enabled?');
      return;
    }

    try {
      console.log('Attempting NIP-07 login...');
      const loggedInUser: NDKUser = await ndkInstance.signer.user();
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
          const ndkInstance = get(ndk);
          if (!ndkInstance) {
              console.error("Cannot fetch profile event from network: NDK instance not available.");
              // Skip network fetch if NDK is missing, will proceed to finally block
          } else {
                console.log('Fetching latest profile event (Kind 0) from network for pubkey:', pubkey);
                const profileFilter: NDKFilter = { kinds: [0], authors: [pubkey], limit: 1 };

                try {
                    // Connect NDK if not already connected
                    await ndkInstance.connect();
                    const fetchedEvent: NDKEvent | null = await ndkInstance.fetchEvent(profileFilter);

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
          }
          // --- End Network Fetch & DB Update ---

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
    const ndkInstance = get(ndk);

    if (!ndkInstance) {
        console.error("Cannot fetch lists: NDK instance not available.");
        return;
    }

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
        await ndkInstance.connect();
        console.log('NDK connected, fetching lists with filter:', listFilter);

        // Fetch events
        const fetchedListEventsSet = await ndkInstance.fetchEvents(listFilter);
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

  // Refactored Reactive Block with Guard
  $: {
      const currentPubkey = $user?.pubkey;

      if (currentPubkey) {
          // Only proceed if this pubkey hasn't been processed yet in this session
          if (currentPubkey !== lastLoadedPubkey) {
                console.log(`Detected new or changed user: ${currentPubkey}. Initiating data load.`);
                lastLoadedPubkey = currentPubkey; // Set the guard

                // Reset loading states for the new user load
                isLoadingProfile = true; // Assume profile needs loading initially
                isLoadingInitialLists = true;
                isHierarchyLoading.set(true);
                listHierarchy.set([]); // Clear old hierarchy
                profile.set(null); // Clear old profile before loading new one

                // --- Initiate Loading Processes --- 

                // 1. Load User Profile (manages isLoadingProfile internally now)
                loadUserProfile(currentPubkey);

                // 2. Fetch Lists from Network, then Build Hierarchy
                fetchAndStoreUserLists(currentPubkey)
                    .then(async () => {
                        console.log("Initial list fetch complete. Now building hierarchy from DB for:", currentPubkey);
                        try {
                            const usersLists: StoredEvent[] = await localDb.getUsersNip51Lists(currentPubkey);
                            console.log(`Found ${usersLists.length} lists in local DB.`);
                            if (usersLists.length > 0) {
                                const hierarchy = await buildHierarchy(usersLists);
                                console.log('Hierarchy built:', hierarchy);
                                // Check if we are still processing the same user before setting store
                                if (lastLoadedPubkey === currentPubkey) {
                                    listHierarchy.set(hierarchy);
                                    // Log the detailed structure of the result
                                    console.log(
                                        'Hierarchy built and stored (STRUCTURE CHECK):',
                                        JSON.stringify(hierarchy, (key, value) =>
                                            // Optional: Prevent logging huge rawEvent if it was accidentally included
                                            // key === 'rawEvent' ? undefined : value
                                            value // Keep this simple for now
                                        , 2) // Use 2 spaces for indentation
                                    );
                                }
                            } else {
                                if (lastLoadedPubkey === currentPubkey) listHierarchy.set([]);
                            }
                        } catch(dbOrBuildError) {
                            console.error("Error fetching from DB or building hierarchy:", dbOrBuildError);
                            if (lastLoadedPubkey === currentPubkey) listHierarchy.set([]);
                        }
                    })
                    .catch(fetchError => {
                        console.error("Error during initial list network fetch:", fetchError);
                         if (lastLoadedPubkey === currentPubkey) listHierarchy.set([]);
                    })
                    .finally(() => {
                         // Reset flags only if we are still on the same user
                        if (lastLoadedPubkey === currentPubkey) {
                            isLoadingInitialLists = false;
                            isHierarchyLoading.set(false);
                            console.log("List fetch and hierarchy build process finished for:", currentPubkey);
                        }
                    });
          } else {
             // console.log(`Data load already initiated or completed for user: ${currentPubkey}`);
          }

      } else {
          // --- Logout Logic --- 
          if (lastLoadedPubkey !== null) { // Only clear if we were previously logged in
                console.log("User logged out or became null, clearing stores.");
                profile.set(null);
                listHierarchy.set([]);
                isLoadingProfile = false;
                isLoadingInitialLists = false;
                isHierarchyLoading.set(false);
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

</script>

<div class="container p-4 mx-auto">
  {#if $user}
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
            <ul class="space-y-1">
                {#each $listHierarchy as rootNode (rootNode.id)}
                     {@const logNode = console.log('TEMPLATE RENDERING: TreeNode for', rootNode.id, rootNode.name)}
                    <TreeNode node={rootNode} level={0} />
                {/each}
            </ul>
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