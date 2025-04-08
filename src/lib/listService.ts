import { NDKEvent } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKUser } from '@nostr-dev-kit/ndk';
import { localDb, type StoredEvent } from '$lib/localDb';
import { nip19 } from 'nostr-tools'; // Import nip19 from nostr-tools

// Interfaces (Define Item here and export it)
export interface Item {
    type: 'p' | 'e' | 'a'; // Allow 'a' type
    value: string;
    relay?: string; // Optional relay hint
}

export interface ServiceResult {
    success: boolean;
    error?: string;
    newEventId?: string;
}

// Interface for required dependencies
export interface ListServiceDependencies {
    currentUser: NDKUser | null;
    ndkInstance: NDK | null;
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
 * @param deps An object containing { currentUser, ndkInstance }.
 * @returns Promise<ServiceResult> indicating success or failure.
 */
export async function addItemToList(
    listCoordinateId: string,
    itemInput: string,
    deps: ListServiceDependencies
): Promise<ServiceResult> {
    const { currentUser, ndkInstance } = deps;
    const trimmedInput = itemInput.trim();
    console.log(`addItemToList called for list coordinate: ${listCoordinateId}, input: "${trimmedInput}"`);

    if (!currentUser?.pubkey) {
        return { success: false, error: 'User not logged in' };
    }
    if (!ndkInstance) {
        return { success: false, error: 'NDK not initialized' };
    }
    if (!ndkInstance.signer) {
        return { success: false, error: 'Nostr signer not available (NIP-07?)' };
    }
    if (!trimmedInput) {
        return { success: false, error: 'Input cannot be empty' };
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
        // Double check pubkey just in case DB returns something unexpected (though it shouldn't)
        if (currentStoredEvent.pubkey !== currentUser.pubkey) {
             console.error("DB returned event for coordinate but pubkey doesn't match current user!", { coord: listCoordinateId, eventPk: currentStoredEvent.pubkey, userPk: currentUser.pubkey });
            return { success: false, error: 'List ownership mismatch. Cannot modify.' };
        }
        console.log('Found current list event by coordinate:', currentStoredEvent);

        // --- Auto-detection logic --- 
        let tagToAdd: string[] | null = null;
        try {
            const decoded = nip19.decode(trimmedInput);
            console.log('NIP-19 Decoded:', decoded);

            switch (decoded.type) {
                case 'npub':
                    tagToAdd = ['p', decoded.data];
                    break;
                case 'nprofile':
                    tagToAdd = ['p', decoded.data.pubkey];
                    break;
                case 'naddr': {
                    const { kind, pubkey, identifier: dTag, relays } = decoded.data;
                    const coord = `${kind}:${pubkey}:${dTag}`;
                    tagToAdd = relays?.length ? ['a', coord, relays[0]] : ['a', coord];
                    break;
                }
                case 'note':
                    tagToAdd = ['e', decoded.data];
                    break;
                case 'nevent': {
                    const { id, relays } = decoded.data;
                    tagToAdd = relays?.length ? ['e', id, relays[0]] : ['e', id];
                    break;
                }
                default:
                    console.warn(`Unsupported NIP-19 type: ${decoded.type}`);
            }
        } catch (e) {
            console.log('NIP-19 decode failed, checking for hex/coordinate...');
            if (/^[a-f0-9]{64}$/i.test(trimmedInput)) {
                console.log("Detected hex ID, assuming event ('e').");
                tagToAdd = ['e', trimmedInput];
            } 
            else {
                 const coordRegex = /^\d+:[a-f0-9]{64}:/i;
                 if (coordRegex.test(trimmedInput)) {
                     console.log("Detected coordinate format, assuming address ('a').");
                     tagToAdd = ['a', trimmedInput]; 
                 }
            }
        }

        if (!tagToAdd) {
            return { success: false, error: 'Invalid input format (expected npub, nprofile, naddr, note, nevent, hex ID, or kind:pubkey:dTag)' };
        }
        console.log('Determined tag to add:', tagToAdd);
        // --- End Auto-detection ---

        const newEvent = new NDKEvent(ndkInstance);
        newEvent.kind = currentStoredEvent.kind; // Use kind from fetched event
        newEvent.pubkey = currentUser.pubkey; // Set pubkey explicitly
        newEvent.content = currentStoredEvent.content;
        newEvent.created_at = Math.floor(Date.now() / 1000);

        // Filter existing tags and add the new one, preventing duplicates
        const existingTags = currentStoredEvent.tags.filter(tag => Array.isArray(tag) && tag.length >= 2);
        const isDuplicate = existingTags.some(tag => 
            tag[0] === tagToAdd[0] && 
            tag[1] === tagToAdd[1]
        );

        if (isDuplicate) {
            console.log("Item already exists in the list, not adding duplicate tag.");
            return { success: true, newEventId: currentStoredEvent.id }; // Return current event ID
        }

        const newTags = [...existingTags, tagToAdd];
        newEvent.tags = newTags;
        console.log('New final tags:', newTags);

        console.log('Attempting to sign the new list event version...');
        await newEvent.sign(ndkInstance.signer);
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
        console.error('Error in addItemToList:', error);
        return { success: false, error: error.message || 'An unknown error occurred' };
    }
}

/**
 * Removes an item (p, e, or a tag) from a specific list event identified by its coordinate ID.
 * Creates a new version of the event, signs it, and saves it locally as unpublished.
 * @param listCoordinateId The coordinate ID (kind:pubkey or kind:pubkey:dTag) of the list to modify.
 * @param itemToRemove The item {type: 'p'|'e'|'a', value: string, relay?: string} to remove.
 * @param deps An object containing { currentUser, ndkInstance }.
 * @returns Promise<ServiceResult> indicating success or failure.
 */
export async function removeItemFromList(
    listCoordinateId: string, 
    itemToRemove: Item, 
    deps: ListServiceDependencies
): Promise<ServiceResult> {
    const { currentUser, ndkInstance } = deps;
    console.log(`removeItemFromList called for list coordinate: ${listCoordinateId}, item:`, itemToRemove);

     if (!currentUser?.pubkey) {
        return { success: false, error: 'User not logged in' };
    }
    if (!ndkInstance) {
        return { success: false, error: 'NDK not initialized' };
    }
     if (!ndkInstance.signer) {
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
        newEvent.kind = currentStoredEvent.kind; // Use kind from fetched event
        newEvent.pubkey = currentUser.pubkey; // Set pubkey explicitly
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
        await newEvent.sign(ndkInstance.signer);
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