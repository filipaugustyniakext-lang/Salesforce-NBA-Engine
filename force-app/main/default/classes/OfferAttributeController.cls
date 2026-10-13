/**
 * Read-only feed of Offer attribute definitions for the offer wizard's
 * Properties step. Pulls live from the Marketing Dictionary:
 *   Marketing_Dictionary__c (Offer RT)  → attribute definition
 *   Offer_Attribute_Rule__c              → per-Product-Family behaviour (required/visible/order)
 *   Offer_Reference_Value__c             → benchmark value autopopulated at runtime
 *
 * Kept separate from OfferController so the wizard's data feed can be
 * deployed without touching classes referenced by scheduled jobs.
 */
public with sharing class OfferAttributeController {

    public class AttributeView {
        @AuraEnabled public Id ruleId;
        @AuraEnabled public Id attributeId;
        @AuraEnabled public String label;              // MD attribute Name (e.g. "Maximum Term (months)")
        @AuraEnabled public String fieldApiName;       // Parameter_API_Name__c (Offer_Version__c field)
        @AuraEnabled public String type;               // Parameter_Type__c: Number/Text/Date/Checkbox/Currency/Percent/Picklist
        @AuraEnabled public String helpText;
        @AuraEnabled public Boolean isRequired;
        @AuraEnabled public Boolean isVisible;
        @AuraEnabled public Decimal displayOrder;
        @AuraEnabled public String referenceValue;     // live benchmark, formatted per Value_Type__c (null if unlinked)
        @AuraEnabled public String referenceValueType; // Offer_Reference_Value__c.Value_Type__c
        // RANGE: when referenceValueType == 'Range', the reference is a linked Min/Max pair.
        // The offer wizard hard-clamps its dual slider to [referenceValueMin, referenceValueMax].
        @AuraEnabled public Decimal referenceValueMin;
        @AuraEnabled public Decimal referenceValueMax;
        @AuraEnabled public List<String> picklistOptions = new List<String>();
        @AuraEnabled public Boolean isMapped = false;  // Parameter_API_Name__c resolves to a writable Offer_Version__c field
        // MERGE 2026-09-14: added so the wizard can render per-param read-only state, description
        // text, and seed Autopopulate/Apriori values (parity with OfferController's feed).
        // To revert: remove these three fields and their assignments below.
        @AuraEnabled public String valueSource;        // Value_Source__c: Operator Defined / Autopopulate / Apriori
        @AuraEnabled public String description;         // Attribute_Description__c
        @AuraEnabled public String defaultValue;        // Default_Value__c (used to seed Apriori attributes)
    }

    /**
     * Returns the visible Offer attributes for a Product Family, ordered for display.
     * @param familyName Product Family name as stored on the Product Family dictionary record
     *                   (e.g. "Cash Loan"). This is the rule's Product_Family__r.Name.
     */
    @AuraEnabled(cacheable=true)
    public static List<AttributeView> getOfferAttributesForFamily(String familyName) {
        if (String.isBlank(familyName)) return new List<AttributeView>();

        // Sort by rule display order (then label) using a zero-padded key map.
        Map<String, AttributeView> ordered = new Map<String, AttributeView>();

        // PICKLIST-FIX 2026-09-10: Picklist_Values__c is intentionally NOT selected here.
        // This query is WITH SECURITY_ENFORCED, and Picklist_Values__c is a new admin-only
        // config field that most offer-creator users lack FLS read on. Including it made the
        // whole query throw ("secure query included inaccessible field"), which blanked the
        // wizard for everyone. The option values are fetched separately below without FLS
        // enforcement, since they are system-owned UI config, not user-visible record data.
        // To revert this feature entirely: delete this class's PICKLIST-FIX blocks and the field.
        List<Marketing_Dictionary__c> attrs = [
            SELECT Id, Name, Parameter_API_Name__c, Parameter_Type__c,
                   Parameter_Help_Text__c, Display_Order__c,
                (SELECT Id, Is_Required__c, Is_Visible__c, Display_Order__c,
                        Reference_Value__c, Reference_Value__r.Reference_Value__c,
                        Reference_Value__r.Value_Type__c
                 FROM Offer_Attribute_Rules__r
                 WHERE Product_Family__r.Name = :familyName
                 LIMIT 1)
            FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Offer'
            WITH SECURITY_ENFORCED
            ORDER BY Display_Order__c ASC NULLS LAST, Name ASC
        ];

        // Describe map for the target object once, to resolve picklist options.
        Map<String, Schema.SObjectField> versionFields =
            Schema.SObjectType.Offer_Version__c.fields.getMap();

        // PICKLIST-FIX 2026-09-10: fetch admin-defined picklist option text in a SEPARATE query
        // that does NOT enforce FLS, keyed by attribute Id. This field is system-owned UI config,
        // so gating the whole wizard on every user's FLS to it (as WITH SECURITY_ENFORCED did)
        // was wrong. To revert: delete this map and the field.
        Map<Id, String> picklistValuesById = new Map<Id, String>();
        // MERGE 2026-09-14: fetch Value_Source__c/Attribute_Description__c/Default_Value__c in the
        // SAME non-FLS secondary query as Picklist_Values__c, so the wizard's read-only/description/
        // Apriori-seed features cannot blank the whole wizard for users lacking FLS on these config
        // fields. To revert: remove these fields here and the v.* assignments below.
        Map<Id, Marketing_Dictionary__c> configById = new Map<Id, Marketing_Dictionary__c>();
        // RANGE: a Range reference is two linked Offer_Reference_Value__c records sharing a
        // Range_Key__c; the rule's Reference_Value__c points to the Min record. Resolve both
        // bounds here in a SEPARATE non-FLS query — Range_Key__c/Range_Bound__c are new admin
        // config fields most offer-creator users lack FLS on, so folding them into the
        // WITH SECURITY_ENFORCED subquery above would blank the wizard (same reasoning as
        // PICKLIST-FIX). Keyed by the Min record Id (== rule.Reference_Value__c).
        Map<Id, Decimal> rangeMinByRefId = new Map<Id, Decimal>();
        Map<Id, Decimal> rangeMaxByRefId = new Map<Id, Decimal>();
        if (!attrs.isEmpty()) {
            Set<Id> attrIds = new Set<Id>();
            Set<Id> rangeRefIds = new Set<Id>();
            for (Marketing_Dictionary__c a : attrs) {
                attrIds.add(a.Id);
                if (a.Offer_Attribute_Rules__r != null && !a.Offer_Attribute_Rules__r.isEmpty()) {
                    Offer_Attribute_Rule__c r = a.Offer_Attribute_Rules__r[0];
                    if (r.Reference_Value__c != null && r.Reference_Value__r != null
                            && r.Reference_Value__r.Value_Type__c == 'Range') {
                        rangeRefIds.add(r.Reference_Value__c);
                    }
                }
            }
            for (Marketing_Dictionary__c pv : [
                SELECT Id, Picklist_Values__c, Value_Source__c, Attribute_Description__c, Default_Value__c
                FROM Marketing_Dictionary__c
                WHERE Id IN :attrIds
            ]) {
                picklistValuesById.put(pv.Id, pv.Picklist_Values__c);
                configById.put(pv.Id, pv);
            }
            if (!rangeRefIds.isEmpty()) {
                // Min records → their shared Range_Key__c.
                Map<Id, String> keyByMinId = new Map<Id, String>();
                Set<String> keys = new Set<String>();
                for (Offer_Reference_Value__c orv : [
                    SELECT Id, Range_Key__c
                    FROM Offer_Reference_Value__c
                    WHERE Id IN :rangeRefIds AND Range_Key__c != null
                ]) {
                    keyByMinId.put(orv.Id, orv.Range_Key__c);
                    keys.add(orv.Range_Key__c);
                }
                // All members of those keys → bound values.
                Map<String, Decimal> minByKey = new Map<String, Decimal>();
                Map<String, Decimal> maxByKey = new Map<String, Decimal>();
                if (!keys.isEmpty()) {
                    for (Offer_Reference_Value__c orv : [
                        SELECT Range_Key__c, Range_Bound__c, Reference_Value__c
                        FROM Offer_Reference_Value__c
                        WHERE Range_Key__c IN :keys
                    ]) {
                        if (orv.Range_Bound__c == 'Max') maxByKey.put(orv.Range_Key__c, orv.Reference_Value__c);
                        else minByKey.put(orv.Range_Key__c, orv.Reference_Value__c);
                    }
                }
                for (Id minId : keyByMinId.keySet()) {
                    String key = keyByMinId.get(minId);
                    rangeMinByRefId.put(minId, minByKey.get(key));
                    rangeMaxByRefId.put(minId, maxByKey.get(key));
                }
            }
        }

        for (Marketing_Dictionary__c attr : attrs) {
            if (attr.Offer_Attribute_Rules__r == null || attr.Offer_Attribute_Rules__r.isEmpty()) {
                continue; // no rule for this family → attribute not part of this family's offer form
            }
            Offer_Attribute_Rule__c rule = attr.Offer_Attribute_Rules__r[0];
            if (rule.Is_Visible__c == false) continue;

            AttributeView v = new AttributeView();
            v.ruleId = rule.Id;
            v.attributeId = attr.Id;
            v.label = attr.Name;
            v.fieldApiName = attr.Parameter_API_Name__c;
            v.type = attr.Parameter_Type__c;
            v.helpText = attr.Parameter_Help_Text__c;
            // MERGE 2026-09-14: expose value source / description / default from the non-FLS map.
            Marketing_Dictionary__c cfg = configById.get(attr.Id);
            if (cfg != null) {
                v.valueSource = cfg.Value_Source__c;
                v.description = cfg.Attribute_Description__c;
                v.defaultValue = cfg.Default_Value__c;
            }
            v.isRequired = rule.Is_Required__c == true;
            v.isVisible = true;
            v.displayOrder = rule.Display_Order__c != null ? rule.Display_Order__c : attr.Display_Order__c;

            if (rule.Reference_Value__c != null && rule.Reference_Value__r != null) {
                v.referenceValueType = rule.Reference_Value__r.Value_Type__c;
                if (v.referenceValueType == 'Range') {
                    // Bounds resolved via the non-FLS Range_Key__c pair lookup above.
                    v.referenceValueMin = rangeMinByRefId.get(rule.Reference_Value__c);
                    v.referenceValueMax = rangeMaxByRefId.get(rule.Reference_Value__c);
                    v.referenceValue = formatRange(v.referenceValueMin, v.referenceValueMax);
                } else {
                    v.referenceValue = formatReferenceValue(
                        rule.Reference_Value__r.Reference_Value__c,
                        rule.Reference_Value__r.Value_Type__c
                    );
                }
            }

            // An attribute is "mapped" when its Parameter_API_Name__c resolves to a
            // storable Offer_Version__c field, i.e. the value can be persisted through the
            // existing save path (populateVersionFields). This is a schema question, not an
            // FLS one — the save runs in Apex and does not enforce field-level security — so
            // calculated/formula fields are the only ones that can never hold a written value.
            // Unmapped attributes still render (the rule says so) but are reported to the user.
            if (String.isNotBlank(attr.Parameter_API_Name__c)) {
                Schema.SObjectField token = versionFields.get(attr.Parameter_API_Name__c.toLowerCase());
                v.isMapped = token != null && !token.getDescribe().isCalculated();
            }

            // PICKLIST-FIX 2026-09-10: source dropdown options from admin-defined
            // Picklist_Values__c first, falling back to the Offer_Version__c field describe.
            // Previously options came ONLY from the field describe, so admin-entered picklist
            // values never appeared in the wizard. To revert, restore the old single line:
            //   if (attr.Parameter_Type__c == 'Picklist' && String.isNotBlank(attr.Parameter_API_Name__c)) {
            //       v.picklistOptions = picklistValuesFor(versionFields, attr.Parameter_API_Name__c);
            //   }
            if (attr.Parameter_Type__c == 'Picklist') {
                List<String> adminOptions = parsePicklistValues(picklistValuesById.get(attr.Id));
                if (!adminOptions.isEmpty()) {
                    v.picklistOptions = adminOptions;
                } else if (String.isNotBlank(attr.Parameter_API_Name__c)) {
                    v.picklistOptions = picklistValuesFor(versionFields, attr.Parameter_API_Name__c);
                }
            }

            Decimal order = v.displayOrder != null ? v.displayOrder : 999999;
            String orderStr = String.valueOf(order.intValue());
            while (orderStr.length() < 7) orderStr = '0' + orderStr;
            ordered.put(orderStr + '_' + attr.Name, v);
        }

        List<String> keys = new List<String>(ordered.keySet());
        keys.sort();
        List<AttributeView> views = new List<AttributeView>();
        for (String k : keys) views.add(ordered.get(k));
        return views;
    }

    // PICKLIST-FIX 2026-09-10: helper for admin-defined picklist options. To revert: delete this method.
    private static List<String> parsePicklistValues(String raw) {
        List<String> options = new List<String>();
        if (String.isBlank(raw)) return options;
        for (String line : raw.split('\n')) {
            String trimmed = line.trim();
            if (String.isNotBlank(trimmed)) options.add(trimmed);
        }
        return options;
    }

    private static List<String> picklistValuesFor(Map<String, Schema.SObjectField> fieldMap, String apiName) {
        List<String> options = new List<String>();
        Schema.SObjectField token = fieldMap.get(apiName.toLowerCase());
        if (token == null) return options;
        Schema.DescribeFieldResult dfr = token.getDescribe();
        if (dfr.getType() != Schema.DisplayType.Picklist) return options;
        for (Schema.PicklistEntry e : dfr.getPicklistValues()) {
            if (e.isActive()) options.add(e.getValue());
        }
        return options;
    }

    // RANGE: "min – max" for display; either bound may be null if a member record is missing.
    private static String formatRange(Decimal lo, Decimal hi) {
        String loStr = lo != null ? lo.stripTrailingZeros().toPlainString() : '?';
        String hiStr = hi != null ? hi.stripTrailingZeros().toPlainString() : '?';
        return loStr + ' – ' + hiStr;
    }

    private static String formatReferenceValue(Decimal raw, String valueType) {
        if (raw == null) return null;
        switch on valueType {
            when 'Percent' { return raw.stripTrailingZeros().toPlainString() + '%'; }
            when 'Days'    { return raw.stripTrailingZeros().toPlainString() + ' days'; }
            when 'Months'  { return raw.stripTrailingZeros().toPlainString() + ' months'; }
            when else      { return raw.toPlainString(); }
        }
    }
}