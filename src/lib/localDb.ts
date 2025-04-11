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
	published?: boolean; // L6.1: Track publish status (true = published, false/undefined = local unpublished)
	rawEvent?: string; // Optional: Store the raw event JSON string
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

// Dexie DB Class (from L1.1 & L1.2, Updated L6.1)
export class NostrLocalDB extends Dexie {
	events!: Table<StoredEvent, string>; // Primary key 'id'
	profiles!: Table<StoredProfile, string>; // Primary key 'pubkey'

	constructor() {
		super('nostrClientDb'); // Database name

		// Version 1 Schema (remains for upgrade path)
		this.version(1).stores({
			events:
				'id, kind, pubkey, created_at, [kind+pubkey], [kind+pubkey+dTag]',
			profiles: 'pubkey, created_at'
		});

		// Version 2 Schema (L6.1: Added 'published' field and index)
		this.version(2).stores({
			events:
				// Indexes:
				// 1. id: Primary key (unique event hash)
				// 2. kind: For querying by event type
				// 3. pubkey: For querying by author
				// 4. created_at: For time-based queries/sorting (implicitly used by Dexie in some cases)
				// 5. published: For querying based on publish status
				// 6. [kind+pubkey]: For standard replaceable events (Kind 0, 3, 10k-20k)
				// 7. [kind+pubkey+dTag]: For parameterized replaceable events (Kind 30k-40k)
				// 8. [pubkey+published]: For efficiently finding unpublished events for a user
				'id, kind, pubkey, created_at, published, [kind+pubkey], [kind+pubkey+dTag], [pubkey+published]',
			profiles: 'pubkey, created_at' // No changes needed for profiles table schema in v2
		});
		// Note: Dexie automatically handles upgrading existing data.
		// New fields like 'published' will be undefined in old records until updated.

		// Make sure to map the tables to the class members for intellisense
		this.events = this.table("events");
		this.profiles = this.table("profiles");
	}

	// Method to add/update events (Reviewed L6.1 - existing logic preserves newer local unpublished events)
	async addOrUpdateEvent(event: StoredEvent): Promise<void> {
		// *** Add dTag derivation logic here, before any put/delete ***
		if (event.kind >= 30000 && event.kind < 40000) {
			const foundDTag = event.tags.find(t => Array.isArray(t) && t.length >= 2 && t[0] === 'd')?.[1];
			event.dTag = foundDTag; // Set to the found value or undefined if not found
		} else {
			// Ensure dTag is undefined for non-parameterized kinds
			event.dTag = undefined;
		}
		// *** End dTag derivation logic ***

		const isNewEventMarkedUnpublished = event.published === false;

		if (isReplaceableKind(event.kind)) {
			// Handle Replaceable Event
			let existingEvent: StoredEvent | undefined;
			const keyQuery = this.events.where('[kind+pubkey]');
			const paramKeyQuery = this.events.where('[kind+pubkey+dTag]');

			// Use the dTag derived above for lookup
			if (event.kind >= 30000 && event.kind < 40000 && event.dTag) { 
				const key: [number, string, string] = [event.kind, event.pubkey, event.dTag];
				existingEvent = await paramKeyQuery.equals(key).first();
			} else if (event.kind === 0 || event.kind === 3 || (event.kind >= 10000 && event.kind < 20000)) {
				const key: [number, string] = [event.kind, event.pubkey];
				existingEvent = await keyQuery.equals(key).first();
			} else {
				console.warn(`Replaceable event kind ${event.kind} without specific coordinate handling, attempting simple put.`);
				await this.transaction('rw', this.events, async () => {
					const current = await this.events.get(event.id);
					if (current && event.published === undefined && !isNewEventMarkedUnpublished) {
						event.published = current.published;
					}
					await this.events.put(event); // Save with derived dTag if applicable
				});
				return;
			}

			await this.transaction('rw', this.events, async () => {
				let performPut = false;
				if (!existingEvent) {
					performPut = true;
				} else if (event.created_at > existingEvent.created_at) {
					performPut = true;
				} else if (event.created_at === existingEvent.created_at && event.id < existingEvent.id) {
					performPut = true;
				}

				if (performPut) {
					if (existingEvent && event.published === undefined && !isNewEventMarkedUnpublished) {
						event.published = existingEvent.published;
					}
					if (existingEvent) {
						await this.events.delete(existingEvent.id);
					}
					await this.events.put(event); // Save with derived dTag
				} else {
					console.log(`Skipping update for replaceable event ${event.id}, existing is newer or preferred.`);
				}
			});

		} else {
			// Handle Non-Replaceable Event
			await this.transaction('rw', this.events, async () => {
				const current = await this.events.get(event.id);
				if (current && event.published === undefined && !isNewEventMarkedUnpublished) {
					event.published = current.published;
				}
				await this.events.put(event); // Save with derived dTag (will be undefined here)
			});
		}
	}

