import Dexie, { type Table } from 'dexie';

// Interfaces (from L1.1)
export interface StoredEvent {
	id: string; // Event ID
	kind: number;
	pubkey: string;
	created_at: number;
	tags: string[][];
	content: string;
	sig: string;
	dTag?: string; // Optional dTag for parametrized replaceable events
}

export interface StoredProfile {
	pubkey: string; // Primary key
	profile: Record<string, any>; // Parsed content of Kind 0
	created_at: number; // Timestamp of the Kind 0 event
}

// Helper Function (from L1.2)
export function isReplaceableKind(kind: number): boolean {
	return (
		kind === 0 || // Profile Metadata
		kind === 3 || // Contacts
		(kind >= 10000 && kind < 20000) || // Replaceable Events
		(kind >= 30000 && kind < 40000) // Parametrized Replaceable Events
	);
}

// Dexie DB Class (from L1.1 & L1.2)
export class NostrLocalDB extends Dexie {
	events!: Table<StoredEvent, string>; // Primary key 'id'
	profiles!: Table<StoredProfile, string>; // Primary key 'pubkey'

	constructor() {
		super('nostrClientDb'); // Database name
		this.version(1).stores({
			// Schema from L1.1
			events:
				'id, kind, pubkey, created_at, [kind+pubkey], [kind+pubkey+dTag]',
			profiles: 'pubkey, created_at' // Added created_at for potential profile update logic later
		});
	}

	// Method to add/update events (from L1.2)
	async addOrUpdateEvent(event: StoredEvent): Promise<void> {
		if (isReplaceableKind(event.kind)) {
			// Handle Replaceable Event
			let existingEvent: StoredEvent | undefined;

			if (event.kind >= 30000 && event.kind < 40000 && event.dTag) {
				// Parametrized Replaceable (Kind 30k-40k with dTag)
				existingEvent = await this.events
					.where('[kind+pubkey+dTag]')
					.equals([event.kind, event.pubkey, event.dTag])
					.first();
			} else if (event.kind === 0 || event.kind === 3 || (event.kind >= 10000 && event.kind < 20000) ) {
                // Standard Replaceable (Kind 0, 3, 10k-20k)
				existingEvent = await this.events
					.where('[kind+pubkey]')
					.equals([event.kind, event.pubkey])
					.first();
			} else {
                // Fallback for replaceable kinds without a clear identifier strategy here
                // This case might need refinement depending on specific kind usage
                // For now, we'll treat it like non-replaceable to avoid accidental data loss
                // but ideally, specific strategies for these kinds should be added if used.
                console.warn(`Replaceable event kind ${event.kind} without specific handling, using simple put.`);
                await this.events.put(event);
                return;
            }


			if (!existingEvent || event.created_at > existingEvent.created_at) {
                // If no existing or new event is newer, add/update it
                // If there are multiple older versions (e.g., due to race conditions or previous lack of dTag indexing),
                // put will overwrite the one with the same primary key 'id' if it exists,
                // but won't automatically delete other older versions matching the kind+pubkey+dTag.
                // A cleanup mechanism might be needed later if old versions accumulate.
				await this.events.put(event);

                // Optional: Clean up older versions matching the same replaceable key
                // This adds complexity but ensures only the latest remains.
                // Example cleanup (use with caution, consider performance impact):
                /*
                if (existingEvent && event.id !== existingEvent.id) { // Only if the ID is different (meaning we replaced)
                    let olderEventsQuery;
                    if (event.kind >= 30000 && event.kind < 40000 && event.dTag) {
                         olderEventsQuery = this.events
                            .where('[kind+pubkey+dTag]')
                            .equals([event.kind, event.pubkey, event.dTag])
                    } else {
                         olderEventsQuery = this.events
                            .where('[kind+pubkey]')
                            .equals([event.kind, event.pubkey])
                    }
                    const olderEvents = await olderEventsQuery.toArray();
                    const idsToDelete = olderEvents
                        .filter(e => e.id !== event.id && e.created_at < event.created_at)
                        .map(e => e.id);
                    if (idsToDelete.length > 0) {
                        await this.events.bulkDelete(idsToDelete);
                    }
                }
                */
			}
            // else: New event is older or same age, do nothing
		} else {
			// Handle Non-Replaceable Event (or regular event)
			// put will add if new, or overwrite if ID exists (which is fine for non-replaceable)
			await this.events.put(event);
		}
	}

