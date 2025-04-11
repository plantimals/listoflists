import { NDKEvent } from '@nostr-dev-kit/ndk';
import { localDb, type StoredEvent, isReplaceableKind } from '$lib/localDb';
import { nip19 } from 'nostr-tools'; // Import nip19 from nostr-tools
import { ndkService } from '$lib/ndkService';
import { user } from '$lib/userStore';
import { get } from 'svelte/store';

// Interfaces (Define Item here and export it)
export interface Item {
    type: 'p' | 'e' | 'a'; // Allow 'a' type
    value: string;
    relay?: string; // Optional relay hint
    newEventId?: string;
}

export interface ServiceResult {
    success: boolean;
    error?: string;
    newEventId?: string;
}

// Helper function to parse coordinate ID
function parseCoordinateId(coordinateId: string): { kind: number; pubkey: string; dTag?: string } | null {
    const parts = coordinateId.split(':');
    if (parts.length < 2 || parts.length > 3) return null;
    const kind = parseInt(parts[0], 10);
    const pubkey = parts[1];
    const dTag = parts[2]; // Will be undefined if length is 2

    if (isNaN(kind) || !/^[a-f0-9]{64}$/i.test(pubkey) || (parts.length === 3 && dTag === undefined)) {
        return null;
    }
    return { kind, pubkey, dTag };
}

/**
 * Adds an item (p, e, or a tag) to a specific list event identified by its coordinate ID.
 * Creates a new version of the event, signs it, and saves it locally as unpublished.
 * @param listCoordinateId The coordinate ID (kind:pubkey or kind:pubkey:dTag) of the list to modify.
 * @param itemInput The raw identifier string (npub, note1, naddr, nevent, hex ID, coordinate) to add.
 * @returns Promise<ServiceResult> indicating success or failure.
 */