	// Add/Update Profile (Reviewed L6.1 - relies on addOrUpdateEvent for correct event handling)
	async addOrUpdateProfile(profileEvent: StoredEvent): Promise<void> {
		if (profileEvent.kind !== 0) {
			console.warn("Attempted to add non-kind 0 event as profile:", profileEvent);
			return;
		}

		try {
			const profileContent = JSON.parse(profileEvent.content);
			const newProfileData: StoredProfile = {
				pubkey: profileEvent.pubkey,
				profile: profileContent,
				created_at: profileEvent.created_at
			};

			const existingProfile = await this.profiles.get(profileEvent.pubkey);
			const existingKind0Event = await this.events.where({ kind: 0, pubkey: profileEvent.pubkey }).first(); // Find the existing Kind 0 event

			let shouldUpdateProfileTable = false;
			let shouldUpdateEventStore = false;

			if (!existingProfile || newProfileData.created_at > existingProfile.created_at) {
				shouldUpdateProfileTable = true;
				shouldUpdateEventStore = true;
			} else if (existingProfile && newProfileData.created_at === existingProfile.created_at) {
				// Timestamps match for profile data. Check Kind 0 event ID for tie-breaking.
				if (!existingKind0Event || profileEvent.id < existingKind0Event.id) {
					shouldUpdateProfileTable = true; // Update profile if ID is smaller
					shouldUpdateEventStore = true;
				} else {
					// IDs are same or new ID is larger, do nothing
				}
			}
			// else: New event is older, do nothing for profiles table.

			// If we determined an update is needed for the profile table...
			if (shouldUpdateProfileTable) {
				await this.profiles.put(newProfileData);
			}

			// Always ensure the event store is consistent, respecting the published flag logic within addOrUpdateEvent
			// Pass the *original* profileEvent to addOrUpdateEvent
			await this.addOrUpdateEvent(profileEvent);

		} catch (e) {
			console.error("Failed to parse or store profile:", profileEvent, e);
		}
	}

	// --- L6.1: New Methods ---

	/**
	 * Marks a locally stored event as published.
	 * @param eventId The ID of the event to mark as published.
	 */
	async markEventAsPublished(eventId: string): Promise<void> {
		try {
			const count = await this.events.update(eventId, { published: true });
			if (count === 0) {
				console.warn(`Tried to mark event ${eventId} as published, but it was not found.`);
			} else {
				console.log(`Marked event ${eventId} as published.`);
			}
		} catch (error) {
			console.error(`Failed to mark event ${eventId} as published:`, error);
			// Optionally re-throw or handle differently
		}
	}

	/**
	 * Retrieves all unpublished events for a given pubkey.
	 * Unpublished events are those where `published` is explicitly `false` or `undefined`.
	 * @param pubkey The public key of the author.
	 * @returns A promise that resolves to an array of unpublished StoredEvent objects.
	 */
	async getUnpublishedEvents(pubkey: string): Promise<StoredEvent[]> {
		try {
			// Use filter for robust check against undefined and false.
			// The index [pubkey+published] helps Dexie optimize the initial filtering by pubkey.
			const unpublished = await this.events
				.where({ pubkey: pubkey }) // Efficiently selects events by pubkey using index
				.filter(event => event.published !== true) // Checks for false or undefined
				.toArray();
			console.log(`Found ${unpublished.length} unpublished events for pubkey ${pubkey}`);
			return unpublished;
		} catch (error) {
			console.error(`Failed to get unpublished events for pubkey ${pubkey}:`, error);
			return []; // Return empty array on error
		}
	}

