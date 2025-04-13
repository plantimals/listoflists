<script lang="ts">
    // Keep the props definition
    // import type { TreeNodeData } from '$lib/hierarchyService'; // Import path might need adjustment based on project structure
    import type { TreeNodeData } from '$lib/types'; // Corrected import and type name
    // Removed UserItem import
    // Removed NoteItem import
    import NodeHeader from './NodeHeader.svelte'; // Import the new header component
    import NodeActions from './NodeActions.svelte'; // Import the new actions component
    import NodeItemsList from '$lib/components/NodeItemsList.svelte'; // Use $lib alias for import
    import { get } from 'svelte/store';
    import { user } from '$lib/userStore';
    import { refreshTrigger } from '$lib/refreshStore';
    // Removed removeItemFromList import
    import * as listService from '$lib/listService'; // Import listService namespace
    // import AddItemModal from './AddItemModal.svelte'; // Import the modal - Removed
    import { createEventDispatcher, onMount, onDestroy } from 'svelte'; // Import dispatcher and lifecycle functions
    import { localDb, type StoredEvent } from '$lib/localDb'; // Re-added for removeListFromParent
    import { ndkService } from '$lib/ndkService'; // Re-added for removeListFromParent
    import { NDKEvent } from '@nostr-dev-kit/ndk'; // Re-added for removeListFromParent
    import { nip19 } from 'nostr-tools'; // Import nip19
    import { isOnline } from '$lib/networkStatusStore'; // <-- Ensure isOnline is imported
    import type { Nip05VerificationStateType } from '$lib/types'; // <-- Import the type from $lib/types
    // Import Icon component and the specific icon definition
    // import { Icon, PencilSquare, Trash } from 'svelte-hero-icons';

    export let node: TreeNodeData;
    export let depth: number = 0; // Use depth
    export let verificationStates: { [id: string]: Nip05VerificationStateType }; // <-- Use the imported type

    let expanded: boolean = false; // State for expand/collapse
    let isAdding: boolean = false;
    // Removed isRemovingItemId state
    let errorMessage: string | null = null; // Declare errorMessage (keep for handleDeleteList)
    let isDeleting: boolean = false; // Add loading state for delete (keep for handleDeleteList)
    let isEditingName: boolean = false; // For rename state
	let editedName: string = ''; // For rename input
	let inputRef: HTMLInputElement | null = null; // For rename input focus

    // State for Add Item Modal context - Removed
    // let addItemTargetListId: string | null = null;
    // let addItemTargetListName: string = '';

    const dispatch = createEventDispatcher(); // Instantiate dispatcher

    // Reference to the modal component instance - Removed
    // let addItemModalInstance: AddItemModal;

    function toggleExpand() {
        expanded = !expanded;
    }

    // Removed ListItem type definition

    // Removed handleRemoveItem function

    // Event Handlers/Forwarders (triggered by NodeActions)
    function openAddItemModal(event: CustomEvent<{ parentId: string }>) { 
        console.log(`TreeNode: Forwarding openadditem for parent ${event.detail.parentId}`);
        dispatch('openadditem', event.detail); 
    }
    function openRenameModal(event: CustomEvent<{ listNodeId: string; currentName: string }>) { 
        console.log(`TreeNode: Forwarding openrenamemodal for list ${event.detail.listNodeId}`);
        dispatch('openrenamemodal', event.detail); 
    }
    async function handleDeleteList(event: CustomEvent<{ listNodeId: string; listName: string }>) {
        // Kept the version that accepts event detail
        console.log(`TreeNode: Handling deletelist for list ${event.detail.listNodeId}`);
        if (!window.confirm(`Delete list \"${event.detail.listName}\"?`)) return;
        isDeleting = true;
        errorMessage = null;
        try {
            const result = await listService.deleteList(event.detail.listNodeId);
            if (!result.success) {
                errorMessage = result.error || 'Failed to delete list.';
                console.error(`Failed to delete list ${event.detail.listNodeId}:`, errorMessage);
            } else {
                console.log(`Successfully initiated deletion for list ${event.detail.listNodeId}`);
            }
        } catch (error: any) {
            errorMessage = 'An unexpected error occurred during deletion.';
            console.error("Unexpected error calling listService.deleteList:", error);
        } finally {
            isDeleting = false;
        }
    }
    
    // Event Handlers (triggered by NodeHeader)
    function handleStartEdit() { 
        editedName = node.name;
		isEditingName = true;
		setTimeout(() => { inputRef?.focus(); inputRef?.select(); }, 0);
    }
	function handleCancelEdit() { isEditingName = false; }
	async function handleSubmitName(event: CustomEvent<string>) {
        isEditingName = false;
        const newName = event.detail.trim();
		if (newName && newName !== node.name) {
            console.log(`TreeNode: Handling submitname for list ${node.id} to ${newName}`);
            errorMessage = null;
            try {
                const result = await listService.renameList(node.id, newName);
                if (!result.success) {
                    errorMessage = result.error || 'Failed to rename list.';
                     console.error(`Failed to rename list ${node.id}:`, errorMessage);
                } else {
                    console.log(`Successfully renamed list ${node.id} to ${newName}`);
                }
            } catch (error: any) {
                errorMessage = 'An unexpected error occurred during rename.';
                console.error("Unexpected error calling listService.renameList:", error);
            }
		}
	}

    // Event Forwarding (from NodeHeader or NodeItemsList)
	function forwardViewFeed(event: CustomEvent<{ listNodeId: string; listName: string }>) { 
        console.log(`TreeNode: Forwarding viewfeed for list ${event.detail.listNodeId}`);
        dispatch('viewfeed', event.detail); 
    }
    function forwardViewProfile(event: CustomEvent<{ npub: string }>) { 
        console.log(`TreeNode: Forwarding viewprofile for ${event.detail.npub}`);
        dispatch('viewprofile', event.detail); 
    }

    // Generic forwarder function
    function forwardEvent(event: CustomEvent<any>) {
        console.log(`TreeNode: Forwarding event type '${event.type}' with detail:`, event.detail);
        dispatch(event.type, event.detail);
    }

    // Forward checknip05 from NodeItemsList
    function forwardCheckNip05(event: CustomEvent<any>) {
        dispatch('checknip05', event.detail);
    }

    // Kept removeListFromParent - Requires localDb, ndkService, NDKEvent
    async function removeListFromParent(childListId: string, parentListId: string) {
        console.log(`Removing child list ${childListId} from parent ${parentListId}`);

        // Get signer from service
        const signer = ndkService.getSigner();
        const ndkInstanceForEvent = ndkService.getNdkInstance();
        if (!signer || !ndkInstanceForEvent) {
             console.error('Signer or NDK instance not available. Cannot remove list.');
            return;
        }

        try {
            // 1. Fetch the latest version of the parent list event using ID
            const parentEventData = await localDb.getEventById(parentListId); // Use getEventById
            if (!parentEventData) {
                throw new Error(`Parent list event ${parentListId} not found in local DB.`);
            }

            // 2. Create a new event based on the parent, removing the child tag
            const updatedEvent = new NDKEvent(ndkInstanceForEvent);
            updatedEvent.kind = parentEventData.kind;
            updatedEvent.content = parentEventData.content;
            // Ensure tags are copied before filtering
            updatedEvent.tags = parentEventData.tags.filter(tag => !(tag[0] === 'a' && tag[1].includes(childListId))); // Assuming 'a' tag format includes coordinate

            // 3. Sign the updated event
            await updatedEvent.sign(signer);
            console.log('Signed updated parent list event:', updatedEvent);

            // 4. Publish the updated event
            const publishedTo = await ndkService.publish(updatedEvent);

            if (publishedTo.size === 0) {
                throw new Error('Updated parent list event was not published to any relays.');
            }

            dispatch('listremoved', { parentId: parentListId, childId: childListId });
            refreshTrigger.update(n => n + 1);
        } catch (error: any) {
            console.error('Error removing list from parent:', error);
            alert('An error occurred while removing the list from its parent.');
        }
    }
