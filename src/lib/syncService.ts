import { ndkService } from '$lib/ndkService';
import { localDb, type StoredEvent } from '$lib/localDb';
import { user } from '$lib/userStore';
import { get } from 'svelte/store';
// Adjust specific types as needed later - NDKEvent needed for reconstruction
import type { NDKFilter, NDKRelay, NDKUserProfile } from '@nostr-dev-kit/ndk'; // Keep type-only imports separate
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'; // Import values separately

/**
 * Handles synchronization logic between local storage (IndexedDB) and Nostr relays.
 */
export class SyncService {
	constructor() {
		// Basic setup if needed in the future
	}

	/**
	 * Fetches updates from relays and merges them into the local database.
	 * @param pubkey - The public key of the user whose data to sync.
	 * @returns Promise<boolean> - Indicates if a UI refresh might be needed due to changes.
	 */
	private async syncIncoming(pubkey: string): Promise<boolean> {
		let refreshNeeded = false;
		console.log('SyncService Phase 1: Starting Incoming Sync for pubkey:', pubkey);

		try {
			// 1. Determine the 'since' timestamp for the filter
			// Fetch the timestamp of the newest event we have stored locally for this user
			const latestTimestamp = await localDb.getLatestEventTimestamp(pubkey);
			const since = latestTimestamp ? latestTimestamp + 1 : 0; // +1 to avoid fetching the same event again
			console.log(`SyncService Phase 1: Fetching events since timestamp: ${since}`);

			// 2. Construct the filter
			// We want lists (30001), list items (implicit in 30001 processing),
			// profiles (0), and potentially notes (1) mentioned in lists.
			// For simplicity initially, fetch all relevant kinds authored by the user.
			// TODO: Refine filter later to fetch events *mentioning* the user or their lists?
			const filter: NDKFilter = {
				authors: [pubkey],
				kinds: [
					NDKKind.Metadata, // 0: Profiles
					// NDKKind.Text, // 1: Notes (Potentially add if needed)
					NDKKind.RelayList, // 10002: Relay Lists (Often useful context)
					NDKKind.CategorizedPeopleList, // 30000: Follow lists (NIP-51)
					NDKKind.CategorizedBookmarkList // 30001: Bookmark lists (NIP-51) - Our primary focus
					// Add other NIP-51 kinds if necessary
				],
				since: since > 0 ? since : undefined // NDK expects undefined, not 0, for no lower bound
			};

			// 3. Fetch events from relays
			console.log('SyncService Phase 1: Fetching events with filter:', filter);
			const fetchedEvents = await ndkService.fetchEvents(filter);
			console.log(`SyncService Phase 1: Fetched ${fetchedEvents.size} events.`);

			if (fetchedEvents.size === 0) {
				console.log('SyncService Phase 1: No new incoming events found.');
				return false; // No refresh needed if nothing new was fetched
			}

			// 4. Process and store fetched events
			for (const event of fetchedEvents) {
				try {
					// Convert NDKEvent to our StoredEvent format
					const storedEvent: StoredEvent = {
						id: event.id,
						pubkey: event.pubkey,
						created_at: event.created_at ?? 0,
						kind: event.kind ?? 0,
						tags: event.tags,
						content: event.content,
						sig: event.sig ?? '', // Provide fallback for potentially undefined sig
						rawEvent: JSON.stringify(event.rawEvent()) // Store the raw event for potential future use
					};

					await localDb.addOrUpdateEvent(storedEvent);
					// Since addOrUpdateEvent returns void, we assume a refresh is needed
					// if we successfully processed and attempted to store an event.
					refreshNeeded = true;
					console.log(`SyncService Phase 1: Processed/Stored event ${event.kind}:${event.id}`);

				} catch (storeError) {
					console.error(
						`SyncService Phase 1: Error processing/storing event ${event.id}:`,
						storeError
					);
					// Continue processing other events even if one fails
				}
			}

			console.log('SyncService Phase 1: Finished processing incoming events. Refresh needed:', refreshNeeded);
		} catch (error) {
			console.error('SyncService Phase 1: Error during incoming sync:', error);
			return false; // Return false in case of major errors during the process
		}

		return refreshNeeded;
	}

