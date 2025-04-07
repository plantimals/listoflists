import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { localDb, type StoredEvent, type StoredProfile } from '$lib/localDb';
import type { NDKUserProfile } from '@nostr-dev-kit/ndk';

// Helper to create a basic StoredEvent
function createEvent(
    id: string,
    kind: number,
    pubkey: string,
    createdAt: number,
    content: string = '',
    tags: string[][] = [],
    sig: string = `sig-${id}`,
    published?: boolean // Optional published status
): StoredEvent {
    const baseEvent: StoredEvent = {
        id,
        kind,
        pubkey,
        created_at: createdAt,
        tags,
        content,
        sig,
    };
    // Add dTag automatically if it's parameterized replaceable and a 'd' tag exists
    if (kind >= 30000 && kind < 40000) {
        const dTagValue = tags.find(t => t[0] === 'd')?.[1];
        if (dTagValue) {
             // Vitest doesn't automatically pick up conditional types well here, assert non-null
             (baseEvent as any).dTag = dTagValue;
        }
    }
    // Add published status if provided
    if (published !== undefined) {
        baseEvent.published = published;
    }
    return baseEvent;
}

// Helper to create a Kind 0 event with profile data
function createProfileEvent(
    pubkey: string,
    createdAt: number,
    profileData: NDKUserProfile,
    idSuffix: string = '',
    published?: boolean // Optional published status
): StoredEvent {
     const eventId = `profile-${pubkey}-${createdAt}${idSuffix}`;
    return createEvent(
        eventId,
        0,
        pubkey,
        createdAt,
        JSON.stringify(profileData),
        [], // Kind 0 doesn't typically have specific tags needed for identification here
        `sig-${eventId}`,
        published
    );
}