</script>

<!-- Use the new NodeHeader component -->
<NodeHeader 
    {node} 
    {depth} 
    bind:isExpanded={expanded} 
    on:toggle={toggleExpand}
    bind:isEditingName={isEditingName}
    bind:editedName={editedName}
    bind:inputRef={inputRef} 
    on:submitname={handleSubmitName}
    on:canceledit={handleCancelEdit}
    on:startedit={handleStartEdit}
>
    <svelte:fragment slot="actions">
        <NodeActions
            {node}
            currentUserPubkey={$user?.pubkey}
            isOnline={$isOnline}
            bind:isDeleting={isDeleting} 
            bind:isEditingName={isEditingName}
            isRootNode={depth === 0}
            on:additem={openAddItemModal}       
            on:deletelist={handleDeleteList}    
            on:renamelist={openRenameModal}     
            on:viewfeed={forwardViewFeed}      
        />
    </svelte:fragment>
</NodeHeader>

<!-- Render Items using NodeItemsList when Expanded -->
{#if expanded && node.items && node.items.length > 0}
    <NodeItemsList 
      {node} 
      level={depth} 
      {verificationStates} 
      on:checknip05={forwardCheckNip05}
      on:viewprofile={forwardViewProfile}
      on:viewevent={forwardEvent}
      on:navigatelist={forwardEvent}
      on:viewresource={forwardEvent}
    /> 
{/if}


<!-- Recursive Children -->
{#if expanded && node.children && node.children.length > 0}
  <div class="mt-1" style="margin-left: 0;"> 
    {#each node.children as childNode (childNode.id)}
      <svelte:self 
          node={childNode} 
          depth={depth + 1} 
          verificationStates={verificationStates}
          on:listchanged 
          on:openadditem 
          on:openrenamemodal
          on:viewprofile
          on:viewfeed
          on:viewevent
          on:navigatelist
          on:viewresource
      />
    {/each}
  </div>
{/if}