import type { TreeNodeData, ListItem } from '$lib/types';
// Remove direct NDK dependency for fetching, only keep types if needed
// import NDK, { type NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk';
import { localDb, type StoredEvent } from '$lib/localDb'; // Import localDb and StoredEvent
import { NDKKind, type NDKUserProfile } from '@nostr-dev-kit/ndk'; // Import NDKKind as value, NDKUserProfile as type

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
    const items: ListItem[] = event.tags
        .filter(t => ['p', 'e', 'a', 'nip05'].includes(t[0])) 
        .map((t): ListItem | null => {
            const tagType = t[0];
            const tagValue = t[1];
            const tagParam1 = t[2]; // Could be relay hint or cached npub

            if (tagType === 'nip05') {
                if (tagValue && tagParam1) {
                    return { 
                        type: 'nip05',
                        identifier: tagValue,
                        cachedNpub: tagParam1, 
                        value: tagValue // Use identifier as value for keying
                    } as ListItem;
                } else {
                    console.warn(`Skipping invalid nip05 tag in event ${event.id}:`, t);
                    return null; // Skip invalid nip05 tags
                }
            } else if (tagType === 'p' || tagType === 'e' || tagType === 'a') {
                return {
                    type: tagType,
                    value: tagValue,
                    relayHint: (tagType === 'e' || tagType === 'a') ? tagParam1 : undefined
                } as ListItem;
            } else {
                 return null; // Should not happen due to filter, but defensively return null
            }
        })
        .filter((item): item is ListItem => item !== null); // Type predicate should work now

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

/**
 * Recursively aggregates content item identifiers ('e' tags and 'a' tags for non-list kinds)
 * from a starting node and its descendants (including linked lists).
 * @param startNode - The TreeNodeData to start aggregation from.
 * @param collectedItems - A Set to store the unique item values (event IDs or naddrs).
 * @param visitedNodes - A Set to track visited node IDs (coordinates/event IDs) to prevent cycles.
 * @param currentDepth - The current recursion depth.
 * @param maxDepth - The maximum recursion depth allowed.
 */
export async function aggregateContentItems(
    startNode: TreeNodeData,
    collectedItems: Set<string>, // Pass Set by reference to accumulate results
    visitedNodes: Set<string>,   // Pass Set by reference for cycle detection
    currentDepth: number = 0,
    maxDepth: number = 5 // Default max depth
): Promise<void> { // Returns void as it modifies the passed Set

    // 1. Check Depth & Cycles
    if (currentDepth > maxDepth) {
        console.warn(`aggregateContentItems: Max depth (${maxDepth}) reached at node ${startNode.id}`);
        return;
    }
    if (visitedNodes.has(startNode.id)) {
        console.warn(`aggregateContentItems: Cycle detected at node ${startNode.id}. Skipping further recursion.`);
        return;
    }
    visitedNodes.add(startNode.id);

    console.log(`%caggregateContentItems: Processing node ${startNode.id} (Depth ${currentDepth})`, 'color: cyan;');

    // 2. Process Items in the Current Node
    for (const item of startNode.items) {
        if (item.type === 'e') {
            // Add non-replaceable event IDs
            // TODO: Optional - Re-verify kind here if needed, though addItemToList should prevent replaceables
            collectedItems.add(item.value); // Add event ID
        } else if (item.type === 'a') {
            // Add addressable items *if they are not lists*
            const parts = item.value.split(':');
            const kind = parseInt(parts[0], 10);
            // Add 'a' tag value (coordinate) if it's NOT a known list kind we handle recursively
            // Using NDKKind requires importing it
            if (isNaN(kind) || (kind !== NDKKind.CategorizedPeopleList && kind !== NDKKind.CategorizedBookmarkList /* add other list kinds if needed */)) {
                 collectedItems.add(item.value); // Add coordinate for non-list 'a' tags
            }
            // List kinds ('a' tags pointing TO lists) are handled below via recursion
        }
        // Ignore 'p' and 'nip05' types for content aggregation
    }

    // 3. Process Direct Children (nodes already in the hierarchy structure)
    for (const childNode of startNode.children) {
        await aggregateContentItems(childNode, collectedItems, visitedNodes, currentDepth + 1, maxDepth);
    }

    // 4. Process Linked Lists ('a' tags pointing TO lists)
    const listLinks = startNode.items.filter(item => {
        if (item.type !== 'a') return false;
        const parts = item.value.split(':');
        if (parts.length < 3) return false;
        const kind = parseInt(parts[0], 10);
        // Explicitly check for known list kinds we want to traverse
        // Using NDKKind requires importing it
        return !isNaN(kind) && (kind === NDKKind.CategorizedPeopleList || kind === NDKKind.CategorizedBookmarkList /* add others? */);
    });

    for (const linkItem of listLinks) {
        const coord = linkItem.value;
        const parts = coord.split(':');
        const kind = parseInt(parts[0], 10);
        const pubkey = parts[1];
        const dTag = parts[2];

        // Fetch the linked list event from local DB
        const linkedListEvent = await localDb.getLatestEventByCoord(kind, pubkey, dTag);
        if (linkedListEvent) {
            // Transform the event into TreeNodeData structure
            // Note: This transform only includes direct items, not nested children by itself.
            const linkedListNode = transformStoredEventToNode(linkedListEvent);
            // Recursively aggregate from the transformed linked list node
            await aggregateContentItems(linkedListNode, collectedItems, visitedNodes, currentDepth + 1, maxDepth);
        } else {
             console.warn(`aggregateContentItems: Linked list event not found locally for coordinate ${coord} referenced in node ${startNode.id}`);
        }
    }

    // 5. Remove node from visited set *after* processing its descendants
    // (This allows revisiting the node via different paths if structure isn't a strict tree)
     visitedNodes.delete(startNode.id);
} 