	/**
	 * Publishes local changes (queued events) to relays.
	 * @param pubkey - The public key of the user whose data to publish.
	 * @returns Promise<boolean> - Indicates if a UI refresh might be needed (e.g., after successful publish confirmation).
	 */
	private async syncOutgoing(pubkey: string): Promise<boolean> {
		let publishedSomething = false;
		console.log('SyncService Phase 2: Starting Outgoing Sync for pubkey:', pubkey);

		try {
			// 1. Get unpublished events for the current user
			const unpublishedEvents: StoredEvent[] = await localDb.getUnpublishedEvents(pubkey);
			console.log(`SyncService Phase 2: Found ${unpublishedEvents.length} unpublished events.`);

			if (unpublishedEvents.length === 0) {
				console.log('SyncService Phase 2: No outgoing events to publish.');
				return false; // Nothing to do
			}

			// 2. Loop through unpublished events and attempt to publish
			for (const storedEvent of unpublishedEvents) {
				try {
					console.log(`SyncService Phase 2: Attempting to publish event Kind ${storedEvent.kind} ID ${storedEvent.id}...`);

					// Reconstruction from fields:
					const eventToPublish = new NDKEvent(ndkService.getNdkInstance());
					eventToPublish.id = storedEvent.id;
					eventToPublish.kind = storedEvent.kind;
					eventToPublish.pubkey = storedEvent.pubkey;
					eventToPublish.created_at = storedEvent.created_at;
					eventToPublish.tags = storedEvent.tags;
					eventToPublish.content = storedEvent.content;
					eventToPublish.sig = storedEvent.sig; // MUST have a signature already!

					// Sanity check: Ensure event has a signature before attempting to publish
					if (!eventToPublish.sig) {
						console.warn(`SyncService Phase 2: Skipping event ${storedEvent.id} - missing signature.`);
						continue; // Skip this event
					}

					console.log('SyncService Phase 2: Publishing reconstructed event:', eventToPublish.rawEvent());
					// Publish the event
					const publishedRelays = await ndkService.publish(eventToPublish);

					if (publishedRelays.size > 0) {
						console.log(`SyncService Phase 2: Successfully published event ${storedEvent.id} to ${publishedRelays.size} relays.`);
						// Mark the event as published in the local DB
						await localDb.markEventAsPublished(storedEvent.id);
						console.log(`SyncService Phase 2: Marked event ${storedEvent.id} as published locally.`);
						publishedSomething = true; // Set flag since we published and marked
					} else {
						console.warn(`SyncService Phase 2: Event ${storedEvent.id} was not published to any relays (maybe already seen or relay issues?).`);
						// Consider if we should retry or handle this case differently.
						// For now, we don't mark it as published if ndkService reported 0 relays.
					}
				} catch (publishError) {
					console.error(`SyncService Phase 2: Error publishing event ${storedEvent.id}:`, publishError);
					// Continue with the next event even if one fails
				}
			} // End of loop

		} catch (fetchError) {
			console.error('SyncService Phase 2: Failed to fetch unpublished events:', fetchError);
			return false; // Cannot proceed if we can't get the events
		}

		console.log('SyncService Phase 2: Finished Outgoing Sync. Published something:', publishedSomething);
		return publishedSomething;
	}

	/**
	 * Performs a full synchronization cycle (incoming and outgoing).
	 * @param options - Optional parameters for the sync operation.
	 * @param options.isInitialSync - True if this is the first sync after login/startup.
	 * @returns Promise<boolean> - Indicates if an overall UI refresh might be needed.
	 */
	public async performSync(options?: { isInitialSync?: boolean }): Promise<boolean> {
		// Get Pubkey
		const pubkey = get(user)?.pubkey;
		if (!pubkey) {
			console.error("[SyncService] Cannot perform sync: User not logged in.");
			return false; // Cannot sync without a user
		}

		// Initialize Flag
		let overallRefreshNeeded = false;

		// Call Phase 1 (Incoming)
		try {
			console.log(`[SyncService] Running syncIncoming for ${pubkey}...`);
			const incomingRefresh = await this.syncIncoming(pubkey);
			if (incomingRefresh) {
				overallRefreshNeeded = true;
				console.log("[SyncService] syncIncoming indicated refresh needed.");
			}
		} catch (error) {
			console.error("[SyncService] Error during syncIncoming phase:", error);
			// Continue to outgoing phase even if incoming fails
		}

		// Call Phase 2 (Outgoing)
		try {
			console.log(`[SyncService] Running syncOutgoing for ${pubkey}...`);
			const outgoingRefresh = await this.syncOutgoing(pubkey);
			if (outgoingRefresh) {
				overallRefreshNeeded = true;
				console.log("[SyncService] syncOutgoing indicated refresh needed.");
			}
		} catch (error) {
			console.error("[SyncService] Error during syncOutgoing phase:", error);
		}

		// Log & Return Result
		console.log(`[SyncService] performSync completed. Overall refresh needed: ${overallRefreshNeeded}`);
		return overallRefreshNeeded;
	}
}

// Export a singleton instance
export const syncService = new SyncService(); 