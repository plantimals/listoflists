<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { localDb, type StoredEvent } from '$lib/localDb';
  import { ndkService } from '$lib/ndkService';
  import { NDKKind, type NDKUserProfile, type NDKEvent, type NDKTag } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { Icon, ClipboardDocument, ArrowUpRight, UserCircle, DocumentText, CircleStack } from 'svelte-hero-icons';
  import SelectListModal from './SelectListModal.svelte';
  import { addItemToList } from '$lib/listService';
  import TreeNode from './TreeNode.svelte';
  import type { TreeNodeData, Nip05VerificationStateType } from '$lib/types';
  import { transformStoredEventToNode } from '$lib/hierarchyService';

  export let npub: string;
  export let currentUserLists: Array<{ id: string, name: string }> = [];

  const dispatch = createEventDispatcher();

  // Profile State
  let profileData: NDKUserProfile | null = null;
  let isLoadingProfile = true;
  let profileError: string | null = null;

  // Public List State
  let isLoadingLists = false;
  let listError: string | null = null;
  let discoveredListsRoot: TreeNodeData | null = null;

  // Derived State
  let hexPubkey: string | null = null;

  // Add Link Modal State
  let showSelectListModal = false;
  let listToAddNaddr: string | null = null;
  let isAddingLink = false;
  let addLinkError: string | null = null;
  let addLinkSuccessMessage: string | null = null;

  $: {
    try {
      hexPubkey = null;
      profileData = null;
      discoveredListsRoot = null;
      isLoadingProfile = true;
      isLoadingLists = false;
      profileError = null;
      listError = null;

      hexPubkey = nip19.decode(npub).data as string;
      fetchProfile();
    } catch (e) {
      hexPubkey = null;
      profileError = 'Invalid user identifier (npub).';
      isLoadingProfile = false;
      isLoadingLists = false;
    }
  }

  async function fetchProfile() {
    if (!hexPubkey) {
      profileError = 'Cannot fetch profile: Invalid user identifier.';
      isLoadingProfile = false;
      profileData = null;
      isLoadingLists = false;
      return;
    }

    isLoadingProfile = true;
    profileError = null;
    profileData = null;
    isLoadingLists = false;
    listError = null;
    discoveredListsRoot = null;

    try {
      const localProfile = await localDb.getProfile(hexPubkey);
      if (localProfile?.profile) {
        profileData = localProfile.profile as NDKUserProfile;
        fetchPublicLists();
      } else {
        const filter = { kinds: [NDKKind.Metadata], authors: [hexPubkey], limit: 1 };
        const fetchedEvent: NDKEvent | null = await ndkService.fetchEvent(filter);

        if (fetchedEvent) {
          try {
            profileData = JSON.parse(fetchedEvent.content);
            const storedEventData: StoredEvent = {
              id: fetchedEvent.id,
              kind: fetchedEvent.kind,
              pubkey: fetchedEvent.pubkey,
              created_at: fetchedEvent.created_at ?? 0,
              tags: fetchedEvent.tags,
              content: fetchedEvent.content,
              sig: fetchedEvent.sig ?? ''
            };
            await localDb.addOrUpdateProfile(storedEventData);
            fetchPublicLists();
          } catch (parseError) {
            profileError = 'Failed to parse profile data from network.';
            profileData = null;
          }
        } else {
          profileError = 'Profile metadata (Kind 0) not found on network.';
        }
      }
    } catch (err: any) {
      profileError = `Failed to load profile: ${err.message || 'Unknown error'}`;
      profileData = null;
    } finally {
      isLoadingProfile = false;
    }
  }

  async function fetchPublicLists() {
    if (!hexPubkey) {
      listError = 'Cannot fetch lists: Invalid user identifier.';
      isLoadingLists = false;
      discoveredListsRoot = null;
      return;
    }

    isLoadingLists = true;
    listError = null;
    discoveredListsRoot = null;

    try {
      const listKinds = [30001, 30003];
      const filter = { kinds: listKinds, authors: [hexPubkey] };
      const fetchedListEvents = await ndkService.fetchEvents(filter);
      
      // --- Store fetched events locally --- START
      if (fetchedListEvents.size > 0) {
          const storePromises: Promise<void>[] = [];
          for (const event of fetchedListEvents) {
              const storedEventData: StoredEvent = {
                  id: event.id,
                  kind: event.kind,
                  pubkey: event.pubkey,
                  created_at: event.created_at ?? 0,
                  tags: event.tags,
                  content: event.content,
                  sig: event.sig ?? '',
                  published: true
              };
              storePromises.push(localDb.addOrUpdateEvent(storedEventData));
          }
          await Promise.all(storePromises);
          console.log(`ProfileView: Stored ${fetchedListEvents.size} fetched public list events locally.`);
      }
      // --- Store fetched events locally --- END
      
      // --- Retrieve latest lists from local DB --- START
      const localUserLists = await localDb.getUsersNip51Lists(hexPubkey);
      console.log(`ProfileView: Retrieved ${localUserLists.length} NIP-51 lists for ${hexPubkey} from local DB.`);
      // --- Retrieve latest lists from local DB --- END
      
      const rootNode: TreeNodeData = {
          id: `discovered-root-${hexPubkey}`,
          name: 'Discovered Public Lists',
          kind: -1,
          children: [],
          items: [],
          isSyntheticRoot: true,
          pubkey: hexPubkey,
          isExpanded: true
      };

      // --- Transform stored events to nodes --- START
      rootNode.children = localUserLists.map(storedEvent => {
          const node = transformStoredEventToNode(storedEvent);
          node.isDiscoveredList = true; // Mark as discovered for UI/handling

          // Ensure the ID used is the naddr for linking purposes, checking for defined kind, dTag, and pubkey
          if (node.dTag && node.pubkey && typeof node.kind === 'number' && node.kind >= 30000 && node.kind < 40000) {
              try {
                  // Now safe to use node.dTag, node.pubkey and node.kind
                  node.id = nip19.naddrEncode({ identifier: node.dTag, pubkey: node.pubkey, kind: node.kind });
              } catch (e) {
                  console.error(`Failed to encode naddr for discovered list: ${node.kind}:${node.pubkey}:${node.dTag}`, e);
                  // Keep the original ID (likely event ID) if encoding fails
              }
          }
          return node;
      });
      // --- Transform stored events to nodes --- END

      discoveredListsRoot = rootNode;

    } catch (err: any) {
      listError = `Failed to load public lists: ${err.message || 'Unknown error'}`;
      discoveredListsRoot = null;
    } finally {
      isLoadingLists = false;
    }
  }

  function handleAddLinkClick(event: CustomEvent<{ naddr: string }>) {
      listToAddNaddr = event.detail.naddr;
      addLinkError = null;
      addLinkSuccessMessage = null;
      showSelectListModal = true;
  }

  async function handleListSelected(event: CustomEvent<{ destinationListId: string }>) {
      const { destinationListId } = event.detail;

      if (!listToAddNaddr || !destinationListId) {
          addLinkError = 'Error: Missing information to add the link.';
          addLinkSuccessMessage = null;
          return;
      }

      isAddingLink = true;
      addLinkError = null;
      addLinkSuccessMessage = null;

      try {
          const result = await addItemToList(destinationListId, listToAddNaddr);

          if (result.success) {
              const destinationListName = currentUserLists.find(l => l.id === destinationListId)?.name || destinationListId;
              addLinkSuccessMessage = `Link added to list '${destinationListName}'!`;
              addLinkError = null;
              setTimeout(() => { addLinkSuccessMessage = null; }, 3000);
          } else {
              addLinkError = result.error || 'Failed to add link to the selected list.';
              addLinkSuccessMessage = null;
          }
      } catch (err: any) {
          addLinkError = `An unexpected error occurred: ${err.message}`;
          addLinkSuccessMessage = null;
      } finally {
          isAddingLink = false;
      }
  }

  function forwardViewEvent(event: CustomEvent<{ eventId: string }>) {
      dispatch('viewevent', event.detail);
  }
  function forwardViewProfile(event: CustomEvent<{ npub: string }>) {
      dispatch('viewprofile', event.detail);
  }
  function forwardViewResource(event: CustomEvent<{ coordinate: string }>) {
      dispatch('viewresource', event.detail);
  }
  function forwardCheckNip05(event: CustomEvent<{ identifier: string, node: TreeNodeData }>) {
      dispatch('checknip05', event.detail);
  }

  onMount(() => {
    // Initial fetch triggered by reactive block
  });

