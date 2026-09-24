/**
 * Keeps Campaign offering display labels (Names) in sync with dictionary Id links.
 * Product_Family_Ids__c / Family_of_Needs_Ids__c = background SSOT
 * Product_Family__c / Family_of_Needs__c = user-visible labels
 *
 * Note: Product_Family* / Family_of_Needs* are LongTextArea and cannot be filtered in SOQL.
 */
public without sharing class CampaignOfferingLabelSync {

    public static void syncLabels(List<Campaign> campaigns) {
        if (campaigns == null || campaigns.isEmpty()) return;

        Catalogue cat = loadCatalogue();
        for (Campaign c : campaigns) {
            syncOne(c, 'Product Family', cat);
            syncOne(c, 'Family of Needs', cat);
            if (c.Topic_Dict__c != null && cat.topicById.containsKey(c.Topic_Dict__c)) {
                c.Topic_Name__c = cat.topicById.get(c.Topic_Dict__c).Name;
            }
        }
    }

    /**
     * Heal campaigns that still store Ids in the display fields (mid-migration),
     * or whose display labels are stale relative to Product_Family_Ids__c.
     * @return number of campaigns updated
     */
    public static Integer healCampaigns(Integer maxRows) {
        Integer lim = maxRows == null || maxRows <= 0 ? 200 : Math.min(maxRows, 2000);
        // LongTextArea fields are not filterable — scope by Offering_Type / Topic lookup.
        List<Campaign> rows = [
            SELECT Id, Topic_Dict__c, Topic_Name__c,
                   Product_Family__c, Product_Family_Ids__c,
                   Family_of_Needs__c, Family_of_Needs_Ids__c
            FROM Campaign
            WHERE Offering_Type__c != null
               OR Topic_Dict__c != null
            ORDER BY LastModifiedDate DESC
            LIMIT :lim
        ];
        if (rows.isEmpty()) return 0;

        Catalogue cat = loadCatalogue();
        List<Campaign> toUpdate = new List<Campaign>();
        for (Campaign c : rows) {
            String beforePf = c.Product_Family__c;
            String beforePfIds = c.Product_Family_Ids__c;
            String beforeFon = c.Family_of_Needs__c;
            String beforeFonIds = c.Family_of_Needs_Ids__c;
            String beforeTopic = c.Topic_Name__c;

            syncOne(c, 'Product Family', cat);
            syncOne(c, 'Family of Needs', cat);
            if (c.Topic_Dict__c != null && cat.topicById.containsKey(c.Topic_Dict__c)) {
                c.Topic_Name__c = cat.topicById.get(c.Topic_Dict__c).Name;
            }

            if (beforePf != c.Product_Family__c
                || beforePfIds != c.Product_Family_Ids__c
                || beforeFon != c.Family_of_Needs__c
                || beforeFonIds != c.Family_of_Needs_Ids__c
                || beforeTopic != c.Topic_Name__c) {
                toUpdate.add(c);
            }
        }
        if (!toUpdate.isEmpty()) {
            // Avoid re-entrancy loops with the before trigger by using a static flag.
            RUNNING_HEAL = true;
            try {
                update toUpdate;
            } finally {
                RUNNING_HEAL = false;
            }
        }
        return toUpdate.size();
    }

    public static Boolean RUNNING_HEAL = false;

    /**
     * After a Product Family / FoN dictionary rename, refresh Campaign display labels
     * for rows linked by Id (or still holding the old Name).
     */
    public static void onDictionaryRename(Id dictId, String oldName, String newName, String subType) {
        if (dictId == null || String.isBlank(newName)) return;
        String idToken = String.valueOf(dictId);

        if (subType == 'Topic') {
            List<Campaign> camps = [
                SELECT Id, Topic_Name__c
                FROM Campaign
                WHERE Topic_Dict__c = :dictId
                LIMIT 2000
            ];
            for (Campaign c : camps) {
                c.Topic_Name__c = newName;
            }
            if (!camps.isEmpty()) {
                RUNNING_HEAL = true;
                try { update camps; } finally { RUNNING_HEAL = false; }
            }
            return;
        }

        Boolean isPf = subType == 'Product Family';
        Boolean isFon = subType == 'Family of Needs';
        if (!isPf && !isFon) return;

        // LongTextArea cannot be filtered — load by Offering_Type, match tokens in Apex.
        // Campaign picklist stores "Family of needs" (lowercase n); wizard may normalize to "Family of Needs".
        Set<String> offeringTypes = isPf
            ? new Set<String>{ 'Product Family' }
            : new Set<String>{ 'Family of Needs', 'Family of needs' };
        List<Campaign> scanned = [
            SELECT Id, Offering_Type__c,
                   Product_Family__c, Product_Family_Ids__c,
                   Family_of_Needs__c, Family_of_Needs_Ids__c
            FROM Campaign
            WHERE Offering_Type__c IN :offeringTypes
            ORDER BY LastModifiedDate DESC
            LIMIT 2000
        ];

        List<Campaign> candidates = new List<Campaign>();
        for (Campaign c : scanned) {
            String rawIds = isPf ? c.Product_Family_Ids__c : c.Family_of_Needs_Ids__c;
            String rawLabels = isPf ? c.Product_Family__c : c.Family_of_Needs__c;
            if (containsToken(rawIds, idToken)
                || containsToken(rawLabels, idToken)
                || (String.isNotBlank(oldName) && containsToken(rawLabels, oldName))) {
                candidates.add(c);
            }
        }

        Catalogue cat = loadCatalogue();
        List<Campaign> toUpdate = new List<Campaign>();
        for (Campaign c : candidates) {
            String beforeLabel = isPf ? c.Product_Family__c : c.Family_of_Needs__c;
            String beforeIds = isPf ? c.Product_Family_Ids__c : c.Family_of_Needs_Ids__c;
            syncOne(c, subType, cat);
            String afterLabel = isPf ? c.Product_Family__c : c.Family_of_Needs__c;
            String afterIds = isPf ? c.Product_Family_Ids__c : c.Family_of_Needs_Ids__c;
            if (beforeLabel != afterLabel || beforeIds != afterIds) {
                toUpdate.add(c);
            }
        }
        if (!toUpdate.isEmpty()) {
            RUNNING_HEAL = true;
            try { update toUpdate; } finally { RUNNING_HEAL = false; }
        }
    }

    private static Boolean containsToken(String raw, String token) {
        if (String.isBlank(raw) || String.isBlank(token)) return false;
        for (String part : parseSemi(raw)) {
            if (part == token) return true;
        }
        // Also allow substring match for 15-char vs 18-char Id variants.
        return raw.contains(token);
    }

    private static void syncOne(Campaign c, String subType, Catalogue cat) {
        Boolean isPf = subType == 'Product Family';
        String rawIds = isPf ? c.Product_Family_Ids__c : c.Family_of_Needs_Ids__c;
        String rawLabels = isPf ? c.Product_Family__c : c.Family_of_Needs__c;

        List<String> tokens = parseSemi(String.isNotBlank(rawIds) ? rawIds : rawLabels);
        if (tokens.isEmpty()) {
            if (isPf) {
                c.Product_Family_Ids__c = null;
                // Leave blank labels as-is when both empty
                if (String.isBlank(rawIds) && String.isBlank(rawLabels)) return;
                c.Product_Family__c = null;
            } else {
                c.Family_of_Needs_Ids__c = null;
                if (String.isBlank(rawIds) && String.isBlank(rawLabels)) return;
                c.Family_of_Needs__c = null;
            }
            return;
        }

        Map<Id, Marketing_Dictionary__c> byId = isPf ? cat.pfById : cat.fonById;
        Map<String, Marketing_Dictionary__c> byName = isPf ? cat.pfByName : cat.fonByName;

        List<String> ids = new List<String>();
        List<String> labels = new List<String>();
        Set<Id> seen = new Set<Id>();

        for (String token : tokens) {
            Marketing_Dictionary__c match = null;
            if (isSalesforceId(token)) {
                try {
                    match = byId.get((Id) token);
                } catch (Exception e) {
                    match = null;
                }
            }
            if (match == null) {
                match = byName.get(token);
            }
            if (match == null || seen.contains(match.Id)) continue;
            seen.add(match.Id);
            ids.add(String.valueOf(match.Id));
            labels.add(match.Name);
        }

        String idJoined = ids.isEmpty() ? null : String.join(ids, '; ');
        String labelJoined = labels.isEmpty() ? null : String.join(labels, '; ');
        if (isPf) {
            c.Product_Family_Ids__c = idJoined;
            c.Product_Family__c = labelJoined;
        } else {
            c.Family_of_Needs_Ids__c = idJoined;
            c.Family_of_Needs__c = labelJoined;
        }
    }

    private static Boolean isSalesforceId(String token) {
        if (String.isBlank(token)) return false;
        Integer len = token.length();
        if (len != 15 && len != 18) return false;
        return Pattern.matches('[a-zA-Z0-9]+', token);
    }

    private static List<String> parseSemi(String raw) {
        List<String> out = new List<String>();
        if (String.isBlank(raw)) return out;
        for (String part : raw.split(';')) {
            String t = part == null ? '' : part.trim();
            if (String.isNotBlank(t)) out.add(t);
        }
        return out;
    }

    private class Catalogue {
        Map<Id, Marketing_Dictionary__c> pfById = new Map<Id, Marketing_Dictionary__c>();
        Map<String, Marketing_Dictionary__c> pfByName = new Map<String, Marketing_Dictionary__c>();
        Map<Id, Marketing_Dictionary__c> fonById = new Map<Id, Marketing_Dictionary__c>();
        Map<String, Marketing_Dictionary__c> fonByName = new Map<String, Marketing_Dictionary__c>();
        Map<Id, Marketing_Dictionary__c> topicById = new Map<Id, Marketing_Dictionary__c>();
    }

    private static Catalogue loadCatalogue() {
        Catalogue cat = new Catalogue();
        for (Marketing_Dictionary__c rec : [
            SELECT Id, Name, Dictionary_Sub_Type__c, RecordType.DeveloperName
            FROM Marketing_Dictionary__c
            WHERE (
                RecordType.DeveloperName = 'Product'
                AND Dictionary_Sub_Type__c IN ('Product Family', 'Family of Needs')
            ) OR (
                RecordType.DeveloperName = 'Campaign'
                AND Dictionary_Sub_Type__c = 'Topic'
            )
            LIMIT 2000
        ]) {
            if (rec.Dictionary_Sub_Type__c == 'Product Family') {
                cat.pfById.put(rec.Id, rec);
                cat.pfByName.put(rec.Name, rec);
            } else if (rec.Dictionary_Sub_Type__c == 'Family of Needs') {
                cat.fonById.put(rec.Id, rec);
                cat.fonByName.put(rec.Name, rec);
            } else if (rec.Dictionary_Sub_Type__c == 'Topic') {
                cat.topicById.put(rec.Id, rec);
            }
        }
        return cat;
    }
}