describe('localDb', () => {
    const pubkey1 = 'pk1';
    const pubkey2 = 'pk2';
    const dTag1 = 'list1';
    const dTag2 = 'list2';

    // Clean database tables before each test
    beforeEach(async () => {
        // Ensure DB is open before clearing tables
        if (!localDb.isOpen()) {
            await localDb.open();
        }
        // Clear all tables
        const tablesToClear = localDb.tables.map(table => table.clear());
        await Promise.all(tablesToClear);
    });

    // Close connection after each test
    afterEach(async () => {
        await localDb.close();
    });

    describe('addOrUpdateEvent', () => {

        // --- Non-Replaceable ---
        it('should add a new non-replaceable event marked as unpublished', async () => {
            const event = createEvent('nr_unpub', 1, pubkey1, 1000, '', [], undefined, false);
            await localDb.addOrUpdateEvent(event);
            const stored = await localDb.getEventById('nr_unpub');
            expect(stored).toEqual(event);
            expect(stored?.published).toBe(false);
        });

        it('should add a new non-replaceable event marked as published (true)', async () => {
            const event = createEvent('nr_pub', 1, pubkey1, 1000, '', [], undefined, true);
            await localDb.addOrUpdateEvent(event);
            const stored = await localDb.getEventById('nr_pub');
            expect(stored).toEqual(event);
            expect(stored?.published).toBe(true);
        });

         it('should add a new non-replaceable event without a published flag (defaults to undefined)', async () => {
            const event = createEvent('nr_undef', 1, pubkey1, 1000);
            await localDb.addOrUpdateEvent(event);
            const stored = await localDb.getEventById('nr_undef');
            expect(stored).toEqual(event);
            expect(stored?.published).toBeUndefined(); // Should not have the property
        });

        // --- Standard Replaceable ---
        it('should add a new std replaceable event marked unpublished', async () => {
            const event = createEvent('sr_unpub', 10002, pubkey1, 1000, '', [], undefined, false);
            await localDb.addOrUpdateEvent(event);
            const stored = await localDb.getLatestEventByCoord(10002, pubkey1);
            expect(stored).toEqual(event);
            expect(stored?.published).toBe(false);
        });

        it('should update a std replaceable event if newer, preserving unpublished status if incoming is undefined', async () => {
            const olderUnpublished = createEvent('sr_old_unpub', 10002, pubkey1, 1000, 'old', [], undefined, false);
            const newerNetwork = createEvent('sr_new_net', 10002, pubkey1, 1005, 'new'); // No published flag
            await localDb.addOrUpdateEvent(olderUnpublished);
            await localDb.addOrUpdateEvent(newerNetwork);
            const stored = await localDb.getLatestEventByCoord(10002, pubkey1);
            expect(stored?.id).toBe('sr_new_net');
            expect(stored?.content).toBe('new');
            expect(stored?.published).toBe(false); // Should retain the unpublished status
        });

        it('should update a std replaceable event if newer, explicitly setting published status if incoming has it', async () => {
            const olderUnpublished = createEvent('sr_old_unpub2', 10002, pubkey1, 1000, 'old', [], undefined, false);
            const newerPublished = createEvent('sr_new_pub', 10002, pubkey1, 1005, 'new', [], undefined, true);
            await localDb.addOrUpdateEvent(olderUnpublished);
            await localDb.addOrUpdateEvent(newerPublished);
            const stored = await localDb.getLatestEventByCoord(10002, pubkey1);
            expect(stored?.id).toBe('sr_new_pub');
            expect(stored?.published).toBe(true);
        });

        it('should NOT update a std replaceable event if incoming is older, even if published status differs', async () => {
            const newerUnpublished = createEvent('sr_new_unpub', 10002, pubkey1, 1005, 'new', [], undefined, false);
            const olderPublished = createEvent('sr_old_pub', 10002, pubkey1, 1000, 'old', [], undefined, true);
            await localDb.addOrUpdateEvent(newerUnpublished);
            await localDb.addOrUpdateEvent(olderPublished);
            const stored = await localDb.getLatestEventByCoord(10002, pubkey1);
            expect(stored?.id).toBe('sr_new_unpub');
            expect(stored?.published).toBe(false);
        });

        // --- Parameterized Replaceable ---
        it('should add a new param replaceable event marked unpublished', async () => {
            const event = createEvent('pr_unpub', 30003, pubkey1, 1000, '', [['d', dTag1]], undefined, false);
            await localDb.addOrUpdateEvent(event);
            const stored = await localDb.getLatestEventByCoord(30003, pubkey1, dTag1);
            expect(stored).toEqual(event);
            expect(stored?.published).toBe(false);
        });

        it('should update a param replaceable event if newer, preserving unpublished status if incoming is undefined', async () => {
            const olderUnpublished = createEvent('pr_old_unpub', 30003, pubkey1, 1000, 'old', [['d', dTag1]], undefined, false);
            const newerNetwork = createEvent('pr_new_net', 30003, pubkey1, 1005, 'new', [['d', dTag1]]); // No published flag
            await localDb.addOrUpdateEvent(olderUnpublished);
            await localDb.addOrUpdateEvent(newerNetwork);
            const stored = await localDb.getLatestEventByCoord(30003, pubkey1, dTag1);
            expect(stored?.id).toBe('pr_new_net');
            expect(stored?.content).toBe('new');
            expect(stored?.published).toBe(false); // Should retain the unpublished status
        });

        it('should update a param replaceable event if newer, explicitly setting published status if incoming has it', async () => {
            const olderUnpublished = createEvent('pr_old_unpub2', 30003, pubkey1, 1000, 'old', [['d', dTag1]], undefined, false);
            const newerPublished = createEvent('pr_new_pub', 30003, pubkey1, 1005, 'new', [['d', dTag1]], undefined, true);
            await localDb.addOrUpdateEvent(olderUnpublished);
            await localDb.addOrUpdateEvent(newerPublished);
            const stored = await localDb.getLatestEventByCoord(30003, pubkey1, dTag1);
            expect(stored?.id).toBe('pr_new_pub');
            expect(stored?.published).toBe(true);
        });

        it('should NOT update a param replaceable event if incoming is older, even if published status differs', async () => {
            const newerUnpublished = createEvent('pr_new_unpub', 30003, pubkey1, 1005, 'new', [['d', dTag1]], undefined, false);
            const olderPublished = createEvent('pr_old_pub', 30003, pubkey1, 1000, 'old', [['d', dTag1]], undefined, true);
            await localDb.addOrUpdateEvent(newerUnpublished);
            await localDb.addOrUpdateEvent(olderPublished);
            const stored = await localDb.getLatestEventByCoord(30003, pubkey1, dTag1);
            expect(stored?.id).toBe('pr_new_unpub');
            expect(stored?.published).toBe(false);
        });

    });

    describe('addOrUpdateProfile', () => {
        const profileData1: NDKUserProfile = { name: 'Alice', about: 'Test user 1' };
        const profileData2: NDKUserProfile = { name: 'Alice V2', about: 'Updated info' };

        it('should add a new profile from a Kind 0 marked unpublished', async () => {
            const event = createProfileEvent(pubkey1, 1000, profileData1, '_unpub', false);
            await localDb.addOrUpdateProfile(event);
            const storedProfile = await localDb.getProfile(pubkey1);
            const storedEvent = await localDb.getLatestEventByCoord(0, pubkey1);

            expect(storedProfile?.created_at).toBe(1000);
            expect(storedProfile?.profile).toEqual(profileData1);
            expect(storedEvent?.id).toBe(event.id);
            expect(storedEvent?.published).toBe(false);
        });

        it('should update profile if Kind 0 event is newer, preserving unpublished status if incoming is undefined', async () => {
            const eventOlderUnpub = createProfileEvent(pubkey1, 1000, profileData1, '_old_unpub', false);
            const eventNewerNet = createProfileEvent(pubkey1, 1005, profileData2, '_new_net'); // No published flag

            await localDb.addOrUpdateProfile(eventOlderUnpub);
            await localDb.addOrUpdateProfile(eventNewerNet);

            const storedProfile = await localDb.getProfile(pubkey1);
            const storedEvent = await localDb.getLatestEventByCoord(0, pubkey1);

            expect(storedProfile?.created_at).toBe(1005);
            expect(storedProfile?.profile).toEqual(profileData2);
            expect(storedEvent?.id).toBe(eventNewerNet.id);
            expect(storedEvent?.published).toBe(false); // Preserved from older event
        });

        it('should update profile if Kind 0 event is newer, setting published status if incoming has it', async () => {
            const eventOlderUnpub = createProfileEvent(pubkey1, 1000, profileData1, '_old_unpub2', false);
            const eventNewerPub = createProfileEvent(pubkey1, 1005, profileData2, '_new_pub', true);

            await localDb.addOrUpdateProfile(eventOlderUnpub);
            await localDb.addOrUpdateProfile(eventNewerPub);

            const storedProfile = await localDb.getProfile(pubkey1);
            const storedEvent = await localDb.getLatestEventByCoord(0, pubkey1);

            expect(storedProfile?.created_at).toBe(1005);
            expect(storedProfile?.profile).toEqual(profileData2);
            expect(storedEvent?.id).toBe(eventNewerPub.id);
            expect(storedEvent?.published).toBe(true);
        });

        it('should NOT update profile if Kind 0 event is older', async () => {
            const eventNewerUnpub = createProfileEvent(pubkey1, 1005, profileData2, '_new_unpub', false);
            const eventOlderPub = createProfileEvent(pubkey1, 1000, profileData1, '_old_pub', true);

            await localDb.addOrUpdateProfile(eventNewerUnpub);
            await localDb.addOrUpdateProfile(eventOlderPub);

            const storedProfile = await localDb.getProfile(pubkey1);
            const storedEvent = await localDb.getLatestEventByCoord(0, pubkey1);

            expect(storedProfile?.created_at).toBe(1005);
            expect(storedProfile?.profile).toEqual(profileData2);
            expect(storedEvent?.id).toBe(eventNewerUnpub.id);
            expect(storedEvent?.published).toBe(false);
        });

    });

    // --- L6.1: Tests for New Methods ---

    describe('markEventAsPublished', () => {
        it('should set the published flag to true for an existing unpublished event', async () => {
            const event = createEvent('mark_me', 1, pubkey1, 1000, '', [], undefined, false);
            await localDb.addOrUpdateEvent(event);
            let stored = await localDb.getEventById('mark_me');
            expect(stored?.published).toBe(false);

            await localDb.markEventAsPublished('mark_me');

            stored = await localDb.getEventById('mark_me');
            expect(stored).toBeDefined();
            expect(stored?.published).toBe(true);
        });

        it('should set the published flag to true for an existing event with undefined published status', async () => {
            const event = createEvent('mark_me_undef', 1, pubkey1, 1000);
            await localDb.addOrUpdateEvent(event);
            let stored = await localDb.getEventById('mark_me_undef');
            expect(stored?.published).toBeUndefined();

            await localDb.markEventAsPublished('mark_me_undef');

            stored = await localDb.getEventById('mark_me_undef');
            expect(stored).toBeDefined();
            expect(stored?.published).toBe(true);
        });

         it('should do nothing if the event ID does not exist', async () => {
            // Use spyOn to check console.warn, Vitest doesn't directly support this easily without setup
            // Instead, we just check that no error is thrown and the operation completes.
             await expect(localDb.markEventAsPublished('non_existent_id')).resolves.toBeUndefined();
             // Verify no event was accidentally created
             await expect(localDb.getEventById('non_existent_id')).resolves.toBeUndefined();
        });

        it('should not change the status if the event is already marked as published', async () => {
             const event = createEvent('already_published', 1, pubkey1, 1000, '', [], undefined, true);
            await localDb.addOrUpdateEvent(event);
            let stored = await localDb.getEventById('already_published');
            expect(stored?.published).toBe(true);

            await localDb.markEventAsPublished('already_published'); // Mark again

            stored = await localDb.getEventById('already_published');
            expect(stored).toBeDefined();
            expect(stored?.published).toBe(true); // Should remain true
        });
    });

    describe('getUnpublishedEvents', () => {
        const pubkeyUnpub = 'pk_unpub_test';

        it('should return events explicitly marked as published: false', async () => {
            const event1 = createEvent('unpub_1', 1, pubkeyUnpub, 1000, '', [], undefined, false);
            const event2 = createEvent('unpub_2', 30003, pubkeyUnpub, 1005, '', [['d', dTag1]], undefined, false);
            await localDb.addOrUpdateEvent(event1);
            await localDb.addOrUpdateEvent(event2);

            const unpublished = await localDb.getUnpublishedEvents(pubkeyUnpub);
            expect(unpublished).toHaveLength(2);
            expect(unpublished.map(e => e.id).sort()).toEqual(['unpub_1', 'unpub_2'].sort());
        });

        it('should return events with undefined published status', async () => {
            const event1 = createEvent('undef_1', 1, pubkeyUnpub, 1000); // No published flag
            const event2 = createEvent('undef_2', 10002, pubkeyUnpub, 1005); // No published flag
            await localDb.addOrUpdateEvent(event1);
            await localDb.addOrUpdateEvent(event2);

            const unpublished = await localDb.getUnpublishedEvents(pubkeyUnpub);
            expect(unpublished).toHaveLength(2);
            expect(unpublished.map(e => e.id).sort()).toEqual(['undef_1', 'undef_2'].sort());
            expect(unpublished.every(e => e.published === undefined)).toBe(true);
        });

        it('should NOT return events marked as published: true', async () => {
            const eventUnpub = createEvent('unpub_mix', 1, pubkeyUnpub, 1000, '', [], undefined, false);
            const eventPub = createEvent('pub_mix', 1, pubkeyUnpub, 1005, '', [], undefined, true);
            const eventUndef = createEvent('undef_mix', 1, pubkeyUnpub, 1010);
            await localDb.addOrUpdateEvent(eventUnpub);
            await localDb.addOrUpdateEvent(eventPub);
            await localDb.addOrUpdateEvent(eventUndef);

            const unpublished = await localDb.getUnpublishedEvents(pubkeyUnpub);
            expect(unpublished).toHaveLength(2);
            expect(unpublished.map(e => e.id).sort()).toEqual(['undef_mix', 'unpub_mix'].sort());
            expect(unpublished.find(e => e.id === 'pub_mix')).toBeUndefined();
        });

        it('should return an empty array if no events exist for the pubkey', async () => {
            await expect(localDb.getUnpublishedEvents('non_existent_pk')).resolves.toEqual([]);
        });

        it('should return an empty array if all events for the pubkey are published: true', async () => {
            const event1 = createEvent('all_pub_1', 1, pubkeyUnpub, 1000, '', [], undefined, true);
            const event2 = createEvent('all_pub_2', 10002, pubkeyUnpub, 1005, '', [], undefined, true);
            await localDb.addOrUpdateEvent(event1);
            await localDb.addOrUpdateEvent(event2);

            await expect(localDb.getUnpublishedEvents(pubkeyUnpub)).resolves.toEqual([]);
        });

         it('should only return events for the specified pubkey', async () => {
            const eventPk1Unpub = createEvent('pk1_unpub', 1, pubkey1, 1000, '', [], undefined, false);
            const eventPk1Pub = createEvent('pk1_pub', 1, pubkey1, 1005, '', [], undefined, true);
            const eventPk2Unpub = createEvent('pk2_unpub', 1, pubkey2, 1010, '', [], undefined, false);
            const eventPk2Undef = createEvent('pk2_undef', 1, pubkey2, 1015);
            await localDb.addOrUpdateEvent(eventPk1Unpub);
            await localDb.addOrUpdateEvent(eventPk1Pub);
            await localDb.addOrUpdateEvent(eventPk2Unpub);
            await localDb.addOrUpdateEvent(eventPk2Undef);

            const unpublishedPk1 = await localDb.getUnpublishedEvents(pubkey1);
            expect(unpublishedPk1).toHaveLength(1);
            expect(unpublishedPk1[0].id).toBe('pk1_unpub');

            const unpublishedPk2 = await localDb.getUnpublishedEvents(pubkey2);
            expect(unpublishedPk2).toHaveLength(2);
            expect(unpublishedPk2.map(e => e.id).sort()).toEqual(['pk2_undef', 'pk2_unpub'].sort());
        });
    });
}); 