</script>

{#if isLoadingProfile}
  <div class="flex items-center justify-center space-x-2 py-10">
    <span class="loading loading-spinner text-primary"></span>
    <span>Loading Profile...</span>
  </div>
{:else if profileError}
  <div class="alert alert-error">
    <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2 2m2-2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    <span>Error! {profileError}</span>
    {#if listError && !isLoadingLists}
       <span class="text-sm mt-1">Additionally: {listError}</span>
    {/if}
  </div>
{:else if profileData}
  <div class="space-y-4">
    <!-- Profile Details -->
    <div class="card card-bordered bg-base-200 p-4 space-y-2">
      <div class="flex items-center space-x-4">
        <div class="avatar">
          {#if profileData.picture}
            <div class="w-16 rounded-full ring ring-primary ring-offset-base-100 ring-offset-2">
              <img
                src={profileData.picture}
                alt={profileData.displayName || profileData.name || 'User Avatar'}
                class="rounded-full" />
            </div>
          {:else}
            <div class="avatar placeholder">
              <div class="bg-neutral text-neutral-content rounded-full w-16 ring ring-primary ring-offset-base-100 ring-offset-2">
                <span class="text-xl">{(profileData.displayName || profileData.name || '?').charAt(0).toUpperCase()}</span>
              </div>
            </div>
          {/if}
        </div>
        <div>
          <h2 class="card-title">{profileData.displayName || profileData.name || '(Name not set)'}</h2>
          <code class="text-sm text-base-content/70 break-all">{npub}</code>
          {#if profileData.website}
             <a href={profileData.website} target="_blank" rel="noopener noreferrer" class="text-sm text-blue-500 hover:underline flex items-center">
                {profileData.website}
                <Icon src={ArrowUpRight} class="w-3 h-3 ml-1"/>
             </a>
          {/if}
        </div>
      </div>
      {#if profileData.about}
        <p class="text-base-content/90 pt-2 border-t border-base-300/50 whitespace-pre-wrap">{profileData.about}</p>
      {/if}
    </div>

    <!-- Display Add Link Success/Error -->
    {#if addLinkSuccessMessage}
      <div class="alert alert-success mt-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <span>{addLinkSuccessMessage}</span>
      </div>
    {/if}
    {#if addLinkError}
      <div class="alert alert-error mt-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2 2m2-2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <span>Error adding link: {addLinkError}</span>
      </div>
    {/if}

    <!-- Public Lists -->
    <div class="card card-bordered bg-base-100 p-4 space-y-2">
      <h3 class="font-semibold text-lg border-b border-base-300 pb-1 mb-2">Public Lists</h3>
      {#if isLoadingLists}
        <div class="flex items-center justify-center space-x-2 py-4">
          <span class="loading loading-spinner text-primary"></span>
          <span>Loading List Index...</span>
        </div>
      {:else if listError}
        <div class="alert alert-warning text-sm p-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <span>Could not load lists: {listError}</span>
        </div>
      {:else if discoveredListsRoot && discoveredListsRoot.children.length > 0}
        <div class="mt-4 pt-4 border-t border-base-300">
          <h3 class="text-lg font-semibold mb-2">Public Lists by this User</h3>
          {#each discoveredListsRoot.children as listNode (listNode.id)}
            <TreeNode
              node={listNode}
              depth={0}
              verificationStates={{}}
              on:addlink={handleAddLinkClick}
              on:viewprofile={(e) => dispatch('viewprofile', e.detail)}
              on:viewevent={(e) => dispatch('viewevent', e.detail)}
              on:viewresource={(e) => dispatch('viewresource', e.detail)}
              on:viewlist={(e) => dispatch('viewlist', e.detail)}
              on:error={(e) => dispatch('error', e.detail)}
            />
          {/each}
        </div>
      {:else}
        <p class="text-base-content/70 italic">No public lists found for this user.</p>
      {/if}
    </div>
  </div>
{:else}
  <div class="alert alert-warning">
    <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
    <span>Profile data could not be loaded or found for this user.</span>
     {#if listError && !isLoadingLists}
       <span class="text-sm mt-1">List Check: {listError}</span>
    {/if}
  </div>
{/if}

<SelectListModal bind:open={showSelectListModal} userLists={currentUserLists} on:listselected={handleListSelected} /> 