<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import type { TreeNodeData, Nip05VerificationStateType } from '$lib/types';
    import TreeNode from '$lib/components/TreeNode.svelte';
    import AddItemModal from './AddItemModal.svelte';

    export let listHierarchy: TreeNodeData[] = [];
    export let nip05VerificationStates: { [id: string]: Nip05VerificationStateType } = {};
    export let isHierarchyLoading: boolean = true; // Pass loading state
    export let isLoadingInitialLists: boolean = true; // Pass loading state

    let showAddItemModal = false;
    let addItemParentId: string | null = null;

    const dispatch = createEventDispatcher<{
        viewprofile: { npub: string };
        viewfeed: { listNodeId: string; listName: string };
    }>();

    // Forward events from TreeNode
    function forwardEvent(event: any) {
        dispatch(event.type, event.detail);
    }

    function handleAddItemRequest(event: CustomEvent<{ parentId: string }>) {
        addItemParentId = event.detail.parentId;
        showAddItemModal = true;
    }

    // Forward viewprofile events from TreeNode
    function forwardViewProfile(event: CustomEvent<{ npub: string }>) {
        dispatch('viewprofile', event.detail);
    }

    // Forward viewfeed events from TreeNode
    function forwardViewFeed(event: CustomEvent<{ listNodeId: string; listName: string }>) {
        dispatch('viewfeed', event.detail);
    }

</script>

{#if isHierarchyLoading || isLoadingInitialLists }
    <div class="flex justify-center items-center h-full">
        <span class="loading loading-lg loading-spinner text-primary"></span>
        {#if isLoadingInitialLists}
            <span class="ml-4 text-lg italic">Fetching lists from network...</span>
        {:else}
            <span class="ml-4 text-lg italic">Building hierarchy from local data...</span>
        {/if}
    </div>
{:else if listHierarchy.length > 0}
    <div class="mt-4 space-y-2 overflow-auto" style="max-height: 70vh;">
        {#each listHierarchy as rootNode (rootNode.id)}
            <TreeNode 
                node={rootNode} 
                verificationStates={nip05VerificationStates}
                on:checknip05={forwardEvent}  
                on:listchanged={forwardEvent} 
                on:openadditem={handleAddItemRequest} 
                on:openrenamemodal={forwardEvent}
                on:viewprofile={forwardViewProfile}
                on:viewfeed={forwardViewFeed}
                depth={0}
                isRootNode={true} />
        {/each}
    </div>
{:else}
    <div class="flex justify-center items-center h-full">
         <p class="text-lg text-base-content/70 italic">
            (No lists found locally or hierarchy failed to build).
             Try refreshing or checking relay connections.
         </p>
    </div>
{/if}

{#if showAddItemModal && addItemParentId}
    <AddItemModal targetListId={addItemParentId} />
{/if} 