export async function addItemToList(
    listCoordinateId: string,
    itemInput: string
): Promise<ServiceResult> {
    const currentUser = get(user);
    const ndkInstance = ndkService.getNdkInstance(); // Get instance from service
    const signer = ndkService.getSigner(); // Get signer from service
    const trimmedInput = itemInput.trim();
    console.log(`addItemToList called for list coordinate: ${listCoordinateId}, input: \"${trimmedInput}\"`);

    if (!currentUser?.pubkey) {
        return { success: false, error: 'User not logged in' };
    }
    if (!ndkInstance) {
        return { success: false, error: 'NDK not initialized' };
    }
    if (!signer) {
        return { success: false, error: 'Nostr signer not available (NIP-07?)' };
    }
    if (!trimmedInput) {
        return { success: false, error: 'Input cannot be empty' };
    }

    // Parse and validate list coordinate ID
    const parsedCoord = parseCoordinateId(listCoordinateId);
    if (!parsedCoord) {
        return { success: false, error: 'Invalid list coordinate ID format.' };
    }
    const { kind, pubkey, dTag } = parsedCoord;

    // Validate list ownership
    if (pubkey !== currentUser.pubkey) {
         return { success: false, error: 'Cannot modify a list belonging to another user.' };
    }

    try {
        // Fetch the latest version using the coordinate
        const currentStoredEvent = await localDb.getLatestEventByCoord(kind, pubkey, dTag);
        if (!currentStoredEvent) {
            return { success: false, error: `List event with coordinate ${listCoordinateId} not found locally.` };
        }
        // Double check pubkey
        if (currentStoredEvent.pubkey !== currentUser.pubkey) {
             console.error("DB returned event for coordinate but pubkey doesn't match current user!", { coord: listCoordinateId, eventPk: currentStoredEvent.pubkey, userPk: currentUser.pubkey });
            return { success: false, error: 'List ownership mismatch. Cannot modify.' };
        }
         console.log('Found current list event by coordinate:', currentStoredEvent);

        // --- Auto-detection and Kind Fetching Logic ---
        let tagToAdd: string[] | null = null;
        let eventKind: number | undefined = undefined;
        let hexEventId: string | undefined = undefined;
        let potentialRelayHint: string | undefined = undefined;
        let potentialTagType: 'p' | 'e' | 'a' | undefined = undefined;

        try {
            const decoded = nip19.decode(trimmedInput);
            console.log('NIP-19 Decoded:', decoded);

            switch (decoded.type) {
                case 'npub':
                    tagToAdd = ['p', decoded.data];
                    potentialTagType = 'p';
                    break;
                case 'nprofile':
                    tagToAdd = ['p', decoded.data.pubkey];
                    potentialTagType = 'p';
                    break;
                case 'naddr': {
                    const { kind: naddrKind, pubkey: naddrPubkey, identifier: naddrDTag, relays } = decoded.data;
                    const coord = `${naddrKind}:${naddrPubkey}:${naddrDTag}`;
                    tagToAdd = relays?.length ? ['a', coord, relays[0]] : ['a', coord];
                    potentialTagType = 'a';
                    break;
                }
                case 'note':
                    hexEventId = decoded.data;
                    potentialRelayHint = undefined;
                    potentialTagType = 'e'; // Mark as potential 'e' tag
                    break;
                case 'nevent': {
                    const { id, relays } = decoded.data;
                    hexEventId = id;
                    potentialRelayHint = relays?.length ? relays[0] : undefined;
                    potentialTagType = 'e'; // Mark as potential 'e' tag
                    break;
                }
                default:
                    console.warn(`Unsupported NIP-19 type: ${decoded.type}`);
            }
        } catch (e) {
            console.log('NIP-19 decode failed, checking for hex/coordinate...');
            if (/^[a-f0-9]{64}$/i.test(trimmedInput)) {
                console.log("Detected hex ID, potentially an event ('e').");
                hexEventId = trimmedInput;
                potentialRelayHint = undefined;
                potentialTagType = 'e'; // Mark as potential 'e' tag
            }
            else {
                 const coordRegex = /^(\d+):([a-f0-9]{64}):(.*)$/i;
                 const coordMatch = trimmedInput.match(coordRegex);
                 if (coordMatch) {
                     console.log("Detected coordinate format, assuming address ('a').");
                     tagToAdd = ['a', trimmedInput];
                     potentialTagType = 'a';
                 } else {
                    console.log("Input is not a valid NIP-19 string, hex ID, or coordinate.");
                 }
            }
        }

        // --- Fetch event kind and perform validation if it's a potential 'e' tag ---
        if (potentialTagType === 'e' && hexEventId) {
            console.log(`Potential event ID detected: ${hexEventId}. Fetching kind...`);
            try {
                // 1. Check local cache
                const cachedEvent = await localDb.getEventById(hexEventId);
                if (cachedEvent) {
                    eventKind = cachedEvent.kind;
                    console.log(`Event kind ${eventKind} found in local cache for ${hexEventId}`);
                } else {
                    // 2. Fetch from network if not in cache
                    console.log(`Event ${hexEventId} not in cache, fetching from network...`);
                    const fetchedEvent = await ndkInstance.fetchEvent({ ids: [hexEventId] });
                    if (fetchedEvent) {
                        eventKind = fetchedEvent.kind;
                        console.log(`Fetched event kind ${eventKind} from network for ${hexEventId}`);
                        // Optional: Add fetched event to localDb
                    } else {
                        console.warn(`Could not find event ${hexEventId} locally or on network.`);
                        eventKind = undefined;
                    }
                }
            } catch (fetchError: any) {
                console.error(`Error fetching event kind for ${hexEventId}:`, fetchError);
                eventKind = undefined;
            }

            // ---> VALIDATION Check <----
            if (eventKind !== undefined && isReplaceableKind(eventKind)) {
                console.warn(`Attempted to add replaceable event kind ${eventKind} (${hexEventId}) as an 'e' tag.`);
                return {
                    success: false,
                    error: `Cannot add replaceable event kind ${eventKind} as a static event reference. Consider adding via naddr if applicable.`
                };
            }
            // ---> END VALIDATION Check <----

            // If validation passed (or kind is unknown), prepare the 'e' tag
            console.log(`Kind check passed (or kind unknown) for ${hexEventId}. Preparing 'e' tag.`);
            tagToAdd = potentialRelayHint ? ['e', hexEventId, potentialRelayHint] : ['e', hexEventId];

        }
        // --- End Fetch and Validation ---

        if (!tagToAdd) {
             return { success: false, error: 'Invalid or unsupported input format (expected npub, nprofile, naddr, note, nevent, hex ID, or coordinate)' };
        }
        console.log('Final tag determined:', tagToAdd);

        // --- Continue with creating the new event version ---
        const newEvent = new NDKEvent(ndkInstance);
        newEvent.kind = currentStoredEvent.kind;
        newEvent.pubkey = currentUser.pubkey;
        newEvent.content = currentStoredEvent.content;
        newEvent.created_at = Math.floor(Date.now() / 1000);

        const existingTags = currentStoredEvent.tags.filter(tag => Array.isArray(tag) && tag.length >= 2);
        const isDuplicate = existingTags.some(tag =>
            tag[0] === tagToAdd[0] &&
            tag[1] === tagToAdd[1]
        );

        if (isDuplicate) {
            console.log("Item already exists in the list, not adding duplicate tag.");
            return { success: true, newEventId: currentStoredEvent.id };
        }

        const newTags = [...existingTags, tagToAdd];
        newEvent.tags = newTags;
        console.log('New final tags:', newTags);

        console.log('Attempting to sign the new list event version...');
        await newEvent.sign(signer);
        console.log('New event signed successfully. ID:', newEvent.id, 'Sig:', newEvent.sig);

        if (!newEvent.sig || !newEvent.id) {
            throw new Error('Signing failed: Signature or ID is missing after sign attempt.');
        }

        const newStoredEvent: StoredEvent = {
            id: newEvent.id,
            kind: newEvent.kind,
            pubkey: newEvent.pubkey,
            created_at: newEvent.created_at,
            tags: newEvent.tags,
            content: newEvent.content,
            sig: newEvent.sig,
            dTag: (newEvent.kind >= 30000 && newEvent.kind < 40000) ? newEvent.tags.find(t => t[0] === 'd')?.[1] : undefined,
            published: false
        };

        console.log('Saving new event version to local DB:', newStoredEvent);
        await localDb.addOrUpdateEvent(newStoredEvent);
        console.log('New list event version saved locally.');

        return { success: true, newEventId: newStoredEvent.id };

    } catch (error: any) {
        console.error('Error in addItemToList:', error);
        return { success: false, error: error.message || 'An unknown error occurred while adding item' };
    }
}