    // Optional Bulk Version (L1.2) - uncomment and potentially refine if needed
    /*
    async addOrUpdateEvents(events: StoredEvent[]): Promise<void> {
        await this.transaction('rw', this.events, async () => {
            for (const event of events) {
                // Basic implementation: Call the single addOrUpdateEvent
                // More optimized bulk logic could be added here if performance becomes an issue
                await this.addOrUpdateEvent(event);
            }
        });
    }
    */

    // Potential future method for profiles
    async addOrUpdateProfile(profileEvent: StoredEvent): Promise<void> {
        if (profileEvent.kind !== 0) {
            console.warn("Attempted to add non-kind 0 event as profile:", profileEvent);
            return;
        }

        try {
            const profileContent = JSON.parse(profileEvent.content);
            const newProfile: StoredProfile = {
                pubkey: profileEvent.pubkey,
                profile: profileContent,
                created_at: profileEvent.created_at
            };

            const existingProfile = await this.profiles.get(profileEvent.pubkey);

            if (!existingProfile || newProfile.created_at > existingProfile.created_at) {
                // Update the dedicated profiles table
                await this.profiles.put(newProfile);
                // ALSO update the main events table using the standard logic
                await this.addOrUpdateEvent(profileEvent);
            } else if (newProfile.created_at === existingProfile.created_at) {
                // Timestamps match, ensure the event corresponding to the *existing* profile is in the events table
                // This handles the case where the profile table was populated first/separately
                const existingEvent = await this.getEventById(existingProfile.profile?.id); // Assuming profile might store original event ID if needed
                 // Or, more simply, just try to add the current event if timestamps match,
                 // addOrUpdateEvent logic will handle keeping the existing one if appropriate.
                await this.addOrUpdateEvent(profileEvent);
            }
            // If the new event is older, we do nothing for both tables.

        } catch (e) {
            console.error("Failed to parse or store profile:", profileEvent, e);
        }
    }

    // --- Query Methods (L1.3) ---

    async getEventById(id: string): Promise<StoredEvent | undefined> {
        return await this.events.get(id);
    }

    async getLatestEventByCoord(kind: number, pubkey: string, dTag?: string): Promise<StoredEvent | undefined> {
        let query;
        if (dTag && kind >= 30000 && kind < 40000) {
            // Parametrized: Use [kind+pubkey+dTag] index
            query = this.events.where('[kind+pubkey+dTag]').equals([kind, pubkey, dTag]);
        } else if (isReplaceableKind(kind)) {
            // Standard Replaceable: Use [kind+pubkey] index
            query = this.events.where('[kind+pubkey]').equals([kind, pubkey]);
        } else {
            console.warn(`getLatestEventByCoord called for non-replaceable kind: ${kind}`);
            return undefined;
        }

        // Use the .last() method which leverages the index to efficiently find the latest item
        // The index [kind+pubkey+created_at] or [kind+pubkey+dTag+created_at]
        // isn't explicitly defined, but Dexie can use compound indexes for prefixes.
        // Ordering by created_at should be implicitly handled by the index when using .last()
        // IF the index correctly includes created_at as the last component for sorting.
        // Let's redefine the indexes slightly to ensure this.

        // NOTE: The schema should be updated for this to be most efficient:
        // 'id, kind, pubkey, created_at, [kind+pubkey+created_at], [kind+pubkey+dTag+created_at]'
        // However, Dexie might be smart enough with the existing [kind+pubkey] and [kind+pubkey+dTag]
        // and just sorting the results of the .equals() match.

        try {
             // Attempt to get the last item based on the index used in the query
             // This assumes the underlying index is ordered correctly (implicitly by created_at if it's the last part or by Dexie's internal handling)
             const latest = await query.last();
             return latest;
        } catch (error) {
             console.error("Error fetching latest event by coordinate:", { kind, pubkey, dTag }, error);
             return undefined;
        }

        /* Old implementation using sortBy + reverse emulation:
        const results = await query.sortBy('created_at');
        return results[results.length - 1]; // Get the last item after ascending sort
        */
    }

