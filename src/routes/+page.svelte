<script lang="ts">
  import { user } from '$lib/userStore';
  import { profile } from '$lib/profileStore';
  import { ndkService } from '$lib/ndkService';
  import { listHierarchy, isHierarchyLoading } from '$lib/hierarchyStore';
  import { buildHierarchy } from '$lib/hierarchyService';
  import { get } from 'svelte/store';
  import { refreshTrigger } from '$lib/refreshStore';
  import { isOnline } from '$lib/networkStatusStore';
  import { NDKEvent, type NDKUser, type NDKUserProfile, type NDKFilter, NDKNip07Signer, type NDKSigner, type NDKList, NDKKind } from '@nostr-dev-kit/ndk';
  import type { TreeNodeData, Nip05VerificationStateType } from '$lib/types';
  import { localDb, type StoredEvent } from '$lib/localDb';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { writable, derived } from 'svelte/store';
  import { nip19 } from 'nostr-tools';
  import AddItemModal from '$lib/components/AddItemModal.svelte'; // Keep if needed, but might comment out usage
  import RenameListModal from '$lib/components/RenameListModal.svelte'; // Keep if needed, but might comment out usage
  import { syncService } from '$lib/syncService';
  import { nip05 } from 'nostr-tools';
  import HierarchyWrapper from '$lib/components/HierarchyWrapper.svelte';
  import { verifyNip05 } from '$lib/nip05Service';
  import ProfileView from '$lib/components/ProfileView.svelte';
  import EventViewModal from '$lib/components/EventViewModal.svelte';
  import ResourceViewModal from '$lib/components/ResourceViewModal.svelte';
  import Nip46ConnectModal from '$lib/components/Nip46ConnectModal.svelte';
  import { Icon, ArrowLeft, AdjustmentsHorizontal, ListBullet } from 'svelte-hero-icons';
  import CreateListModal from '$lib/components/CreateListModal.svelte'; // Add this import
  import AggregatedFeedView from '$lib/components/AggregatedFeedView.svelte'; // Ensure this import exists

  let isLoadingProfile: boolean = false;
  let isLoadingInitialLists: boolean = true;
  let isSyncing: boolean = false;
  let isInitialSyncing: boolean = false;
  let lastLoadedPubkey: string | null = null;

  let generalErrorMessage: string | null = null;

  let isConnectingNip46: boolean = false;
  let nip46ConnectionError: string | null = null;

  let showCreateListModal = false;

  let modalTargetListId: string | null = null;
  let modalTargetListName: string = '';

  let renameModalTargetListId: string | null = null;
  let renameModalTargetListName: string = '';

  let viewingEventId: string | null = null;
  let showEventViewModal: boolean = false;

  let isLoading = writable(true);
  let error: string | null = null;

  let viewingNpub: string | null = null;
  let viewingFeedForNodeId: string | null = null;
  let viewingFeedForListName: string | null = null;

  let nip05VerificationStates: { [identifier: string]: Nip05VerificationStateType } = {};

  let showAddItemModal = false;
  let addItemTargetListId: string | null = null;
  let addItemTargetListName: string = '';

  let showRenameModal = false;
  let renameTargetListId: string | null = null;
  let renameTargetListName: string = '';

  let showFeedModal = false;
  let feedTargetListId: string | null = null;
  let feedTargetListName: string = '';

  let showProfileViewModal = false;
  let viewingProfileNpub: string | null = null;

  let showResourceViewModal = false;
  let viewingResourceCoordinate: string | null = null;

  // State for hierarchy view toggle
  let showRootsOnly = true; // Default to showing only root lists

  // --- New State for Public Browse ---
  let publicBrowseInput: string = '';
  let publicBrowseError: string | null = null;
  let BrowsePublicHexkey: string | null = null; // Renamed to avoid conflict with browser keyword
  let publicBrowseMessage: string | null = null; // New state for public browse feedback

  $: currentUserLists = $listHierarchy.map(node => ({ id: node.id, name: node.name })).filter(list => list.id && list.name);

  // Helper function to get IDs of all nested nodes
  function getAllChildIds(nodes: TreeNodeData[]): Set<string> {
      const childIds = new Set<string>();
      const queue = [...nodes];
      while (queue.length > 0) {
          const node = queue.shift();
          if (node && node.children) {
              node.children.forEach(child => {
                  childIds.add(child.id);
                  queue.push(child); // Add child to queue to process its children
              });
          }
      }
      return childIds;
  }

  // Reactive variable to store IDs of lists that are nested somewhere
  let nestedListIdsSet = new Set<string>();
  $: {
    nestedListIdsSet = getAllChildIds($listHierarchy);
    // console.log("Nested List IDs Set:", nestedListIdsSet);
  }

  // Reactive variable for the filtered hierarchy based on the toggle
  let filteredHierarchy: TreeNodeData[] = [];
  $: {
      if (showRootsOnly) {
          filteredHierarchy = $listHierarchy.filter(rootNode => !nestedListIdsSet.has(rootNode.id));
          // console.log(`Filtered to Roots Only: ${filteredHierarchy.length} roots`);
      } else {
          filteredHierarchy = $listHierarchy;
          // console.log(`Showing Full Hierarchy: ${filteredHierarchy.length} top-level nodes`);
      }
  }

  refreshTrigger.subscribe(value => {
    if (value > 0) {
      const currentUser = get(user);
      if (currentUser?.pubkey && !isSyncing && !isLoadingInitialLists && !$isHierarchyLoading) {
        console.log('Refresh triggered! Reloading data...');
        loadDataAndBuildHierarchy(currentUser.pubkey);
      }
    }
  });

  async function handleLogin() {
    generalErrorMessage = null;
    nip46ConnectionError = null;
    isConnectingNip46 = false;

    console.log('Attempting NIP-07 login via ndkService...');
    const result = await ndkService.activateNip07Signer();

    if (result.success && result.user) {
      console.log('NIP-07 login successful:', result.user);
      if (get(user)?.pubkey !== result.user.pubkey) {
        resetUserData();
      }
      user.set(result.user);
    } else {
      console.error('NIP-07 Login failed:', result.error);
      generalErrorMessage = `NIP-07 Login Failed: ${result.error || 'Unknown error.'}`;
      if (get(user)) {
        resetUserData();
        user.set(null);
      }
    }
  }

  function handleNip46Login() {
    generalErrorMessage = null;
    nip46ConnectionError = null;
    console.log('NIP-46 Login initiated, opening modal...');

    const modal = document.getElementById('nip46_connect_modal') as HTMLDialogElement | null;
    if (modal) {
      try {
        modal.showModal();
        console.log('NIP-46 connect modal opened.');
      } catch (err) {
        console.error('Error showing NIP-46 modal:', err);
        nip46ConnectionError = 'Could not open the NIP-46 connection dialog.';
        generalErrorMessage = nip46ConnectionError;
        isConnectingNip46 = false;
      }
    } else {
      console.error('NIP-46 Connect Modal (id=nip46_connect_modal) not found in the DOM!');
      nip46ConnectionError = 'Cannot find the NIP-46 connection dialog component.';
      generalErrorMessage = nip46ConnectionError;
      isConnectingNip46 = false;
    }
  }

  async function handleInitiateNip46Connect(event: CustomEvent<{ connectionString: string }>) {
    const connectionString = event.detail.connectionString;
    console.log('Handling initiate NIP-46 connect with string:', connectionString);
    isConnectingNip46 = true;
    nip46ConnectionError = null;
    generalErrorMessage = null;

    try {
      const result = await ndkService.activateNip46Signer(connectionString);
      if (result.success && result.user) {
        console.log('NIP-46 connection successful for user:', result.user);
        if (get(user)?.pubkey !== result.user.pubkey) {
          resetUserData();
        }
        user.set(result.user);

        const modal = document.getElementById('nip46_connect_modal') as HTMLDialogElement | null;
        if (modal) modal.close();

      } else {
        console.error('NIP-46 connection failed:', result.error);
        nip46ConnectionError = `NIP-46 Connection Failed: ${result.error || 'Unknown error.'}`;
        generalErrorMessage = nip46ConnectionError;
      }
    } catch (error) {
      console.error('Exception during NIP-46 connection attempt:', error);
      nip46ConnectionError = `Error connecting: ${error instanceof Error ? error.message : String(error)}`;
      generalErrorMessage = nip46ConnectionError;
    } finally {
      isConnectingNip46 = false;
    }
  }

  function handleLogout() {
    console.log("Logging out...");
    ndkService.disconnectSigner();
    resetUserData();
    user.set(null);
    generalErrorMessage = null;
    nip46ConnectionError = null;
    isConnectingNip46 = false;
    console.log("User logged out.");
  }

  function resetUserData() {
    profile.set(null);
    listHierarchy.set([]);
    isHierarchyLoading.set(false);
    isLoadingInitialLists = true;
    isLoadingProfile = false;
    isSyncing = false;
    isInitialSyncing = false;
    lastLoadedPubkey = null;
    nip05VerificationStates = {};
    viewingNpub = null;
    showCreateListModal = false;
    modalTargetListId = null;
    renameModalTargetListId = null;
    viewingEventId = null;
    showEventViewModal = false;
    viewingResourceCoordinate = null;
    showResourceViewModal = false;
  }

  async function loadUserProfile(pubkey: string) {
    isLoadingProfile = true;
    profile.set(null);

    try {
      const initialLocalProfileData = await localDb.getProfile(pubkey);
      if (initialLocalProfileData?.profile) {
        profile.set(initialLocalProfileData.profile as NDKUserProfile);
        console.log('User profile loaded from local DB for initial display', initialLocalProfileData.profile);
      } else {
        profile.set(null);
        console.log('No user profile found in local DB for pubkey:', pubkey);
      }

      isLoadingProfile = false;

      if (!ndkService.getNdkInstance()) {
        console.error('NDK not initialized, cannot fetch profile from network');
        return;
      }

      console.log('Attempting to fetch latest user profile event from network for pubkey:', pubkey);
      const profileEvents = await ndkService.fetchEvents({ kinds: [NDKKind.Metadata], authors: [pubkey], limit: 1 });
      const latestProfileEvent = profileEvents.size > 0 ? Array.from(profileEvents)[0] : null;

      if (latestProfileEvent) {
        console.log('Fetched latest profile event from network:', latestProfileEvent.rawEvent());
        const storedProfileEvent: StoredEvent = {
          id: latestProfileEvent.id,
          kind: latestProfileEvent.kind ?? 0,
          pubkey: latestProfileEvent.pubkey,
          created_at: latestProfileEvent.created_at ?? 0,
          tags: latestProfileEvent.tags,
          content: latestProfileEvent.content,
          sig: latestProfileEvent.sig ?? '',
        };
        await localDb.addOrUpdateProfile(storedProfileEvent);

        try {
          const parsedProfile = JSON.parse(storedProfileEvent.content) as NDKUserProfile;
          if (get(user)?.pubkey === pubkey) {
            profile.set(parsedProfile);
            console.log('Profile store updated with newly fetched profile data.');
          }
        } catch(parseError) {
          console.error("Error parsing fetched profile content:", parseError);
        }

      } else {
        console.log('No profile event (Kind 0) found on network for pubkey:', pubkey);
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
      isLoadingProfile = false;
    }
  }

  async function fetchAndStoreUserLists(pubkey: string) {
    console.log(`Starting list fetch & store process for pubkey: ${pubkey}`);

    const listFilter: NDKFilter = {
      authors: [pubkey],
      kinds: [
        10000,
        10001,
        30000,
        30001,
        30003,
      ]
    };

    try {
      console.log('NDK service will connect if needed, fetching lists with filter:', listFilter);

      const fetchedListEventsSet = await ndkService.fetchEvents(listFilter);
      console.log(`Fetched ${fetchedListEventsSet.size} list events from network for user ${pubkey}.`);

      if (fetchedListEventsSet.size > 0) {
        const eventsToStore = Array.from(fetchedListEventsSet);
        const storePromises = eventsToStore.map(event => {
          const storedEventData: StoredEvent = {
            id: event.id,
            kind: event.kind,
            pubkey: event.pubkey,
            created_at: event.created_at ?? 0,
            tags: event.tags,
            content: event.content,
            sig: event.sig ?? '',
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

  async function loadDataAndBuildHierarchy(pubkey: string) {
    console.log(`Initiating data load and hierarchy build for pubkey: ${pubkey}`);
    isLoadingProfile = true;
    isLoadingInitialLists = true;
    isHierarchyLoading.set(true);
    isInitialSyncing = false;
    listHierarchy.set([]);
    profile.set(null);

    try {
      loadUserProfile(pubkey);

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

      const currentLoggedInPubkeyAfterBuild = get(user)?.pubkey;
      if (currentLoggedInPubkeyAfterBuild === pubkey) {
        isLoadingInitialLists = false;
        isHierarchyLoading.set(false);
        console.log("Initial local load/build complete. Main loading indicators off.");
      } else {
        console.log("User changed after local build, not updating loading flags yet.");
      }

      console.log("Initial local load complete. Triggering initial background sync via SyncService...");
      isInitialSyncing = true;

      syncService.performSync({ isInitialSync: true })
        .then(refreshWasNeeded => {
          console.log(`[+page.svelte] Initial background sync completed via service. Refresh needed indication: ${refreshWasNeeded}`);
        })
        .catch(error => {
          console.error("[+page.svelte] Initial background sync via SyncService failed:", error);
        })
        .finally(() => {
          isInitialSyncing = false;
          console.log("[+page.svelte] Initial background sync process finished.");
        });

    } catch (error) {
      console.error("Error during loadDataAndBuildHierarchy:", error);
      const currentLoggedInPubkey = get(user)?.pubkey;
      if (currentLoggedInPubkey === pubkey) {
        listHierarchy.set([]);
        isLoadingInitialLists = false;
        isHierarchyLoading.set(false);
        isInitialSyncing = false;
      }
    }
  }

  async function handleSync(options?: { isInitialSync?: boolean }) {
    const currentUser = get(user);
    if (!currentUser?.pubkey) {
      console.warn('Sync requested, but no user is logged in.');
      return;
    }

    const isInitial = options?.isInitialSync ?? false;
    const syncContext = isInitial ? 'initial' : 'manual';
    console.log(`Starting sync process (context: ${syncContext})...`);

    if (!browser) return;

    if (!isInitial && isSyncing) {
      console.warn('Manual sync attempt ignored, already syncing.');
      return;
    }

    if (!isInitial) {
      isSyncing = true;
    }
    let syncResult: { success: boolean; message: string } = { success: false, message: 'Sync not performed' }; // Initialize with default

    try {
      console.log(`[Sync ${syncContext}] Calling syncService.performSync for ${currentUser.pubkey}...`);

      syncResult = await syncService.performSync(options); // Assign the whole result object
      const refreshNeeded = syncResult.success; // Extract the boolean success value

      console.log(`[Sync ${syncContext}] syncService.performSync finished. Refresh needed: ${refreshNeeded}, Message: ${syncResult.message}`);

      if (!isInitial && refreshNeeded) {
        console.log("Data changed during manual sync, reloading hierarchy...");
        const currentPubkey = get(user)?.pubkey;
        if (currentPubkey) {
          await loadDataAndBuildHierarchy(currentPubkey);
        } else {
          console.warn("Cannot refresh hierarchy, user pubkey changed or became null during sync.");
        }
      } else if (isInitial && refreshNeeded) {
        console.log("Data changed during initial sync, refresh skipped as UI was just loaded.");
      } else {
        console.log(`[Sync ${syncContext}] No data changes detected or reported by syncService, refresh skipped.`);
      }

    } catch (error) {
      console.error('Error during sync process:', error);
    } finally {
      if (!isInitial) {
        isSyncing = false;
      }
      console.log(`Sync process finished (context: ${syncContext}).`);
    }
  }

  function handleListCreated() {
    console.log("Modal dispatched 'listcreated', refreshing data...");
    const currentPubkey = get(user)?.pubkey;
    if (currentPubkey) {
      loadDataAndBuildHierarchy(currentPubkey);
    } else {
      console.warn("Tried to refresh list after creation, but user is no longer logged in?");
    }
  }

  $: {
    const currentPubkey = $user?.pubkey;

    if (currentPubkey) {
      if (currentPubkey !== lastLoadedPubkey) {
        console.log(`Detected new or changed user: ${currentPubkey}. Initiating initial data load.`);
        lastLoadedPubkey = currentPubkey;
        loadDataAndBuildHierarchy(currentPubkey);
      } else {
        // console.log(`User ${currentPubkey} already processed for initial load.`);
      }

    } else {
      if (lastLoadedPubkey !== null) {
        console.log("User logged out or became null, clearing states and guard.");
        profile.set(null);
        listHierarchy.set([]);
        isLoadingProfile = false;
        isLoadingInitialLists = true;
        isHierarchyLoading.set(false);
        isSyncing = false;
        isInitialSyncing = false;
        lastLoadedPubkey = null;
      }
    }
  }

  function handleListChanged() {
    console.log('List changed event received in +page.svelte, triggering refresh...');
    const currentPubkey = get(user)?.pubkey;
    if (currentPubkey) {
      setTimeout(() => {
        loadDataAndBuildHierarchy(currentPubkey);
      }, 100);
    } else {
      console.warn('Cannot refresh list: User pubkey not found.');
    }
  }

  function handleOpenAddItem(event: CustomEvent<{ parentId: string; parentName: string }>) {
    console.log("%c+page.svelte: handleOpenAddItem received event with detail:", 'color: green;', event.detail);
    addItemTargetListId = event.detail.parentId;
    addItemTargetListName = event.detail.parentName;
    
    // Imperatively find and open the dialog
    const modal = document.getElementById('add_item_modal') as HTMLDialogElement | null;
    if (modal) {
        console.log("+page.svelte: Found modal, attempting to show...");
        modal.showModal();
    } else {
        console.error("+page.svelte: Could not find AddItemModal dialog element!");
    }
  }

  function handleOpenRenameModal(event: CustomEvent<{ listNodeId: string; currentName: string }>) {
    console.log("page.svelte: Received openrenamemodal event", event.detail);
    renameTargetListId = event.detail.listNodeId;
    renameTargetListName = event.detail.currentName;

    // Imperatively find and open the rename dialog
    const modal = document.getElementById('rename_list_modal') as HTMLDialogElement | null;
    if (modal) {
        console.log("+page.svelte: Found rename modal, attempting to show...");
        modal.showModal();
    } else {
        console.error("+page.svelte: Could not find RenameListModal dialog element!");
    }
  }

  async function handleCheckNip05(event: CustomEvent<{ identifier: string; node: TreeNodeData }>) {
    const { identifier, node } = event.detail;
    console.log(`Received checknip05 event for: ${identifier} (Node ID: ${node.id})`);
    nip05VerificationStates[identifier] = { status: 'checking', newlyResolvedNpub: null, errorMsg: null };
    nip05VerificationStates = { ...nip05VerificationStates };
    try {
      const resultState = await verifyNip05(identifier, node.pubkey);
      nip05VerificationStates[identifier] = resultState;
      console.log(`NIP-05 check result for ${identifier}:`, resultState);
    } catch (err: any) {
      console.error(`Error during NIP-05 verification for ${identifier}:`, err);
      nip05VerificationStates[identifier] = { status: 'failed', newlyResolvedNpub: null, errorMsg: err.message || 'Verification failed' };
    } finally {
      nip05VerificationStates = { ...nip05VerificationStates };
    }
  }

  function handleViewProfile(event: CustomEvent<{ npub: string }>) {
    const npub = event.detail.npub;
    console.log(`Page: handleViewProfile ${npub}`);
    viewingNpub = npub;
    viewingFeedForNodeId = null;
  }

  function handleViewFeed(event: CustomEvent<{ listNodeId: string; listName: string }>) {
    console.log(`+page.svelte: Received viewfeed event for Node ID: ${event.detail.listNodeId}`);
    viewingNpub = null;
    viewingFeedForNodeId = event.detail.listNodeId;
    viewingFeedForListName = event.detail.listName;
  }

  function handleBackToLists() {
    viewingNpub = null;
    viewingFeedForNodeId = null;
    viewingFeedForListName = null;
  }

  function handleAddItemRequest(event: CustomEvent<{ parentId: string }>) {
    modalTargetListId = event.detail.parentId;
    console.log(`Opening add item modal for parent list ID: ${modalTargetListId}`);
    const modal = document.getElementById('add_item_modal') as HTMLDialogElement | null;
    modal?.showModal();
  }

  function handleViewEvent(event: CustomEvent<{ eventId: string }>) {
    console.log("Page: handleViewEvent", event.detail.eventId);
    viewingEventId = event.detail.eventId;
    showEventViewModal = true;
  }

  async function handleManualSync() {
    const currentUser = get(user);
    if (!currentUser?.pubkey) {
      generalErrorMessage = 'Cannot sync without a logged-in user.';
      return;
    }
    if (!$isOnline) {
      generalErrorMessage = 'Cannot sync while offline.';
      return;
    }
    console.log("Starting manual sync...");
    isSyncing = true;
    generalErrorMessage = null;
    try {
      // await syncService.syncNow(currentUser.pubkey); // Commented out - Property 'syncNow' does not exist on type 'SyncService'.
      console.warn("syncService.syncNow() method not found or commented out.");
      console.log("Manual sync completed (or skipped due to missing syncNow).");
    } catch (err) {
      console.error("Manual sync failed:", err);
      generalErrorMessage = `Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
    } finally {
      isSyncing = false;
    }
  }

  function handleBackNavigation() {
    viewingNpub = null;
    viewingFeedForNodeId = null;
    viewingFeedForListName = null;
  }

  function handleViewResource(event: CustomEvent<{ coordinate: string }>) {
    console.log("Page: handleViewResource", event.detail.coordinate);
    viewingResourceCoordinate = event.detail.coordinate;
    showResourceViewModal = true;
  }

  function handleNavigateList(event: CustomEvent<{ coordinate: string }>) {
    console.log("Page: handleNavigateList - Navigation triggered for", event.detail.coordinate);
    // Potentially update selectedNodeId or trigger other navigation logic here
    // For now, just log it.
    // selectedNodeId = event.detail.coordinate; // Example: This might be one way
  }

  // Placeholder function for handling the add list link action from profile view
  function handleAddListLinkFromProfile(event: CustomEvent) {
    console.log('Page: handleAddListLinkFromProfile received event:', event.detail);
    // TODO: Implement logic to open a modal or UI to select a target list
    // and add an 'a' tag item with the coordinate from event.detail.listCoordinate
  }

  // --- New Function for Public Browse ---
  async function handlePublicBrowse() {
    console.log('Handling public browse button click');
    publicBrowseError = null;
    BrowsePublicHexkey = null;
    const trimmedInput = publicBrowseInput.trim();

    if (!trimmedInput) {
      publicBrowseError = 'Please enter an identifier.';
      return;
    }

    let resolvedHexkey: string | null = null;

    try {
      // 1. Check for Hex Public Key
      if (/^[a-f0-9]{64}$/i.test(trimmedInput)) {
        console.log('Input is a hex pubkey.');
        resolvedHexkey = trimmedInput;
      } else {
        // 2. Try NIP-19 Decode
        try {
          const decoded = nip19.decode(trimmedInput);
          console.log('Decoded NIP-19:', decoded);
          if (decoded.type === 'npub') {
            console.log('Input is an npub.');
            resolvedHexkey = decoded.data as string;
          } else {
            console.log('NIP-19 type is not npub:', decoded.type);
             // Don't set error yet, check NIP-05 next
          }
        } catch (nip19Error) {
          console.log('Not a valid NIP-19 identifier:', nip19Error);
           // Not NIP-19, proceed to check NIP-05
        }

        // 3. Check for NIP-05 if not resolved yet
        if (!resolvedHexkey && /.+@.+\..+/.test(trimmedInput)) {
          console.log('Input looks like a NIP-05 identifier, querying...');
          try {
            const profile = await nip05.queryProfile(trimmedInput);
            if (profile?.pubkey) {
              console.log('NIP-05 resolved to pubkey:', profile.pubkey);
              resolvedHexkey = profile.pubkey;
            } else {
              console.log('NIP-05 query succeeded but returned no pubkey.');
              publicBrowseError = `Failed to resolve NIP-05 identifier: ${trimmedInput}`;
              return; // Stop processing
            }
          } catch (nip05Error) {
            console.error('NIP-05 query failed:', nip05Error);
            publicBrowseError = `Failed to resolve NIP-05 identifier: ${trimmedInput}. Error: ${nip05Error instanceof Error ? nip05Error.message : 'Unknown NIP-05 error'}`;
            return; // Stop processing
          }
        }
      }

      // 4. Final Check and Set State
      if (resolvedHexkey) {
        console.log('Public browse requested for resolved pubkey:', resolvedHexkey);
        BrowsePublicHexkey = resolvedHexkey;
        publicBrowseError = null; // Clear previous error on success

        // --> Trigger loading public lists <--
        loadPublicLists(BrowsePublicHexkey);

      } else if (!publicBrowseError) {
        // Only set error if no other specific error was set
        console.log('Identifier format not recognized.');
        publicBrowseError = 'Invalid identifier format (expected npub, hex pubkey, or NIP-05).';
      }

    } catch (error) {
      console.error('Unexpected error during public browse handling:', error);
      publicBrowseError = `An unexpected error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  // --- New Function for Loading Public Lists ---
  async function loadPublicLists(pubkey: string) {
    console.log(`Loading public lists for pubkey: ${pubkey}`);
    listHierarchy.set([]); // Clear existing hierarchy first
    isHierarchyLoading.set(true);
    publicBrowseMessage = null;

    const listFilter: NDKFilter = {
      authors: [pubkey],
      kinds: [
        NDKKind.BookmarkList, // 30001
        NDKKind.CategorizedBookmarkList, // 30003 - If applicable, adjust as needed
        // Add other public list kinds if necessary, e.g., 10001 for MuteList if desired publicly
      ],
    };

    try {
      if (!ndkService.getNdkInstance()) {
        console.error('NDK not ready, cannot fetch public lists.');
        throw new Error('Nostr connection not available.');
      }
      console.log('Fetching public lists with filter:', listFilter);
      const fetchedListEventsSet = await ndkService.fetchEvents(listFilter);
      console.log(`Fetched ${fetchedListEventsSet.size} public list events.`);

      if (fetchedListEventsSet.size > 0) {
        const tempStoredEvents: StoredEvent[] = Array.from(fetchedListEventsSet).map(event => ({
          id: event.id,
          kind: event.kind ?? 30001, // Default kind if undefined, adjust if needed
          pubkey: event.pubkey,
          created_at: event.created_at ?? Math.floor(Date.now() / 1000),
          tags: event.tags,
          content: event.content,
          sig: event.sig ?? '',
          // published: false, // Not strictly needed for temporary build
        }));

        console.log('Building temporary hierarchy from fetched public lists...');
        const hierarchy = await buildHierarchy(tempStoredEvents);

        if (hierarchy && hierarchy.length > 0) {
          console.log('Public hierarchy built successfully.');
          listHierarchy.set(hierarchy);
        } else {
          console.log('Hierarchy build resulted in empty list or error.');
          listHierarchy.set([]);
          publicBrowseMessage = 'No public lists found or could be processed for this user.';
        }
      } else {
        console.log('No public list events found for this user.');
        listHierarchy.set([]);
        publicBrowseMessage = 'No public lists found for this user.';
      }
    } catch (error) {
      console.error('Error loading public lists:', error);
      listHierarchy.set([]);
      publicBrowseMessage = `Error fetching lists: ${error instanceof Error ? error.message : 'Unknown error'}`;
    } finally {
      isHierarchyLoading.set(false);
      console.log('Finished loading public lists.');
    }
  }

  onMount(() => {
    if (browser) {
        if (!get(user)) {
            console.log('Checking for existing NIP-07 signer on mount...');
            ndkService.activateNip07Signer().then(result => {
                if (result.success && result.user && !get(user)) {
                  console.log('Found and activated existing NIP-07 signer on mount.');
                  user.set(result.user);
                } else if (!result.success && !get(user)) {
                  console.log('No active NIP-07 signer found on mount or activation failed:', result.error);
                }
            });
        } else {
             console.log('User already exists on mount, ensuring data load is triggered...');
        }
    }
  });

</script>

<div class="container mx-auto p-4 h-screen flex flex-col">
  <header class="mb-4 flex justify-between items-center">
    <h1 class="text-2xl font-bold">Nostr List Manager</h1>
    <div>
      {#if $user}
        <div class="flex items-center">
          {#if $profile}
            <span class="mr-2 hidden sm:inline">Welcome, {$profile.displayName || $profile.name || $user.npub.substring(0, 12)}...</span>
          {:else if isLoadingProfile}
            <span class="mr-2 italic text-sm">Loading profile...</span>
          {:else}
            <span class="mr-2 italic text-sm">{$user.npub.substring(0, 12)}...</span>
          {/if}
         
          <button class="btn btn-sm btn-outline btn-error ml-2" on:click={handleLogout}>Logout</button>
        </div>
      {:else}
        <div class="space-x-2">
          <button class="btn btn-sm btn-primary" on:click={handleLogin} disabled={!browser || isConnectingNip46}>
            {#if isConnectingNip46 && !nip46ConnectionError}
               <span class="loading loading-spinner loading-xs"></span> Connecting...
            {:else}
               Login (NIP-07)
            {/if}
          </button>
           <button class="btn btn-sm btn-secondary" on:click={handleNip46Login} disabled={isConnectingNip46}>
             Login with NIP-46 (Remote Signer)
          </button>
        </div>

        <!-- Public Browse Section -->
        <div class="divider my-8">OR</div>
        <div class="mt-4 flex flex-col sm:flex-row justify-center items-center space-y-2 sm:space-y-0 sm:space-x-2">
          <div class="form-control w-full max-w-md">
            <div class="flex space-x-2">
              <input
                type="text"
                placeholder="Enter npub, hex pubkey, or NIP-05..."
                class="input input-bordered w-full"
                aria-label="Nostr identifier for public list browsing"
                bind:value={publicBrowseInput}
                on:keydown={(e) => { if (e.key === 'Enter') handlePublicBrowse(); }}
              />
              <button class="btn btn-outline" on:click={handlePublicBrowse}>Browse</button>
            </div>
             {#if publicBrowseError}
                <label class="label">
                  <span class="label-text-alt text-error">{publicBrowseError}</span>
                </label>
              {/if}
          </div>
        </div>
        <!-- End Public Browse Section -->

      {/if}
    </div>
  </header>

   {#if generalErrorMessage}
      <div class="alert alert-error shadow-lg mb-4">
        <div>
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span>Error: {generalErrorMessage}</span>
        </div>
      </div>
   {/if}

  <main class="flex-grow overflow-y-auto bg-base-200 p-4 rounded-lg shadow">
    {#if $user}

      {#if viewingNpub || viewingFeedForNodeId}
        <button class="btn btn-sm btn-ghost mb-4" on:click={handleBackNavigation}>
          <Icon src={ArrowLeft} class="h-4 w-4 mr-1" /> Back to Lists
        </button>
      {/if}

      {#if viewingNpub}
        <ProfileView npub={viewingNpub} on:addlistlink={handleAddListLinkFromProfile} />
      {:else if viewingFeedForNodeId && viewingFeedForListName}
        <AggregatedFeedView listNodeId={viewingFeedForNodeId} listName={viewingFeedForListName} />
      {:else}
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-semibold">My Lists</h2>
          <div class="flex items-center space-x-2">
             <button class="btn btn-sm btn-info" on:click={handleManualSync} disabled={isSyncing || !$isOnline} title={$isOnline ? (isSyncing ? 'Syncing...' : 'Manual Sync') : 'Sync disabled offline'}>
                {#if isSyncing}
                    <span class="loading loading-spinner loading-xs"></span> Syncing...
                {:else}
                    Sync
                {/if}
            </button>
            <button 
                class="btn btn-sm btn-ghost" 
                on:click={() => { showRootsOnly = !showRootsOnly; }}
                title={showRootsOnly ? "Show Full Tree" : "Show Roots Only"}
            >
              {#if showRootsOnly}
                <Icon src={AdjustmentsHorizontal} class="w-5 h-5" />
              {:else}
                <Icon src={ListBullet} class="w-5 h-5" />
              {/if}
            </button>
            <button 
                class="btn btn-sm btn-primary" 
                on:click={() => {
                    const modal = document.getElementById('create_list_modal') as HTMLDialogElement | null;
                    if (modal) {
                        console.log("+page.svelte: Found create list modal, attempting to show...");
                        modal.showModal();
                    } else {
                         console.error("+page.svelte: Could not find CreateListModal dialog element!");
                    }
                }}
                disabled={!$isOnline}
                title={$isOnline ? 'Create New List' : 'Cannot create list offline'}
            >+ New List</button>
          </div>
        </div>

         {#if isInitialSyncing}
           <div class="text-sm italic text-info mb-2">Performing initial background sync...</div>
         {/if}

        <HierarchyWrapper
            listHierarchy={filteredHierarchy}
            nip05VerificationStates={nip05VerificationStates}
            isHierarchyLoading={$isHierarchyLoading}
            isLoadingInitialLists={isLoadingInitialLists}
            currentUserPubkey={$user?.pubkey}
            on:listchanged={handleListChanged}
            on:openadditem={handleOpenAddItem}
            on:openrenamemodal={handleOpenRenameModal}
            on:checknip05={handleCheckNip05}
            on:viewprofile={handleViewProfile}
            on:viewfeed={handleViewFeed}
            on:viewevent={handleViewEvent}
            on:viewresource={handleViewResource}
            on:navigatelist={handleNavigateList}
        />
      {/if}

    {:else if BrowsePublicHexkey}
      <div class="mb-4">
         <p class="text-sm italic">Browsing public lists for: <code class="text-xs">{BrowsePublicHexkey}</code></p>
         <button class="btn btn-xs btn-ghost mt-1" on:click={() => { BrowsePublicHexkey = null; listHierarchy.set([]); publicBrowseMessage = null; publicBrowseError = null; }}>Clear Browse</button>
      </div>

      {#if $isHierarchyLoading}
        <div class="text-center py-10">
          <span class="loading loading-lg loading-spinner text-primary"></span>
          <p class="mt-2">Loading public lists...</p>
        </div>
      {:else if $listHierarchy.length === 0}
        <div class="text-center py-10 p-4 bg-base-100 rounded-lg shadow">
          <p class="font-semibold">{publicBrowseMessage || 'No public lists found.'}</p>
        </div>
      {:else}
        <HierarchyWrapper
            listHierarchy={$listHierarchy}
            nip05VerificationStates={{}}
            isHierarchyLoading={$isHierarchyLoading}
            isLoadingInitialLists={false}
            currentUserPubkey={null}
            on:viewprofile={handleViewProfile}
            on:viewevent={handleViewEvent}
            on:viewresource={handleViewResource}
            on:navigatelist={handleNavigateList}
        />
      {/if}
    {:else}
      <div class="text-center p-8">
        <h2 class="text-xl font-semibold mb-4">Welcome!</h2>
        <p class="mb-6">Log in to manage your personal Nostr list hierarchies, or browse public lists below.</p>

        <!-- Login Buttons -->
        <div class="flex justify-center space-x-2 mb-6">
           <button class="btn btn-primary" on:click={handleLogin} disabled={!browser || isConnectingNip46}>
            {#if isConnectingNip46 && !nip46ConnectionError}
               <span class="loading loading-spinner loading-xs"></span> Connecting...
            {:else}
               Login (NIP-07)
            {/if}
          </button>
           <button class="btn btn-secondary" on:click={handleNip46Login} disabled={isConnectingNip46}>
             Login with NIP-46 (Remote Signer)
          </button>
        </div>

        <!-- Public Browse Section -->
        <div class="divider my-8">OR BROWSE PUBLIC LISTS</div>
        <div class="mt-4 flex flex-col items-center space-y-4">
          <div class="form-control w-full max-w-md">
            <div class="flex space-x-2">
              <input
                type="text"
                placeholder="Enter npub, hex pubkey, or NIP-05..."
                class="input input-bordered w-full"
                aria-label="Nostr identifier for public list browsing"
                bind:value={publicBrowseInput}
                on:keydown={(e) => { if (e.key === 'Enter') handlePublicBrowse(); }}
              />
              <button class="btn btn-outline" on:click={handlePublicBrowse}>Browse</button>
            </div>
             {#if publicBrowseError}
                <label class="label">
                  <span class="label-text-alt text-error">{publicBrowseError}</span>
                </label>
              {/if}
          </div>

           <!-- Placeholder for results/loading indicator -->
           {#if BrowsePublicHexkey}
              <div class="mt-4 p-4 bg-base-100 rounded shadow w-full max-w-md">
                 <p class="text-success">Resolved pubkey: <code class="text-xs break-all">{BrowsePublicHexkey}</code></p>
                 <p class="text-sm italic mt-2">(List display coming soon...)</p>
              </div>
           {/if}
        </div>
        <!-- End Public Browse Section -->

      </div>
    {/if}
  </main>
</div>

<Nip46ConnectModal bind:isConnecting={isConnectingNip46} bind:connectionError={nip46ConnectionError} on:initiateNip46Connect={handleInitiateNip46Connect}/>
<EventViewModal eventId={viewingEventId} bind:open={showEventViewModal} />
<ResourceViewModal bind:open={showResourceViewModal} coordinate={viewingResourceCoordinate} isOnline={$isOnline} />

<!-- Render AddItemModal unconditionally, remove bind:open -->
<AddItemModal
    targetListId={addItemTargetListId}
    targetListName={addItemTargetListName}
    on:itemadded={handleListChanged}
/>

<!-- Add the RenameListModal component instance here -->
<RenameListModal
    currentListId={renameTargetListId}
    currentListName={renameTargetListName}
/>

<!-- Add the CreateListModal instance here -->
<CreateListModal on:listcreated={handleListChanged} />

<style>
  .container {
    max-height: 100vh;
  }
</style>