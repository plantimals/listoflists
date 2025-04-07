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
    sig: string = `sig-${id}`
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
    return baseEvent;
}

// Helper to create a Kind 0 event with profile data
function createProfileEvent(
    pubkey: string,
    createdAt: number,
    profileData: NDKUserProfile,
    idSuffix: string = ''
): StoredEvent {
     const eventId = `profile-${pubkey}-${createdAt}${idSuffix}`;
    return createEvent(
        eventId,
        0,
        pubkey,
        createdAt,
        JSON.stringify(profileData),
        [] // Kind 0 doesn't typically have specific tags needed for identification here
    );
}


describe('localDb', () => {
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
        const pubkey1 = 'pk1';
        const pubkey2 = 'pk2';

        // --- Non-Replaceable ---
        it('should add a new non-replaceable event', async () => {
            const event = createEvent('nr1', 1, pubkey1, 1000);
            await localDb.addOrUpdateEvent(event);
            await expect(localDb.getEventById('nr1')).resolves.toEqual(event);
        });

        it('should add multiple non-replaceable events with the same kind/pubkey', async () => {
            const event1 = createEvent('nr1', 1, pubkey1, 1000);
            const event2 = createEvent('nr2', 1, pubkey1, 1005); // Same kind/pubkey, different id/time
            await localDb.addOrUpdateEvent(event1);
            await localDb.addOrUpdateEvent(event2);
            await expect(localDb.getEventById('nr1')).resolves.toEqual(event1);
            await expect(localDb.getEventById('nr2')).resolves.toEqual(event2);
        });

        // --- Standard Replaceable ---
        it('should add a new standard replaceable event (Kind 10000)', async () => {
            const event = createEvent('sr1', 10000, pubkey1, 1000);
            await localDb.addOrUpdateEvent(event);
            await expect(localDb.getLatestEventByCoord(10000, pubkey1)).resolves.toEqual(event);
        });

         it('should update a standard replaceable event if the new event is newer', async () => {
            const eventOlder = createEvent('sr_old', 10000, pubkey1, 1000);
            const eventNewer = createEvent('sr_new', 10000, pubkey1, 1005, 'new content');
            await localDb.addOrUpdateEvent(eventOlder);
            await localDb.addOrUpdateEvent(eventNewer);
            await expect(localDb.getLatestEventByCoord(10000, pubkey1)).resolves.toEqual(eventNewer);
             // Check if the old event ID is gone (optional, depends on implementation detail)
            // Assuming addOrUpdateEvent replaces based on coordinate and might leave old ID if different
            // await expect(localDb.getEventById('sr_old')).resolves.toBeUndefined();
        });

        it('should NOT update a standard replaceable event if the new event is older', async () => {
            const eventNewer = createEvent('sr_new', 10000, pubkey1, 1005);
            const eventOlder = createEvent('sr_old', 10000, pubkey1, 1000, 'old content');
            await localDb.addOrUpdateEvent(eventNewer);
            await localDb.addOrUpdateEvent(eventOlder);
            await expect(localDb.getLatestEventByCoord(10000, pubkey1)).resolves.toEqual(eventNewer);
        });

        it('should keep the existing standard replaceable event if timestamps are identical', async () => {
            const event1 = createEvent('sr_1', 10000, pubkey1, 1000, 'content 1');
            const event2 = createEvent('sr_2', 10000, pubkey1, 1000, 'content 2'); // Same time, different ID/content
            await localDb.addOrUpdateEvent(event1);
            await localDb.addOrUpdateEvent(event2);
            await expect(localDb.getLatestEventByCoord(10000, pubkey1)).resolves.toEqual(event1);
        });


        // --- Parameterized Replaceable ---
        const dTag1 = 'bookmarks';
        const dTag2 = 'articles';

        it('should add a new parameterized replaceable event', async () => {
            const event = createEvent('pr1', 30003, pubkey1, 1000, '', [['d', dTag1]]);
            await localDb.addOrUpdateEvent(event);
            await expect(localDb.getLatestEventByCoord(30003, pubkey1, dTag1)).resolves.toEqual(event);
        });

         it('should add multiple parameterized replaceable events with different dTags', async () => {
            const event1 = createEvent('pr1_d1', 30003, pubkey1, 1000, '', [['d', dTag1]]);
            const event2 = createEvent('pr1_d2', 30003, pubkey1, 1005, '', [['d', dTag2]]); // Different dTag
            await localDb.addOrUpdateEvent(event1);
            await localDb.addOrUpdateEvent(event2);
            await expect(localDb.getLatestEventByCoord(30003, pubkey1, dTag1)).resolves.toEqual(event1);
            await expect(localDb.getLatestEventByCoord(30003, pubkey1, dTag2)).resolves.toEqual(event2);
        });

        it('should update a parameterized replaceable event if the new event is newer (same dTag)', async () => {
            const eventOlder = createEvent('pr_old', 30003, pubkey1, 1000, 'old', [['d', dTag1]]);
            const eventNewer = createEvent('pr_new', 30003, pubkey1, 1005, 'new', [['d', dTag1]]);
            await localDb.addOrUpdateEvent(eventOlder);
            await localDb.addOrUpdateEvent(eventNewer);
            await expect(localDb.getLatestEventByCoord(30003, pubkey1, dTag1)).resolves.toEqual(eventNewer);
        });

        it('should NOT update a parameterized replaceable event if the new event is older (same dTag)', async () => {
            const eventNewer = createEvent('pr_new', 30003, pubkey1, 1005, 'new', [['d', dTag1]]);
            const eventOlder = createEvent('pr_old', 30003, pubkey1, 1000, 'old', [['d', dTag1]]);
            await localDb.addOrUpdateEvent(eventNewer);
            await localDb.addOrUpdateEvent(eventOlder);
            await expect(localDb.getLatestEventByCoord(30003, pubkey1, dTag1)).resolves.toEqual(eventNewer);
        });

         it('should keep the existing parameterized replaceable event if timestamps are identical (same dTag)', async () => {
            const event1 = createEvent('pr_1', 30003, pubkey1, 1000, 'content 1', [['d', dTag1]]);
            const event2 = createEvent('pr_2', 30003, pubkey1, 1000, 'content 2', [['d', dTag1]]);
            await localDb.addOrUpdateEvent(event1);
            await localDb.addOrUpdateEvent(event2);
            await expect(localDb.getLatestEventByCoord(30003, pubkey1, dTag1)).resolves.toEqual(event1);
        });
    });

    describe('addOrUpdateProfile', () => {
        const pubkey1 = 'pk_profile1';
        const profileData1: NDKUserProfile = { name: 'Alice', about: 'Test user 1' };
        const profileData2: NDKUserProfile = { name: 'Alice V2', about: 'Updated info' };

        it('should add a new profile from a Kind 0 event', async () => {
            const event = createProfileEvent(pubkey1, 1000, profileData1);
            await localDb.addOrUpdateProfile(event);
            const storedProfile = await localDb.getProfile(pubkey1);
            expect(storedProfile).toBeDefined();
            expect(storedProfile?.pubkey).toBe(pubkey1);
            expect(storedProfile?.created_at).toBe(1000);
            expect(storedProfile?.profile).toEqual(profileData1);
            // Also check the underlying event store
            await expect(localDb.getLatestEventByCoord(0, pubkey1)).resolves.toEqual(event);
        });

        it('should update profile if Kind 0 event is newer', async () => {
            const eventOlder = createProfileEvent(pubkey1, 1000, profileData1, '_old');
            const eventNewer = createProfileEvent(pubkey1, 1005, profileData2, '_new');
            await localDb.addOrUpdateProfile(eventOlder);
            await localDb.addOrUpdateProfile(eventNewer);
            const storedProfile = await localDb.getProfile(pubkey1);
            expect(storedProfile?.created_at).toBe(1005);
            expect(storedProfile?.profile).toEqual(profileData2);
            // Check underlying event store reflects the newer event
            await expect(localDb.getLatestEventByCoord(0, pubkey1)).resolves.toEqual(eventNewer);
        });

        it('should NOT update profile if Kind 0 event is older', async () => {
            const eventNewer = createProfileEvent(pubkey1, 1005, profileData2, '_new');
            const eventOlder = createProfileEvent(pubkey1, 1000, profileData1, '_old');
            await localDb.addOrUpdateProfile(eventNewer);
            await localDb.addOrUpdateProfile(eventOlder); // Attempt to add older
            const storedProfile = await localDb.getProfile(pubkey1);
            expect(storedProfile?.created_at).toBe(1005); // Should still be newer time
            expect(storedProfile?.profile).toEqual(profileData2); // Should still be newer data
             // Check underlying event store still has the newer event
            await expect(localDb.getLatestEventByCoord(0, pubkey1)).resolves.toEqual(eventNewer);
        });

        it('should keep the existing profile if Kind 0 timestamps are identical', async () => {
             const event1 = createProfileEvent(pubkey1, 1000, profileData1, '_1');
             const event2 = createProfileEvent(pubkey1, 1000, profileData2, '_2'); // Same time, different content
            await localDb.addOrUpdateProfile(event1);
            await localDb.addOrUpdateProfile(event2);
            const storedProfile = await localDb.getProfile(pubkey1);
            expect(storedProfile?.created_at).toBe(1000);
            expect(storedProfile?.profile).toEqual(profileData1); // Should be data from event1
            await expect(localDb.getLatestEventByCoord(0, pubkey1)).resolves.toEqual(event1); // Check event store too
        });

        it('should ignore events that are not Kind 0', async () => {
            const eventKind1 = createEvent('kind1_event', 1, pubkey1, 1000, 'not a profile');
            await localDb.addOrUpdateProfile(eventKind1);
            await expect(localDb.getProfile(pubkey1)).resolves.toBeUndefined();
            // Check event wasn't added via profile logic
             await expect(localDb.getLatestEventByCoord(0, pubkey1)).resolves.toBeUndefined();
             // Check it wasn't added as a generic event either via this function
             await expect(localDb.getEventById('kind1_event')).resolves.toBeUndefined();
        });

        it('should handle profiles for different pubkeys correctly', async () => {
             const pubkey2 = 'pk_profile2';
             const profileData_pk2: NDKUserProfile = { name: 'Bob' };
             const event1 = createProfileEvent(pubkey1, 1000, profileData1);
             const event2 = createProfileEvent(pubkey2, 1005, profileData_pk2);
             await localDb.addOrUpdateProfile(event1);
             await localDb.addOrUpdateProfile(event2);
             await expect(localDb.getProfile(pubkey1)).resolves.toHaveProperty('profile', profileData1);
             await expect(localDb.getProfile(pubkey2)).resolves.toHaveProperty('profile', profileData_pk2);
        });
    });
}); 