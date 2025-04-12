<script lang="ts">
    import { onMount, createEventDispatcher } from 'svelte';
    import { ndkService } from '$lib/ndkService'; // Although not used directly in onMount, might be useful later
    // Correct import for key generation from nostr-tools
    import { getPublicKey, finalizeEvent, nip04 } from 'nostr-tools';
    // Assuming NDK will handle secret generation internally for NIP-46 connection setup?
    // Let's simplify: NDKRemoteSigner likely manages the local secret key itself when given a connection string.
    // We just need to provide the connectionString to the service.
    // Removing local secret generation from the modal.
    import QRCode from 'qrcode';

    export let isConnecting: boolean = false;
    export let connectionError: string | null = null;

    // State related to URI generation is no longer needed here, as the modal
    // will primarily act as an input for a bunker URL or a pasted nostrconnect URI
    // or trigger the connection based on a *yet to be generated* URI if we decide NDK handles it.
    // For now, let's assume user provides the connection string.

    // let connectUri: string | null = null;
    // let qrCodeDataUrl: string | null = null;
    let bunkerUrlInput: string = ''; // Renamed for clarity, this is the primary input now
    let internalErrorMessage: string | null = null;
    // let showCopiedMessage: boolean = false; // No URI to copy in this simplified version

    const dispatch = createEventDispatcher();

    onMount(async () => {
        internalErrorMessage = null; // Reset internal errors on mount
        // No URI/QR generation needed here anymore in this revised approach
        console.log("NIP-46 Modal mounted, ready for connection string input.");
    });

    function handleConnectClick() {
        const connectionString = bunkerUrlInput.trim();
        if (!connectionString) {
            internalErrorMessage = "Please paste a NIP-46 connection string (nostrconnect://... or bunker://...)." ;
            return;
        }
        internalErrorMessage = null; // Clear error if input is valid

        console.log(`Dispatching initiateNip46Connect with connection string: ${connectionString.substring(0, 50)}...`);
        dispatch('initiateNip46Connect', {
            connectionString: connectionString
        });
    }

    // copyUriToClipboard function removed as connectUri is removed

</script>

<dialog id="nip46_connect_modal" class="modal modal-bottom sm:modal-middle">
    <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Connect Remote Signer (NIP-46)</h3>
        <p class="py-2 text-sm">Paste your NIP-46 connection string (e.g., from Amber or another Nostr Connect compatible app) below.</p>

        {#if internalErrorMessage}
            <div role="alert" class="alert alert-warning my-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <span>{internalErrorMessage}</span>
            </div>
        {/if}

        <!-- Connection String Input -->
        <div class="form-control mt-4">
            <label class="label" for="connection-string-input">
                <span class="label-text">Connection String:</span>
            </label>
            <textarea
                id="connection-string-input"
                bind:value={bunkerUrlInput} 
                on:input={() => internalErrorMessage = null}
                placeholder="Paste nostrconnect://... or bunker://..."
                class="textarea textarea-bordered w-full h-24 text-sm"
                disabled={isConnecting}
            ></textarea>
        </div>

        <!-- Status/Error Display -->
        {#if isConnecting}
            <div class="flex items-center justify-center mt-4 text-info">
                <span class="loading loading-spinner loading-sm mr-2"></span>
                Connecting... Please check your signer app to approve.
            </div>
        {/if}
        {#if connectionError}
            <div role="alert" class="alert alert-error mt-4">
                 <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2 2m2-2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span>Connection Failed: {connectionError}</span>
            </div>
        {/if}

        <!-- Modal Actions -->
        <div class="modal-action mt-6">
             <!-- Connect Button -->
             <button
                class="btn btn-primary"
                on:click={handleConnectClick}
                disabled={isConnecting || !bunkerUrlInput.trim()}
                title={!bunkerUrlInput.trim() ? 'Please paste a connection string' : 'Initiate connection'}
                >
                {#if isConnecting}
                    <span class="loading loading-spinner loading-xs"></span> Connecting...
                {:else}
                    Connect
                {/if}
            </button>
            <!-- Cancel Button -->
             <form method="dialog">
                <!-- Add on:click handler to potentially reset state if needed when cancelling -->
                <button class="btn" disabled={isConnecting} on:click={() => { bunkerUrlInput = ''; internalErrorMessage = null; }}>Cancel</button>
            </form>
        </div>
    </div>

     <!-- Click outside to close -->
     <form method="dialog" class="modal-backdrop">
        <button disabled={isConnecting} on:click={() => { bunkerUrlInput = ''; internalErrorMessage = null; }}>close</button>
     </form>
</dialog> 