	/**
	 * Deletes a specific event from the local database by its ID.
	 * @param eventId The ID of the event to delete.
	 * @returns A promise that resolves when the deletion attempt is complete.
	 */
	async deleteEventById(eventId: string): Promise<void> {
		try {
			await this.events.delete(eventId);
			console.log(`Deleted event ${eventId} from local DB.`);
		} catch (error) {
			console.error(`Failed to delete event ${eventId} from local DB:`, error);
			// Re-throw or handle as appropriate for the application
			throw error; // Re-throwing allows the caller (listService) to handle the failure
		}
	}

	// --- Query Methods (L1.3) ---

	/**
	 * Retrieves the timestamp of the latest known event for a given pubkey.
	 * Used to determine the `since` filter for fetching new events.
	 * @param pubkey The public key of the author.
	 * @returns A promise that resolves to the `created_at` timestamp of the latest event, or 0 if none found.
	 */
	async getLatestEventTimestamp(pubkey: string): Promise<number> {
		try {
			// Filter by pubkey first (uses index), then sort the results in memory.
			const sortedEvents = await this.events
				.where('pubkey').equals(pubkey)
				.sortBy('created_at'); // Sorts ascending

			// The latest event will be the last one in the sorted array.
			const latestEvent = sortedEvents.length > 0 ? sortedEvents[sortedEvents.length - 1] : undefined;

			return latestEvent?.created_at ?? 0; // Return its timestamp or 0 if no events exist
		} catch (error) {
			console.error(`Failed to get latest event timestamp for pubkey ${pubkey}:`, error);
			return 0; // Return 0 on error
		}
	}

	async getEventById(id: string): Promise<StoredEvent | undefined> {
		return await this.events.get(id);
	}

	async getLatestEventByCoord(kind: number, pubkey: string, dTag?: string): Promise<StoredEvent | undefined> {
		console.log(`%cgetLatestEventByCoord: Received args: kind=${kind}, pubkey=${pubkey}, dTag=${dTag}`, 'color: orange;'); // Log args
		let query;
		if (dTag && kind >= 30000 && kind < 40000) {
			// Parametrized: Use [kind+pubkey+dTag] index
			const key: [number, string, string] = [kind, pubkey, dTag];
			console.log(`%cgetLatestEventByCoord: Using [kind+pubkey+dTag] query with key:`, 'color: orange;', key); // Log query type
			query = this.events.where('[kind+pubkey+dTag]').equals(key);
		} else if (isReplaceableKind(kind)) {
			// Standard Replaceable: Use [kind+pubkey] index
			const key: [number, string] = [kind, pubkey];
			console.log(`%cgetLatestEventByCoord: Using [kind+pubkey] query with key:`, 'color: orange;', key); // Log query type
			query = this.events.where('[kind+pubkey]').equals(key);
		} else {
			console.warn(`getLatestEventByCoord called for non-replaceable kind: ${kind}`);
			return undefined;
		}
		
		try {
			// *** MODIFIED QUERY STRATEGY ***
			console.log(`%cgetLatestEventByCoord: Executing query.toArray()...`, 'color: orange;'); 
			const matchingEvents = await query.toArray();
			console.log(`%cgetLatestEventByCoord: query.toArray() returned ${matchingEvents.length} events:`, 'color: orange;', matchingEvents);

			if (matchingEvents.length === 0) {
				return undefined;
			} 

			// Sort manually to find the latest (descending created_at, then ascending id for tie-breaking)
			matchingEvents.sort((a, b) => {
				if (b.created_at !== a.created_at) {
					return b.created_at - a.created_at;
				} else {
					// Use NIP-01 tie-breaking (smaller ID wins - sort ascending)
					return a.id.localeCompare(b.id); 
				}
			});

			const latest = matchingEvents[0]; // The first element after sorting is the latest
			console.log(`%cgetLatestEventByCoord: Manually determined latest event:`, 'color: orange;', latest);
			return latest;
			// *** END MODIFIED QUERY STRATEGY ***

			/* Original logic using .last()
			console.log(`%cgetLatestEventByCoord: Executing query.last()...`, 'color: orange;'); // Log before query
			const latest = await query.last(); // .last() is efficient with indexed lookups
			console.log(`%cgetLatestEventByCoord: query.last() returned:`, 'color: orange;', latest); // Log result
			return latest;
			*/
		} catch (error) {
			console.error("Error fetching latest event by coordinate:", { kind, pubkey, dTag }, error);
			return undefined;
		}
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