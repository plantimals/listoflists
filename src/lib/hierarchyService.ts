import type { TreeNodeData, ListItem } from '$lib/types';
// Remove direct NDK dependency for fetching, only keep types if needed
// import NDK, { type NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk';
import { localDb, type StoredEvent } from '$lib/localDb'; // Import localDb and StoredEvent
import type { NDKUserProfile } from '@nostr-dev-kit/ndk'; // Keep if profile type needed somewhere

// Helper function to check if a kind is parameterized replaceable
function isParameterizedReplaceable(kind: number | undefined): boolean {
    return kind !== undefined && kind >= 30000 && kind < 40000;
}

/**
 * Transforms a StoredEvent (from IndexedDB) into the basic TreeNodeData format.
 * Extracts key info, item count, and p/e tags. Children are populated later.
 *
 * @param event The StoredEvent representing a NIP-51 list.
 * @returns A TreeNodeData object representing the list event.
 */
export function transformStoredEventToNode(event: StoredEvent): TreeNodeData {
    const kind = event.kind;
    // Get dTag ONLY if it's a parameterized replaceable event
    // Need to parse dTag from tags array now
    const dTag = isParameterizedReplaceable(kind)
        ? event.tags.find(t => t[0] === 'd')?.[1]
        : undefined;

    // Use the 'a' tag format (kind:pubkey:dTag) as the ID for replaceable events,
    // otherwise use the event ID. This provides a stable identifier for list concepts.
    const id = dTag ? `${kind}:${event.pubkey}:${dTag}` : event.id;

    // Derive a user-friendly name, falling back from 'title' tag to 'd' tag to a generic name.
    // Need to parse title tag from tags array
    const name = event.tags.find(t => t[0] === 'title')?.[1] || dTag || `Kind ${kind} List`;

    // Count the number of items ('p', 'e', 'a', 'nip05' tags) in the list.
    const itemCount = event.tags.filter(t => ['p', 'e', 'a', 'nip05'].includes(t[0])).length;

    // Extract 'p', 'e', 'a', and 'nip05' tags specifically for the items list
    const items: Array<ListItem> = event.tags
        .filter(t => t[0] === 'p' || t[0] === 'e' || t[0] === 'a' || t[0] === 'nip05') 
        .map(t => {
            const baseItem = {
                type: t[0] as 'p' | 'e' | 'a' | 'nip05', // Cast type
                value: t[1],
                relayHint: (t[0] === 'e' || t[0] === 'a') ? t[2] : undefined, // Capture relay hint only if relevant
            };
            // If it's a nip05 tag, add the pubkey (assuming it's the 3rd element)
            if (baseItem.type === 'nip05' && t[2]) {
                 return { ...baseItem, pubkey: t[2] };
            } else {
                return baseItem;
            }
        });

    // Construct and return the TreeNodeData object.
    return {
        id,
        kind,
        name,
        itemCount,
        children: [], // Initialized empty, populated by buildHierarchy
        items, // Add the extracted items
        dTag, // Include dTag if it exists
        eventId: event.id,
        pubkey: event.pubkey
    };
}

/**
 * Builds a hierarchical structure of TreeNodeData from a flat list of root StoredEvents.
 * Filters for the latest versions of replaceable events before processing.
 * It recursively looks up child lists referenced by 'a' tags in the local database.
 *
 * @param rootListEvents An array of StoredEvents representing the top-level lists from the local DB.
 * @param maxDepth The maximum recursion depth to prevent infinite loops (default: 5).
 * @returns A promise that resolves to an array of TreeNodeData representing the root of the hierarchy.
 */