/**
 * Removes an item (p, e, or a tag) from a specific list event identified by its coordinate ID.
 * Creates a new version of the event, signs it, and saves it locally as unpublished.
 * @param listCoordinateId The coordinate ID (kind:pubkey or kind:pubkey:dTag) of the list to modify.
 * @param itemToRemove The item {type: 'p'|'e'|'a', value: string, relay?: string} to remove.
 * @returns Promise<ServiceResult> indicating success or failure.
 */
export async function removeItemFromList(
    listCoordinateId: string,
    itemToRemove: Item
): Promise<ServiceResult> {
    const currentUser = get(user);
    const ndkInstance = ndkService.getNdkInstance(); // Get instance from service
    const signer = ndkService.getSigner(); // Get signer from service
    console.log(`removeItemFromList called for list coordinate: ${listCoordinateId}, item:`, itemToRemove);

     if (!currentUser?.pubkey) {
        return { success: false, error: 'User not logged in' };
    }
    if (!ndkInstance) {
        return { success: false, error: 'NDK not initialized' };
    }
     if (!signer) {
        return { success: false, error: 'Nostr signer not available (NIP-07?)' };
    }

    // Parse and validate coordinate ID
    const parsedCoord = parseCoordinateId(listCoordinateId);
    if (!parsedCoord) {
        return { success: false, error: 'Invalid list coordinate ID format.' };
    }
    const { kind, pubkey, dTag } = parsedCoord;

    // Validate that the list pubkey matches the current user
    if (pubkey !== currentUser.pubkey) {
         return { success: false, error: 'Cannot modify a list belonging to another user.' };
    }

    try {
        // Fetch the latest version using the coordinate
        const currentStoredEvent = await localDb.getLatestEventByCoord(kind, pubkey, dTag);
        if (!currentStoredEvent) {
            return { success: false, error: `List event with coordinate ${listCoordinateId} not found locally.` };
        }
        // Double check pubkey
        if (currentStoredEvent.pubkey !== currentUser.pubkey) {
             console.error("DB returned event for coordinate but pubkey doesn't match current user!", { coord: listCoordinateId, eventPk: currentStoredEvent.pubkey, userPk: currentUser.pubkey });
            return { success: false, error: 'List ownership mismatch. Cannot modify.' };
        }
         console.log('Found current list event by coordinate:', currentStoredEvent);

        const newEvent = new NDKEvent(ndkInstance);
        newEvent.kind = currentStoredEvent.kind;
        newEvent.pubkey = currentUser.pubkey;
        newEvent.content = currentStoredEvent.content;
        newEvent.created_at = Math.floor(Date.now() / 1000);

        const originalTagCount = currentStoredEvent.tags.length;
        // Filter logic: Match tag type and value. Ignore relay hint for removal for simplicity.
        const newTags = currentStoredEvent.tags
                         .filter(tag => Array.isArray(tag) && tag.length >= 2) // Ensure valid tag structure
                         .filter(tag => !(tag[0] === itemToRemove.type && tag[1] === itemToRemove.value));
        
        if (newTags.length === originalTagCount) {
             console.warn(`Item [${itemToRemove.type}, ${itemToRemove.value}] not found in tags of list ${listCoordinateId}. Proceeding to save potentially identical event.`);
             // Decide if this should be an error or just proceed. Proceeding allows removing non-existent items idempotently.
        }
        
        newEvent.tags = newTags;
        console.log('New tags after removal attempt:', newTags);

        console.log('Attempting to sign the new list event version...');
        await newEvent.sign(signer);
         console.log('New event signed successfully. ID:', newEvent.id, 'Sig:', newEvent.sig);
        
         if (!newEvent.sig || !newEvent.id) {
             throw new Error('Signing failed: Signature or ID is missing after sign attempt.');
        }

        const newStoredEvent: StoredEvent = {
            id: newEvent.id,
            kind: newEvent.kind,
            pubkey: newEvent.pubkey,
            created_at: newEvent.created_at,
            tags: newEvent.tags,
            content: newEvent.content,
            sig: newEvent.sig,
             dTag: newEvent.kind >= 30000 && newEvent.kind < 40000 ? newEvent.tags.find(t => t[0] === 'd')?.[1] : undefined,
            published: false
        };
        console.log('Saving new event version to local DB:', newStoredEvent);
        await localDb.addOrUpdateEvent(newStoredEvent);
        console.log('New list event version saved locally.');

        return { success: true, newEventId: newStoredEvent.id };

    } catch (error: any) {
        console.error('Error in removeItemFromList:', error);
        return { success: false, error: error.message || 'An unknown error occurred' };
    }
}

