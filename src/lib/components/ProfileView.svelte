<script lang="ts">
  import { onMount } from 'svelte';
  import { localDb, type StoredEvent } from '$lib/localDb';
  import { ndkService } from '$lib/ndkService';
  import { NDKKind, type NDKUserProfile, type NDKEvent, type NDKTag } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';

  export let npub: string;

  // Profile State
  let profileData: NDKUserProfile | null = null;
  let isLoadingProfile = true;
  let profileError: string | null = null;

  // Public List State
  let publicLists: Array<{ name: string, naddr: string, kind: number }> = [];
  let isLoadingLists = false;
  let listError: string | null = null;

  // Derived State
  let hexPubkey: string | null = null;

  $: {
    try {
      // Reset state when npub changes before decoding
      hexPubkey = null;
      profileData = null;
      publicLists = [];
      isLoadingProfile = true;
      isLoadingLists = false;
      profileError = null;
      listError = null;

      hexPubkey = nip19.decode(npub).data as string;
      console.log(`ProfileView: Decoded npub ${npub} to hex ${hexPubkey}`);
      // Trigger fetches after successful decode
      fetchProfile();
    } catch (e) {
      console.error(`ProfileView: Failed to decode npub ${npub}`, e);
      hexPubkey = null;
      profileError = 'Invalid user identifier (npub).';
      isLoadingProfile = false;
      isLoadingLists = false; // Ensure list loading stops if npub invalid
    }
  }

  async function fetchProfile() {
    if (!hexPubkey) {
      profileError = 'Cannot fetch profile: Invalid user identifier.';
      isLoadingProfile = false;
      profileData = null;
      isLoadingLists = false; // Don't attempt list fetch if profile fails early
      return;
    }

    console.log(`ProfileView: Fetching profile for hex: ${hexPubkey}`);
    isLoadingProfile = true;
    profileError = null;
    profileData = null;
    // Reset list state too, as it depends on profile fetch success
    isLoadingLists = false;
    listError = null;
    publicLists = [];

    try {
      // 1. Local Check
      const localProfile = await localDb.getProfile(hexPubkey);
      if (localProfile?.profile) {
        console.log(`ProfileView: Found profile locally for ${hexPubkey}`);
        profileData = localProfile.profile as NDKUserProfile;
        // Proceed to fetch lists after successful profile load
        fetchPublicLists(); 
      } else {
        // 2. Network Fetch
        console.log(`ProfileView: Profile not found locally for ${hexPubkey}, fetching from network...`);
        const filter = { kinds: [NDKKind.Metadata], authors: [hexPubkey], limit: 1 };
        const fetchedEvent: NDKEvent | null = await ndkService.fetchEvent(filter);

        if (fetchedEvent) {
          console.log(`ProfileView: Fetched profile event from network for ${hexPubkey}`);
          try {
            profileData = JSON.parse(fetchedEvent.content);
            console.log(`ProfileView: Parsed profile data for ${hexPubkey}`, profileData);

            // Save to local DB
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
            console.log(`ProfileView: Saved fetched profile to local DB for ${hexPubkey}`);
            // Proceed to fetch lists after successful profile load and save
            fetchPublicLists(); 
          } catch (parseError) {
            console.error(`ProfileView: Failed to parse profile content for ${hexPubkey}:`, parseError);
            profileError = 'Failed to parse profile data from network.';
            profileData = null; // Clear potentially partial data
          }
        } else {
          console.log(`ProfileView: No profile event found on network for ${hexPubkey}`);
          profileError = 'Profile metadata (Kind 0) not found on network.';
        }
      }
    } catch (err: any) {
      console.error(`ProfileView: Error fetching profile for ${hexPubkey}:`, err);
      profileError = `Failed to load profile: ${err.message || 'Unknown error'}`;
      profileData = null;
    } finally {
      isLoadingProfile = false;
      // Do not set isLoadingLists here, fetchPublicLists handles its own loading state
    }
  }

  async function fetchPublicLists() {
    if (!hexPubkey) {
      listError = 'Cannot fetch lists: Invalid user identifier.';
      isLoadingLists = false;
      publicLists = [];
      return;
    }

    console.log(`ProfileView: Fetching public lists for hex: ${hexPubkey}`);
    isLoadingLists = true;
    listError = null;
    publicLists = [];

    try {
      const listKinds = [30001, 30003]; // Kinds for NIP-51 lists (Bookmarks, Highlights)
      const filter = { kinds: listKinds, authors: [hexPubkey] };
      const fetchedListEvents = await ndkService.fetchEvents(filter);

      if (fetchedListEvents.size > 0) {
        console.log(`ProfileView: Found ${fetchedListEvents.size} potential public list events for ${hexPubkey}`);
        const processedLists = new Map<string, { name: string, naddr: string, kind: number }>();

        for (const event of fetchedListEvents) {
          const dTag = event.tags.find((t: NDKTag) => t[0] === 'd');
          if (!dTag || !dTag[1]) continue; // Skip if no dTag identifier

          const dTagValue = dTag[1];
          const titleTag = event.tags.find((t: NDKTag) => t[0] === 'title');

          const name = titleTag?.[1] || dTagValue || `Kind ${event.kind} List`;
          const kind = event.kind;
          const pubkey = event.pubkey;

          // Construct naddr
          try {
            const naddr = nip19.naddrEncode({ identifier: dTagValue, pubkey: pubkey, kind: kind });
            // Use naddr as the key to avoid duplicates if multiple events define the same list
            if (!processedLists.has(naddr)) {
              processedLists.set(naddr, { name, naddr, kind });
            }
          } catch (encodeError) {
            console.error(`ProfileView: Failed to encode naddr for event ${event.id}:`, encodeError);
          }
        }
        publicLists = Array.from(processedLists.values());
        console.log(`ProfileView: Processed public lists for ${hexPubkey}:`, publicLists);

      } else {
        console.log(`ProfileView: No public list events (kinds ${listKinds.join(', ')}) found for ${hexPubkey}`);
        publicLists = [];
      }
    } catch (err: any) {
      console.error(`ProfileView: Error fetching public lists for ${hexPubkey}:`, err);
      listError = `Failed to load public lists: ${err.message || 'Unknown error'}`;
      publicLists = [];
    } finally {
      isLoadingLists = false;
    }
  }

  onMount(() => {
    // Initial fetch is triggered by the reactive block `$: { ... }` after npub is decoded
  });

  // Reactive statement to handle npub changes AFTER initial mount is now handled by the main $: block

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
    {#if listError && !isLoadingLists} <!-- Show list error if profile also errored -->
       <span class="text-sm mt-1">Additionally: {listError}</span>
    {/if}
  </div>
{:else if profileData}
  <!-- Profile Found and Loaded -->
  <div class="space-y-4">
    <!-- Profile Details -->
    <div class="card card-bordered bg-base-200 p-4 space-y-2">
      <div class="flex items-center space-x-4">
        <div class="avatar placeholder">
          {#if profileData.image}
            <div class="bg-neutral text-neutral-content rounded-full w-16 ring ring-primary ring-offset-base-100 ring-offset-2">
              <img src={profileData.image} alt={profileData.displayName || profileData.name || 'avatar'} />
            </div>
          {:else}
            <div class="bg-neutral text-neutral-content rounded-full w-16 ring ring-primary ring-offset-base-100 ring-offset-2">
              <span class="text-xl">{(profileData.displayName || profileData.name || '?').charAt(0).toUpperCase()}</span>
            </div>
          {/if}
        </div>
        <div>
          <h2 class="card-title">{profileData.displayName || profileData.name || '(Name not set)'}</h2>
          <code class="text-sm text-base-content/70 break-all">{npub}</code>
        </div>
      </div>
      {#if profileData.about}
        <p class="text-base-content/90 pt-2 border-t border-base-300/50">{profileData.about}</p>
      {/if}
    </div>

    <!-- Public Lists -->
    <div class="space-y-2">
      <h3 class="text-lg font-semibold">Public Lists</h3>
      <div class="card card-bordered bg-base-200 p-4 min-h-20">
        {#if isLoadingLists}
          <div class="flex items-center justify-center space-x-2 text-sm">
            <span class="loading loading-spinner loading-xs"></span>
            <span>Loading lists...</span>
          </div>
        {:else if listError}
          <div class="alert alert-warning alert-sm py-2 px-3 text-xs">
             <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-4 w-4" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <span>{listError}</span>
          </div>
        {:else if publicLists.length > 0}
          <!-- Display Found Lists -->
          <div class="space-y-1">
            {#each publicLists as list (list.naddr)}
              <div class="flex items-center justify-between p-2 rounded hover:bg-base-300/50">
                <div>
                  <span class="font-medium text-sm">{list.name}</span>
                  <code class="block text-xs text-base-content/60 truncate" title={list.naddr}>
                    ({list.kind}) {list.naddr}
                  </code>
                </div>
                <button 
                  class="btn btn-xs btn-outline btn-primary ml-2" 
                  on:click={() => console.log('Add Link clicked for list:', list.name, list.naddr)}
                >
                  Add Link
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <!-- No Lists Found -->
          <p class="text-base-content/60 italic text-sm text-center py-4">
            No public lists (Kind 30001 or 30003) found for this user.
          </p>
        {/if}
      </div>
    </div>
  </div>
{:else}
  <!-- Profile not found (but no specific error occurred) -->
   <div class="alert alert-warning">
    <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
    <span>Profile data could not be loaded or found for this user.</span>
     {#if listError && !isLoadingLists} <!-- Show list error if profile failed but list check ran -->
       <span class="text-sm mt-1">List Check: {listError}</span>
    {/if}
  </div>
{/if} 