export async function buildHierarchy(
    rootListEvents: StoredEvent[],
    maxDepth: number = 5
): Promise<TreeNodeData[]> {

    // --- START: Filter for latest replaceable events --- 
    const latestEventsMap = new Map<string, StoredEvent>();

    for (const event of rootListEvents) {
        let eventKey: string;
        const kind = event.kind;

        if (isParameterizedReplaceable(kind)) {
            const dTag = event.tags.find(t => t[0] === 'd')?.[1];
            if (dTag === undefined) { // Treat replaceable without dTag like non-replaceable for keying
                eventKey = event.id;
            } else {
                 eventKey = `${kind}:${event.pubkey}:${dTag}`; // NIP-51 coordinate
            }
        } else if (kind === 0 || (kind >= 10000 && kind < 20000)) { // NIP-01 replaceable
             eventKey = `${kind}:${event.pubkey}`; // NIP-01 coordinate
        } else { // Non-replaceable
            eventKey = event.id; // Use event ID itself as key
        }

        const existingEvent = latestEventsMap.get(eventKey);
        if (!existingEvent || event.created_at > existingEvent.created_at) {
            latestEventsMap.set(eventKey, event);
        }
    }

    const filteredRootEvents = Array.from(latestEventsMap.values());
    console.log(`buildHierarchy: Filtered ${rootListEvents.length} events down to ${filteredRootEvents.length} latest versions.`);
    // --- END: Filter for latest replaceable events ---

    // nodeMap stores fully processed nodes, keyed by their stable ID (a-tag coord or event id)
    const nodeMap = new Map<string, TreeNodeData>();
    // processing tracks IDs currently being processed in the *current* recursion path to detect cycles
    const processing = new Set<string>();

    /**
     * Internal recursive function to process a single StoredEvent and its potential children from local DB.
     */
    async function processEvent(event: StoredEvent, currentDepth: number): Promise<TreeNodeData | null> {
        // Determine dTag and nodeId safely based on kind and tags
        const kind = event.kind;
        const dTag = isParameterizedReplaceable(kind)
            ? event.tags.find(t => t[0] === 'd')?.[1]
            : undefined;
        // Node ID MUST align with the key used in the filtering step above
        // For parameterized replaceable with a dTag, use the coordinate.
        // For other replaceable (or parameterized without dTag), use kind:pubkey ? No, use event.id here for consistency?
        // Let's stick to the ID definition used in transformStoredEventToNode for map keys.
        const nodeId = dTag ? `${kind}:${event.pubkey}:${dTag}` : event.id;

        // 1. Check depth limit
        if (currentDepth > maxDepth) {
            console.warn(`Max depth (${maxDepth}) reached processing node: ${nodeId}. Stopping recursion.`);
            return null;
        }

        // 2. Check for cycles
        if (processing.has(nodeId)) {
            console.warn(`Cycle detected involving node: ${nodeId}. Stopping recursion for this path.`);
            return null; // Cycle detected
        }

        // 3. Check memoization (if already fully processed)
        if (nodeMap.has(nodeId)) {
            return nodeMap.get(nodeId)!;
        }

        // 4. Mark as currently processing
        processing.add(nodeId);

        // 5. Transform the current event into a basic node structure using the new function
        const node = transformStoredEventToNode(event);
        if (!node) {
            console.error(`Failed to transform stored event ${nodeId} into a node.`);
            processing.delete(nodeId); // Unmark before returning
            return null;
        }

        // 6. Store in map early to handle potential self-references within children processing
        nodeMap.set(nodeId, node);

        // 7. Find valid 'a' tag child references from the event's tags array
        // Regex checks for format: digits:hex_chars or digits:hex_chars:any_chars
        const childRefs = event.tags
            .filter(tag => tag[0] === 'a' && /^[0-9]+:[0-9a-fA-F]{64}(:[^:]*)?$/.test(tag[1]))
            .map(tag => tag[1]); // Get the coordinate string

        // 8. Process children recursively by looking them up in localDb
        const childPromises = childRefs.map(async (coord): Promise<TreeNodeData | null> => {
            const parts = coord.split(':');
            const kindStr = parts[0];
            const pubkey = parts[1];
            const dTagChild = parts[2]; // Will be undefined if not present

            const kind = parseInt(kindStr, 10);
            if (isNaN(kind) || !pubkey) {
                console.warn(`Skipping invalid 'a' tag coordinate: ${coord}`);
                return null;
            }

            try {
                // Fetch the specific child list event *from the local database*
                 // IMPORTANT: Fetch the *latest* version of the child from the DB
                const childEvent = await localDb.getLatestEventByCoord(kind, pubkey, dTagChild);

                if (childEvent) {
                    // Recursively process the fetched child event
                    return await processEvent(childEvent, currentDepth + 1);
                } else {
                    console.log(`Child list event not found locally for coordinate: ${coord}`);
                    // Optionally create a placeholder node for unfound lists?
                    // For now, just return null.
                    return null;
                }
            } catch (error) {
                console.error(`Error looking up child event locally for coordinate ${coord}:`, error);
                return null;
            }
        });

        // Wait for all children to be processed
        const resolvedChildren = await Promise.all(childPromises);

        // Add valid, non-null child nodes to the current node's children array
        node.children = resolvedChildren.filter((child): child is TreeNodeData => child !== null);

        // Keeping the original itemCount from transformStoredEventToNode which counts all p/e/a tags.

        // 9. Unmark as processing
        processing.delete(nodeId);

        // 10. Return the fully processed node
        return node;
    }

    // Process all FILTERED root-level events concurrently
    const hierarchyPromises = filteredRootEvents.map(rootEvent => processEvent(rootEvent, 0));
    const hierarchyNodes = await Promise.all(hierarchyPromises);

    // Filter out any null results
    return hierarchyNodes.filter((node): node is TreeNodeData => node !== null);
} 