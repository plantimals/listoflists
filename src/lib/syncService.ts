import { ndkService } from '$lib/ndkService';
import { localDb, type StoredEvent } from '$lib/localDb';
import { user } from '$lib/userStore';
import { get } from 'svelte/store';
// Adjust specific types as needed later - NDKEvent needed for reconstruction
import type { NDKFilter, NDKRelay, NDKUserProfile } from '@nostr-dev-kit/ndk'; // Keep type-only imports separate
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'; // Import values separately
// import { sleep } from '$lib/utils'; // Assuming a sleep utility exists or will be added

// Simple sleep utility function
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

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
	private async syncIncoming(pubkey: string): Promise<{ refreshNeeded: boolean; errorsOccurred: boolean }> {
		let refreshNeeded = false;
		let encounteredError = false; // Track internal errors
		const MAX_FETCH_ATTEMPTS = 2;
		const FETCH_RETRY_DELAY_MS = 1500;
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

			// 3. Fetch events from relays with retry
			let fetchedEvents: Set<NDKEvent> = new Set();
			let fetchAttempt = 0;
			let lastFetchError: unknown = null;

			while (fetchAttempt < MAX_FETCH_ATTEMPTS) {
				fetchAttempt++;
				try {
					console.log(`SyncService Phase 1: Attempt ${fetchAttempt}/${MAX_FETCH_ATTEMPTS} - Fetching events with filter:`, filter);
					fetchedEvents = await ndkService.fetchEvents(filter);
					console.log(`SyncService Phase 1: Attempt ${fetchAttempt} - Fetched ${fetchedEvents.size} events.`);
					lastFetchError = null; // Clear error on success
					break; // Exit loop on success
				} catch (error) {
					lastFetchError = error;
					console.warn(`SyncService Phase 1: Attempt ${fetchAttempt} failed:`, error);
					if (fetchAttempt < MAX_FETCH_ATTEMPTS) {
						console.log(`SyncService Phase 1: Retrying fetch after ${FETCH_RETRY_DELAY_MS}ms...`);
						await sleep(FETCH_RETRY_DELAY_MS); // Use a utility sleep function
					}
				}
			}

			// If all attempts failed, throw the last error
			if (lastFetchError) {
				console.error(`SyncService Phase 1: All fetch attempts failed.`);
				encounteredError = true; // Mark error occurred before throwing
				throw lastFetchError; // Propagate the error after retries
			}

			if (fetchedEvents.size === 0) {
				console.log('SyncService Phase 1: No new incoming events found.');
				return { refreshNeeded: false, errorsOccurred: false }; // No refresh, no errors
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
					refreshNeeded = true;
					console.log(`SyncService Phase 1: Processed/Stored event ${event.kind}:${event.id}`);

				} catch (storeError) {
					encounteredError = true; // Mark internal error
					console.error(
						`SyncService Phase 1: Error processing/storing event ${event.kind}:${event.id}:`,
						storeError
					);
					// Continue processing other events even if one fails
				}
			}

			console.log('SyncService Phase 1: Finished processing incoming events. Refresh needed:', refreshNeeded, 'Errors:', encounteredError);
		} catch (error) {
			encounteredError = true; // Mark error occurred
			console.error('SyncService Phase 1: Error during incoming sync after retries:', error);
			// Don't re-throw, let performSync handle the overall status
			return { refreshNeeded: false, errorsOccurred: true }; // Indicate failure
		}

		return { refreshNeeded, errorsOccurred: encounteredError };
	}

	/**
	 * Publishes local changes (queued events) to relays.
	 * @param pubkey - The public key of the user whose data to publish.
	 * @returns Promise<boolean> - Indicates if a UI refresh might be needed (e.g., after successful publish confirmation).
	 */
	private async syncOutgoing(pubkey: string): Promise<{ publishedSomething: boolean; errorsOccurred: boolean }> {
		let publishedSomething = false;
		let encounteredError = false; // Track if any publish error occurred
		console.log('SyncService Phase 2: Starting Outgoing Sync for pubkey:', pubkey);

		try {
			// 1. Get unpublished events for the current user
			const unpublishedEvents: StoredEvent[] = await localDb.getUnpublishedEvents(pubkey);
			console.log(`SyncService Phase 2: Found ${unpublishedEvents.length} unpublished events.`);

			if (unpublishedEvents.length === 0) {
				console.log('SyncService Phase 2: No outgoing events to publish.');
				return { publishedSomething: false, errorsOccurred: false }; // Nothing to do, no errors
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
						console.warn(`SyncService Phase 2: Event ${storedEvent.kind}:${storedEvent.id} was not published to any relays (maybe already seen or relay issues?). Will retry next cycle.`);
						// Event remains marked as unpublished implicitly
						// Consider this a soft error? For now, we don't set encounteredError here.
					}
				} catch (error) {
					encounteredError = true; // Mark that an error occurred
					console.error(`SyncService Phase 2: Error processing unpublished event ${storedEvent.kind}:${storedEvent.id}. Will retry next cycle. Error:`, error);
					// Continue with the next event even if one fails
				}
			} // End of loop

		} catch (fetchError) {
			encounteredError = true; // Mark that an error occurred
			console.error('SyncService Phase 2: Failed to fetch unpublished events:', fetchError);
			// Don't re-throw, let performSync handle the overall status
			return { publishedSomething: false, errorsOccurred: true }; // Indicate critical failure here
		}

		console.log(`SyncService Phase 2: Finished Outgoing Sync. Published something: ${publishedSomething}. Encountered errors: ${encounteredError}`);
		return { publishedSomething, errorsOccurred: encounteredError };
	}

	/**
	 * Performs a full synchronization cycle (incoming and outgoing).
	 * Provides a summary log of success/failure for each phase.
	 * @param options - Optional parameters for the sync operation.
	 * @param options.isInitialSync - True if this is the first sync after login/startup.
	 * @returns Promise<{success: boolean; message: string}> - Indicates overall success and provides a status message.
	 */
	public async performSync(options?: { isInitialSync?: boolean }): Promise<{ success: boolean; message: string }> {
		const pubkey = get(user)?.pubkey;
		if (!pubkey) {
			const message = "[SyncService] Cannot perform sync: User not logged in.";
			console.error(message);
			return { success: false, message };
		}

		console.log(`[SyncService] Starting performSync for ${pubkey}...`);
		let overallRefreshNeeded = false;
		let incomingPhaseCompleted = false;
		let outgoingPhaseCompleted = false;
		let incomingHadInternalErrors = false;
		let outgoingHadInternalErrors = false;
		let incomingCaughtError: unknown = null; // Renamed for clarity
		let outgoingCaughtError: unknown = null; // Renamed for clarity

		// Phase 1: Incoming
		try {
			console.log(`[SyncService] Running syncIncoming for ${pubkey}...`);
			const incomingResult = await this.syncIncoming(pubkey);
			incomingPhaseCompleted = true; // Reached end of try block
			incomingHadInternalErrors = incomingResult.errorsOccurred;
			if (incomingResult.refreshNeeded) {
				overallRefreshNeeded = true;
				console.log("[SyncService] syncIncoming indicated refresh needed.");
			}
			console.log(`[SyncService] syncIncoming phase completed. Internal errors: ${incomingHadInternalErrors}`);
		} catch (error) {
			incomingCaughtError = error; // Capture error thrown up
			console.error("[SyncService] Error during syncIncoming phase execution:", error);
			// Phase technically didn't complete successfully if error thrown up
		}

		// Phase 2: Outgoing
		try {
			console.log(`[SyncService] Running syncOutgoing for ${pubkey}...`);
			const outgoingResult = await this.syncOutgoing(pubkey);
			outgoingPhaseCompleted = true; // Reached end of try block
			outgoingHadInternalErrors = outgoingResult.errorsOccurred;
			if (outgoingResult.publishedSomething) {
				overallRefreshNeeded = true; // Use publishedSomething for refresh hint
				console.log("[SyncService] syncOutgoing indicated potential refresh needed (published).");
			}
			console.log(`[SyncService] syncOutgoing phase completed. Internal errors: ${outgoingHadInternalErrors}`);
		} catch (error) {
			outgoingCaughtError = error; // Capture error thrown up
			console.error("[SyncService] Error during syncOutgoing phase execution:", error);
			// Phase technically didn't complete successfully if error thrown up
		}

		// Log & Return Result
		// *** New Overall Success Logic ***
		const overallSuccess = !incomingCaughtError && !outgoingCaughtError && !incomingHadInternalErrors && !outgoingHadInternalErrors;

		let message = `[SyncService] performSync completed for ${pubkey}. Overall Status: ${overallSuccess ? 'Success' : 'Failed'}.`;
		// Add detail about phase completion status based on flags
		message += ` Incoming phase ran: ${incomingPhaseCompleted}. Outgoing phase ran: ${outgoingPhaseCompleted}. Refresh suggested: ${overallRefreshNeeded}.`;

		if (incomingCaughtError) message += ` Incoming Caught Error: ${incomingCaughtError instanceof Error ? incomingCaughtError.message : String(incomingCaughtError)}.`;
		if (outgoingCaughtError) message += ` Outgoing Caught Error: ${outgoingCaughtError instanceof Error ? outgoingCaughtError.message : String(outgoingCaughtError)}.`;
		if (incomingHadInternalErrors) message += ` Incoming Internal Errors: Yes.`;
		if (outgoingHadInternalErrors) message += ` Outgoing Internal Errors: Yes.`;

		console.log(message);

		// Return more structured result
		return {
			success: overallSuccess,
			message: overallSuccess ? 'Sync completed.' : 'Sync encountered errors. Check logs for details.' + (overallRefreshNeeded ? ' Some updates may have occurred.' : '')
		};
	}
}

// Export a singleton instance
export const syncService = new SyncService(); 