    async getEventsByKindAuthor(kind: number, pubkey: string, limit?: number): Promise<StoredEvent[]> {
        let collection = this.events.where({ kind: kind, pubkey: pubkey });

        // Order by creation time, newest first by default for this query
        // Apply reverse manually after sorting
        let sortedResults = await collection.sortBy('created_at');
        sortedResults.reverse(); // Reverse in place for newest first

        // Optional limit
        if (limit !== undefined && limit > 0) {
            sortedResults = sortedResults.slice(0, limit);
        }
        return sortedResults;
        // return await query.sortBy('created_at').reverse().toArray(); // .reverse() not available here either
    }
    // --- End Query Methods ---

    // --- Profile Methods (L1.4) ---

    async getProfile(pubkey: string): Promise<StoredProfile | undefined> {
        return await this.profiles.get(pubkey);
    }

    // --- End Profile Methods ---

    // --- NIP-51 List Query Methods ---

    /**
     * Retrieves all NIP-51 list events (kinds 10000-19999 and 30000-39999)
     * authored by the specified pubkey, ordered by kind, then created_at descending.
     *
     * This method aims to get the latest version of each list for the user.
     * Note: For replaceable events, addOrUpdateEvent should ensure only the latest is stored,
     * but querying broadly like this might still pick up older versions if cleanup wasn't perfect
     * or if multiple non-replaceable lists of the same kind exist.
     * Further refinement might be needed based on how lists are displayed/used.
     *
     * @param pubkey The public key of the author.
     * @returns A promise that resolves to an array of StoredEvent objects.
     */
    async getUsersNip51Lists(pubkey: string): Promise<StoredEvent[]> {
        const nip51Kinds = [
            10000, // Mute List
            10001, // Pin List
            // 10002, // Relay List Metadata - Maybe exclude by default?
            30000, // Follow Set
            30001, // Categorized People List ("following" is common dTag)
            30003, // Categorized Bookmark List
            // Add other relevant NIP-51 kinds here if needed
            // Note: Using broad ranges like 10000-19999 might be inefficient if many kinds are unused
        ];

        // Fetch all events matching the kinds and pubkey
        const lists = await this.events
            .where('pubkey').equals(pubkey)
            .and(event => nip51Kinds.includes(event.kind))
            .sortBy('[kind+created_at]'); // Correct Dexie method is sortBy

        // Since addOrUpdateEvent handles replaceability, we *should* mostly have the latest.
        // However, if multiple non-replaceable lists of the same kind exist,
        // or if multiple parametrized replaceable lists with different dTags exist,
        // this will return all of them.
        // For building the initial hierarchy, this might be okay, assuming we filter out
        // potential duplicates or non-root lists later or handle them in the hierarchy logic.

        // Dexie's sortBy doesn't have a simple descending option per key,
        // so we reverse the created_at order within each kind group manually if needed.
        // But for initial fetch, sortBy [kind+created_at] might be sufficient.

        // Let's refine to get only the latest for each replaceable key within the results
        const latestListsMap = new Map<string, StoredEvent>();

        for (const list of lists) {
            let key: string;
            if (isReplaceableKind(list.kind)) {
                 const dTag = list.dTag ?? list.tags.find(t => t[0] === 'd')?.[1]; // Ensure dTag is considered
                if (list.kind >= 30000 && list.kind < 40000 && dTag) {
                    key = `${list.kind}:${list.pubkey}:${dTag}`;
                } else {
                    key = `${list.kind}:${list.pubkey}`;
                }
            } else {
                // For non-replaceable, treat each event ID as unique
                key = list.id;
            }

            const existing = latestListsMap.get(key);
            if (!existing || list.created_at > existing.created_at) {
                latestListsMap.set(key, list);
            }
        }
        // Final sort for the UI: kind ascending, then newest first
        return Array.from(latestListsMap.values()).sort((a, b) => a.kind - b.kind || b.created_at - a.created_at);
    }

    // --- End NIP-51 List Query Methods ---

}

// Instantiate and Export (from L1.1)
const localDb = new NostrLocalDB();
export { localDb }; 