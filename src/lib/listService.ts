import { NDKEvent } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKUser } from '@nostr-dev-kit/ndk';
import { localDb, type StoredEvent } from '$lib/localDb';

interface Item {
    type: 'p' | 'e';
    value: string;
}

interface ServiceResult {
    success: boolean;
    error?: string;
    newEventId?: string; 
}

// Interface for required dependencies
export interface ListServiceDependencies {
    currentUser: NDKUser | null;
    ndkInstance: NDK | null;
}

/**
 * Adds an item (p or e tag) to a specific list event.
 * Creates a new version of the event, signs it, and saves it locally as unpublished.
 * @param listEventId The ID of the *current* list event to modify.
 * @param itemToAdd The item {type: 'p'|'e', value: string} to add.
 * @param deps An object containing { currentUser, ndkInstance }.
 * @returns Promise<ServiceResult> indicating success or failure.
 */
export async function addItemToList(
    listEventId: string, 
    itemToAdd: Item,
    deps: ListServiceDependencies // Pass dependencies
): Promise<ServiceResult> {
    const { currentUser, ndkInstance } = deps; // Destructure dependencies
    console.log(`addItemToList called for list ID: ${listEventId}, item:`, itemToAdd);

    if (!currentUser?.pubkey) {
        return { success: false, error: 'User not logged in' };
    }
    if (!ndkInstance) {
        return { success: false, error: 'NDK not initialized' };
    }
    if (!ndkInstance.signer) {
        return { success: false, error: 'Nostr signer not available (NIP-07?)' };
    }

    try {
        const currentStoredEvent = await localDb.getEventById(listEventId);
        if (!currentStoredEvent) {
            return { success: false, error: `List event with ID ${listEventId} not found locally.` };
        }
        // Ensure the event pubkey matches the current user for safety
        if (currentStoredEvent.pubkey !== currentUser.pubkey) {
            return { success: false, error: 'Cannot modify an event belonging to another user.' };
        }
        console.log('Found current list event:', currentStoredEvent);

        const newEvent = new NDKEvent(ndkInstance); // Still need NDK instance here
        newEvent.kind = currentStoredEvent.kind;
        newEvent.pubkey = currentUser.pubkey; // Use current user's pubkey
        newEvent.content = currentStoredEvent.content; 
        newEvent.created_at = Math.floor(Date.now() / 1000);

        const newTags = currentStoredEvent.tags
                         .filter(tag => Array.isArray(tag) && tag.length >= 1) 
                         .filter(tag => !(tag[0] === itemToAdd.type && tag[1] === itemToAdd.value));
        newTags.push([itemToAdd.type, itemToAdd.value]);
        newEvent.tags = newTags;
        console.log('New tags:', newTags);

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
 * Removes an item (p or e tag) from a specific list event.
 * Creates a new version of the event, signs it, and saves it locally as unpublished.
 * @param listEventId The ID of the *current* list event to modify.
 * @param itemToRemove The item {type: 'p'|'e', value: string} to remove.
 * @param deps An object containing { currentUser, ndkInstance }.
 * @returns Promise<ServiceResult> indicating success or failure.
 */
export async function removeItemFromList(
    listEventId: string, 
    itemToRemove: Item, 
    deps: ListServiceDependencies // Pass dependencies
): Promise<ServiceResult> {
    const { currentUser, ndkInstance } = deps; // Destructure
    console.log(`removeItemFromList called for list ID: ${listEventId}, item:`, itemToRemove);

     if (!currentUser?.pubkey) {
        return { success: false, error: 'User not logged in' };
    }
    if (!ndkInstance) {
        return { success: false, error: 'NDK not initialized' };
    }
     if (!ndkInstance.signer) {
        return { success: false, error: 'Nostr signer not available (NIP-07?)' };
    }

    try {
        const currentStoredEvent = await localDb.getEventById(listEventId);
        if (!currentStoredEvent) {
            return { success: false, error: `List event with ID ${listEventId} not found locally.` };
        }
        // Ensure the event pubkey matches the current user for safety
        if (currentStoredEvent.pubkey !== currentUser.pubkey) {
            return { success: false, error: 'Cannot modify an event belonging to another user.' };
        }
         console.log('Found current list event:', currentStoredEvent);

        const newEvent = new NDKEvent(ndkInstance); // Use passed NDK instance
        newEvent.kind = currentStoredEvent.kind;
        newEvent.pubkey = currentUser.pubkey; // Use current user's pubkey
        newEvent.content = currentStoredEvent.content;
        newEvent.created_at = Math.floor(Date.now() / 1000);

        const originalTagCount = currentStoredEvent.tags.length;
        const newTags = currentStoredEvent.tags
                         .filter(tag => Array.isArray(tag) && tag.length >= 1) 
                         .filter(tag => !(tag[0] === itemToRemove.type && tag[1] === itemToRemove.value));
        
        if (newTags.length === originalTagCount) {
             console.warn(`Item [${itemToRemove.type}, ${itemToRemove.value}] not found in tags of event ${listEventId}. Proceeding to save potentially identical event.`);
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