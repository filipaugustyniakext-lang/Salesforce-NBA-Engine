/**
 * Daily scheduled job that:
 *  1. Promotes Scheduled versions whose Valid_From <= today → Active.
 *  2. Deactivates the paired Active versions tagged Scheduled for Deactivation.
 *  3. Deactivates any Active or Scheduled version whose Valid_To < today (expired).
 *  4. Syncs master Offer__c status accordingly.
 */
global class OfferVersionScheduler implements Schedulable {

    global void execute(SchedulableContext ctx) {
        run();
    }

    public static void run() {
        Date today = Date.today();

        // ── Step 1: promote Scheduled → In Use ───────────────────────────────
        List<Offer_Version__c> toActivate = [
            SELECT Id, Offer_Lookup__c, Offer_Version_Id__c,
                   Attractiveness_Score__c, Country_Code__c, Currency_Code__c
            FROM Offer_Version__c
            WHERE Version_Status__c = 'Scheduled'
              AND Schedule_Status__c = 'Scheduled for Activation'
              AND Valid_From__c <= :today
              AND Valid_To__c >= :today
        ];

        Set<Id> activatedOfferIds = new Set<Id>();
        for (Offer_Version__c v : toActivate) {
            activatedOfferIds.add(v.Offer_Lookup__c);
        }

        // Deactivate the paired In-Use/Scheduled-for-Deactivation versions
        if (!activatedOfferIds.isEmpty()) {
            List<Offer_Version__c> toDeactivate = [
                SELECT Id FROM Offer_Version__c
                WHERE Offer_Lookup__c IN :activatedOfferIds
                  AND Version_Status__c = 'Active'
                  AND Schedule_Status__c = 'Scheduled for Deactivation'
            ];
            for (Offer_Version__c v : toDeactivate) {
                v.Version_Status__c = 'Deactivated';
                v.Schedule_Status__c = null;
                v.Schedule_Date__c = null;
                v.Is_Active__c = false;
            }
            if (!toDeactivate.isEmpty()) update toDeactivate;
        }

        for (Offer_Version__c v : toActivate) {
            v.Version_Status__c = 'Active';
            v.Schedule_Status__c = null;
            v.Schedule_Date__c = null;
            v.Is_Active__c = true;
        }
        if (!toActivate.isEmpty()) update toActivate;

        // After promotion, recalculate deactivation schedule for the newly Active versions
        // in case more scheduled versions remain for the same offer
        for (Id offerId : activatedOfferIds) {
            OfferController.refreshDeactivationSchedulePublic(offerId);
        }

        // ── Step 2: expire versions whose Valid_To < today ───────────────────
        List<Offer_Version__c> toExpire = [
            SELECT Id, Offer_Lookup__c, Schedule_Status__c
            FROM Offer_Version__c
            WHERE Version_Status__c IN ('Active', 'Scheduled')
              AND Valid_To__c < :today
        ];

        Set<Id> expiredOfferIds = new Set<Id>();
        for (Offer_Version__c v : toExpire) {
            expiredOfferIds.add(v.Offer_Lookup__c);
            v.Version_Status__c = 'Deactivated';
            v.Schedule_Status__c = null;
            v.Schedule_Date__c = null;
            v.Is_Active__c = false;
        }
        if (!toExpire.isEmpty()) update toExpire;

        // ── Step 3: sync master Offer__c ─────────────────────────────────────
        // Include offers touched today, plus any offer still marked Active/Inactive
        // whose version state may have drifted (catch-all for missed days).
        Set<Id> allAffectedOfferIds = new Set<Id>();
        allAffectedOfferIds.addAll(activatedOfferIds);
        allAffectedOfferIds.addAll(expiredOfferIds);

        // Also catch offers that are marked Active on the master but have no Active version
        List<Offer__c> staleActiveOffers = [
            SELECT Id FROM Offer__c
            WHERE Offer_Status__c = 'Active'
              AND Id NOT IN (
                  SELECT Offer_Lookup__c FROM Offer_Version__c
                  WHERE Version_Status__c = 'Active'
              )
        ];
        for (Offer__c o : staleActiveOffers) {
            allAffectedOfferIds.add(o.Id);
        }

        if (allAffectedOfferIds.isEmpty()) return;

        // Check which affected offers still have an Active version
        List<Offer_Version__c> stillActive = [
            SELECT Id, Offer_Lookup__c, Offer_Version_Id__c, Attractiveness_Score__c
            FROM Offer_Version__c
            WHERE Offer_Lookup__c IN :allAffectedOfferIds
              AND Version_Status__c = 'Active'
        ];
        Map<Id, Offer_Version__c> stillActiveByOffer = new Map<Id, Offer_Version__c>();
        for (Offer_Version__c v : stillActive) {
            stillActiveByOffer.put(v.Offer_Lookup__c, v);
        }

        List<Offer__c> offersToUpdate = [
            SELECT Id, Is_Active__c, Offer_Status__c, Offer_Version_Id__c, Attractiveness_Score__c
            FROM Offer__c
            WHERE Id IN :allAffectedOfferIds
        ];
        for (Offer__c o : offersToUpdate) {
            Offer_Version__c active = stillActiveByOffer.get(o.Id);
            if (active != null) {
                o.Is_Active__c = true;
                o.Offer_Status__c = 'Active';
                o.Offer_Version_Id__c = active.Offer_Version_Id__c;
                o.Attractiveness_Score__c = active.Attractiveness_Score__c;
            } else {
                // No active version remaining — set offer to Inactive
                o.Is_Active__c = false;
                o.Offer_Status__c = 'Inactive';
            }
        }
        if (!offersToUpdate.isEmpty()) update offersToUpdate;
    }
}