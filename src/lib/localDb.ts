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
		const isNewEventMarkedUnpublished = event.published === false;

		if (isReplaceableKind(event.kind)) {
			// Handle Replaceable Event
			let existingEvent: StoredEvent | undefined;
			const keyQuery = this.events.where('[kind+pubkey]');
			const paramKeyQuery = this.events.where('[kind+pubkey+dTag]');

			if (event.kind >= 30000 && event.kind < 40000 && event.dTag) {
				const key: [number, string, string] = [event.kind, event.pubkey, event.dTag];
				existingEvent = await paramKeyQuery.equals(key).first();
			} else if (event.kind === 0 || event.kind === 3 || (event.kind >= 10000 && event.kind < 20000)) {
				const key: [number, string] = [event.kind, event.pubkey];
				existingEvent = await keyQuery.equals(key).first();
			} else {
				// This case shouldn't happen for standard replaceable kinds, but handle defensively
				console.warn(`Replaceable event kind ${event.kind} without specific coordinate handling, attempting simple put.`);
				// Use transaction for potential update
				await this.transaction('rw', this.events, async () => {
					const current = await this.events.get(event.id);
					// Preserve published status if the incoming event doesn't specify it and is not explicitly unpublished
					if (current && event.published === undefined && !isNewEventMarkedUnpublished) {
						event.published = current.published;
					}
					await this.events.put(event);
				});
				return;
			}

			await this.transaction('rw', this.events, async () => {
				let performPut = false;
				if (!existingEvent) {
					performPut = true; // Add if no existing event found
				} else if (event.created_at > existingEvent.created_at) {
					performPut = true; // Update if new event is strictly newer
				} else if (event.created_at === existingEvent.created_at && event.id < existingEvent.id) {
                    // Nip-01 tie-breaking rule: if timestamps are equal, lower event ID wins
					performPut = true;
				}

				if (performPut) {
					// Preserve existing published status only if:
					// 1. There is an existing event.
					// 2. The incoming event *doesn't* have a 'published' status set (i.e., it's likely from network sync).
					// 3. The incoming event is *not* explicitly marked as unpublished (which takes precedence).
					if (existingEvent && event.published === undefined && !isNewEventMarkedUnpublished) {
						event.published = existingEvent.published;
					}
					// If an existing event is being replaced, delete the old one first to avoid conflicts
					if (existingEvent) {
						await this.events.delete(existingEvent.id);
					}
					await this.events.put(event);
				} else {
					// New event is older or same age with larger/equal ID, do nothing
					console.log(`Skipping update for replaceable event ${event.id}, existing is newer or preferred.`);
				}
			});

		} else {
			// Handle Non-Replaceable Event (e.g., Kind 1 Note)
			// Non-replaceable events are added based on their unique ID.
			// Use put which acts as add or update based on primary key 'id'.
			await this.transaction('rw', this.events, async () => {
				const current = await this.events.get(event.id);
				// Preserve published status if the incoming event doesn't specify it
				// and the new event is *not* explicitly marked as unpublished
				if (current && event.published === undefined && !isNewEventMarkedUnpublished) {
					event.published = current.published;
				}
				await this.events.put(event);
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
		let query;
		if (dTag && kind >= 30000 && kind < 40000) {
			// Parametrized: Use [kind+pubkey+dTag] index
			const key: [number, string, string] = [kind, pubkey, dTag];
			query = this.events.where('[kind+pubkey+dTag]').equals(key);
		} else if (isReplaceableKind(kind)) {
			// Standard Replaceable: Use [kind+pubkey] index
			const key: [number, string] = [kind, pubkey];
			query = this.events.where('[kind+pubkey]').equals(key);
		} else {
			console.warn(`getLatestEventByCoord called for non-replaceable kind: ${kind}`);
			return undefined;
		}
		// Use the .last() method. Dexie sorts compound keys, so .last() on a query
		// using '[kind+pubkey]' or '[kind+pubkey+dTag]' should work even without created_at
		// explicitly in the index name, as it finds the matching range and gets the last primary key within it.
		// If performance becomes an issue, add created_at to the index definitions.
		try {
			// Attempt to get the last item based on the index used in the query
			const latest = await query.last(); // .last() is efficient with indexed lookups
			return latest;
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