/**
 * Resolves campaign-assigned offers and copy variants using live catalogue state.
 *
 * Junction rows (Campaign_Offer__c, Campaign_Copy_Variant__c) express marketer
 * intent at save time. All customer processing, content assignment, and offer
 * selection must call these resolvers (or equivalent SOQL) at evaluation time —
 * never rely on denormalized snapshots on Campaign or stale junction flags alone.
 */
public with sharing class CampaignRuntimeCatalogService {

    public static final String OFFER_STATUS_ACTIVE = 'Active';
    public static final String COPY_STATUS_PUBLISHED = 'Published';

    /**
     * Offers linked on the campaign that are usable right now: Active header plus
     * an in-date active version row.
     */
    @AuraEnabled(cacheable=false)
    public static List<Map<String, String>> resolveEligibleOffersForCampaign(Id campaignId) {
        if (campaignId == null) {
            return new List<Map<String, String>>();
        }

        Set<Id> assignedOfferIds = new Set<Id>();
        for (Campaign_Offer__c row : [
            SELECT Offer__c
            FROM Campaign_Offer__c
            WHERE Campaign__c = :campaignId
            AND Offer__c != null
        ]) {
            assignedOfferIds.add(row.Offer__c);
        }
        if (assignedOfferIds.isEmpty()) {
            return new List<Map<String, String>>();
        }

        Date today = Date.today();
        Map<Id, Offer_Version__c> activeVersionByOffer = mapCurrentActiveVersions(assignedOfferIds, today);

        List<Map<String, String>> results = new List<Map<String, String>>();
        for (Offer__c offer : [
            SELECT Id, Name, Offer_Status__c
            FROM Offer__c
            WHERE Id IN :assignedOfferIds
            AND Offer_Status__c = :OFFER_STATUS_ACTIVE
            ORDER BY Name ASC
            LIMIT 200
        ]) {
            if (!activeVersionByOffer.containsKey(offer.Id)) {
                continue;
            }
            Offer_Version__c version = activeVersionByOffer.get(offer.Id);
            results.add(new Map<String, String>{
                'id' => offer.Id,
                'name' => offer.Name,
                'status' => offer.Offer_Status__c,
                'activeVersionId' => version.Id,
                'versionNumber' => version.Version_Number__c == null
                    ? null
                    : String.valueOf(version.Version_Number__c)
            });
        }
        return results;
    }

    /**
     * Copy variants assigned on the campaign whose Copy Cockpit source row is
     * Published at query time (ignores stale Is_Eligible__c=false when status
     * was restored to Published).
     */
    @AuraEnabled(cacheable=false)
    public static List<Map<String, String>> resolveEligibleCopyVariantsForCampaign(Id campaignId) {
        if (campaignId == null) {
            return new List<Map<String, String>>();
        }

        List<Map<String, String>> results = new List<Map<String, String>>();
        for (Campaign_Copy_Variant__c row : [
            SELECT Message_Variant__c,
                   Message_Variant__r.Status__c,
                   Message_Variant__r.Channel_Type__c,
                   Message_Variant__r.Name
            FROM Campaign_Copy_Variant__c
            WHERE Campaign__c = :campaignId
            AND Message_Variant__c != null
            AND Message_Variant__r.Status__c = :COPY_STATUS_PUBLISHED
        ]) {
            results.add(new Map<String, String>{
                'id' => row.Message_Variant__c,
                'status' => row.Message_Variant__r.Status__c,
                'channelType' => row.Message_Variant__r.Channel_Type__c,
                'name' => row.Message_Variant__r.Name
            });
        }
        return results;
    }

    private static Map<Id, Offer_Version__c> mapCurrentActiveVersions(Set<Id> offerIds, Date today) {
        Map<Id, Offer_Version__c> byOffer = new Map<Id, Offer_Version__c>();
        for (Offer_Version__c version : [
            SELECT Id, Offer_Lookup__c, Version_Number__c, Valid_From__c, Valid_To__c
            FROM Offer_Version__c
            WHERE Offer_Lookup__c IN :offerIds
            AND Is_Active__c = true
            ORDER BY CreatedDate DESC
        ]) {
            if (!isVersionEffectiveOn(version, today)) {
                continue;
            }
            if (!byOffer.containsKey(version.Offer_Lookup__c)) {
                byOffer.put(version.Offer_Lookup__c, version);
            }
        }
        return byOffer;
    }

    @TestVisible
    private static Boolean isVersionEffectiveOn(Offer_Version__c version, Date today) {
        if (version == null || today == null) {
            return false;
        }
        if (version.Valid_From__c != null && version.Valid_From__c > today) {
            return false;
        }
        if (version.Valid_To__c != null && version.Valid_To__c < today) {
            return false;
        }
        return true;
    }
}