/**
 * Renames a list event identified by its coordinate ID.
 * Creates a new version of the event with updated 'd' and 'title' tags,
 * signs it, and saves it locally as unpublished.
 * @param listCoordinateId The coordinate ID (kind:pubkey or kind:pubkey:dTag) of the list to rename.
 * @param newName The desired new name for the list.
 * @returns Promise<ServiceResult> indicating success or failure, including the new event ID on success.
 */
export async function renameList(
    listCoordinateId: string,
    newName: string
): Promise<ServiceResult> {
    // 1. Get Dependencies & Validate
    const currentUser = get(user);
    const ndkInstance = ndkService.getNdkInstance();
    const signer = ndkService.getSigner();
    const trimmedNewName = newName.trim();

    console.log(`renameList called for coordinate: ${listCoordinateId} to name: \\"${trimmedNewName}\\"`);

    if (!currentUser?.pubkey) {
        return { success: false, error: 'User not logged in' };
    }
    if (!ndkInstance) {
        return { success: false, error: 'NDK not initialized' };
    }
    if (!signer) {
        return { success: false, error: 'Nostr signer not available (NIP-07? NIP-46?)' };
    }
    if (!trimmedNewName) {
        return { success: false, error: 'New list name cannot be empty or just whitespace.' };
    }

    // 2. Parse & Validate Coordinate
    const parsedCoord = parseCoordinateId(listCoordinateId);
    if (!parsedCoord) {
        return { success: false, error: 'Invalid list coordinate ID format.' };
    }
    const { kind, pubkey, dTag } = parsedCoord;

    // 3. Check Initial Ownership
    if (pubkey !== currentUser.pubkey) {
        return { success: false, error: 'Cannot rename a list belonging to another user.' };
    }
    // Ensure the kind is appropriate for renaming (replaceable)
     if (!isReplaceableKind(kind)) {
         return { success: false, error: `Cannot rename event of kind ${kind} as it's not replaceable.` };
     }

    try {
        // 4. Fetch Current Event
        const currentStoredEvent = await localDb.getLatestEventByCoord(kind, pubkey, dTag);
        if (!currentStoredEvent) {
            return { success: false, error: `List event with coordinate ${listCoordinateId} not found locally.` };
        }
        console.log('Found current list event to rename:', currentStoredEvent);

        // 5. Check Fetched Event Ownership (Safety Check)
        if (currentStoredEvent.pubkey !== currentUser.pubkey) {
            console.error("Ownership mismatch after fetching for rename", { coord: listCoordinateId, eventPk: currentStoredEvent.pubkey, userPk: currentUser.pubkey });
            return { success: false, error: 'List ownership mismatch (DB error?). Cannot rename.' };
        }

        // --- Extract Original d Tag Value ---
        const originalDTagValue = currentStoredEvent.tags.find(tag => Array.isArray(tag) && tag[0] === 'd')?.[1];
        if (!originalDTagValue) {
            console.error("Could not find original 'd' tag in list event", currentStoredEvent);
            return { success: false, error: "Cannot rename list: original 'd' tag identifier is missing." };
        }
        console.log('Original dTag value found:', originalDTagValue);
        // --- End Extract Original d Tag Value ---

        // 6. Create New Event Version
        const newEvent = new NDKEvent(ndkInstance);
        newEvent.kind = currentStoredEvent.kind;
        newEvent.pubkey = currentUser.pubkey;
        newEvent.content = currentStoredEvent.content; // Preserve content
        newEvent.created_at = Math.floor(Date.now() / 1000); // New timestamp

        // 7. Tag Handling - Keep original 'd' tag, replace 'title'
        const tagsToKeep = currentStoredEvent.tags.filter(tag => {
            // Keep tags that are NOT 'title'
            return !Array.isArray(tag) || tag[0] !== 'title';
        });

        // Add the new 'title' tag
        const newTags = [
            ...tagsToKeep,
             // Only add title tag if name is not empty
             ...(trimmedNewName ? [['title', trimmedNewName]] : [])
        ];
        newEvent.tags = newTags;
        console.log('New tags for renamed list (keeping original d, updating title):', newTags);

        // 8. Sign New Event
        console.log('Attempting to sign the renamed list event version...');
        await newEvent.sign(signer);
        console.log('Renamed event signed successfully. ID:', newEvent.id, 'Sig:', newEvent.sig);

        if (!newEvent.sig || !newEvent.id) {
            return { success: false, error: 'Failed to sign the renamed list event.' };
        }

        // 9. Prepare for Local Storage
        const newStoredEvent: StoredEvent = {
            id: newEvent.id,
            kind: newEvent.kind,
            pubkey: newEvent.pubkey,
            created_at: newEvent.created_at,
            tags: newEvent.tags,
            content: newEvent.content,
            sig: newEvent.sig,
            // The dTag MUST remain the ORIGINAL dTag value
            dTag: originalDTagValue,
            published: false // Mark as unpublished locally
        };
         console.log("Prepared StoredEvent:", newStoredEvent);

        // 10. Save Locally
        console.log('Saving renamed event version to local DB:', newStoredEvent);
        await localDb.addOrUpdateEvent(newStoredEvent);
        console.log('Renamed list event version saved locally.');

        // 11. Return Success
        return { success: true, newEventId: newStoredEvent.id };

    } catch (error: any) {
        console.error(`Error in renameList for ${listCoordinateId}:`, error);
        const errorMessage = error.message || 'An unexpected error occurred while renaming the list.';
        // Check if the error is from the DB save operation
        if (error instanceof Error && error.name === 'DexieError') { // Example check, adjust if needed
             return { success: false, error: `Failed to save renamed list locally: ${errorMessage}` };
        }
        return { success: false, error: errorMessage };
    }
} 