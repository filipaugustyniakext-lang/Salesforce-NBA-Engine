public class BannerDataGraphTransformer {

    // ==========================================
    // 1. TARGET CONTRACT WRAPPER CLASSES
    // ==========================================
    public class TargetPayload {
        public String externalCustomerId;
        public String externalRelationId;
        public String externalAppId;
        public Map<String, PlaceholderGroup> placeholders;

        public TargetPayload() {
            this.externalCustomerId = '';
            this.externalRelationId = ''; 
            this.externalAppId = '';
            this.placeholders = new Map<String, PlaceholderGroup>{
                'PH_HOME_MAIN'  => new PlaceholderGroup(),
                'PH_HOME_VAS'   => new PlaceholderGroup(),
                'PH_HOME_PHOTO' => new PlaceholderGroup()
            };
        }
    }

    public class PlaceholderGroup {
        public GroupProperties properties = new GroupProperties();
        public List<ContentWrapper> content = new List<ContentWrapper>();
    }

    public class GroupProperties {
        public Boolean show = true;
        public Integer itemLimit = 5;
    }

    public class ContentWrapper {
        public Map<String, Object> contentData;
        public Map<String, Object> campaignData;

        public ContentWrapper(String category) {
            this.contentData = BannerDataGraphTransformer.getInitialContentDataSchema(category);
            this.campaignData = BannerDataGraphTransformer.getInitialCampaignDataSchema();
        }
    }

    // ==========================================
    // 2. MAIN TRANSFORMATION LOGIC
    // ==========================================
    public static String transformDataGraphList(List<String> sourceJsonList) {
        if (sourceJsonList == null || sourceJsonList.isEmpty()) return '{}';

        TargetPayload target = new TargetPayload();
        Set<String> processedCompositeIds = new Set<String>();

        for (String sourceJson : sourceJsonList) {
            if (String.isBlank(sourceJson)) continue;

            Map<String, Object> source = (Map<String, Object>) JSON.deserializeUntyped(sourceJson);

            // Odpakuj json_blob__c jeśli zagnieżdżony
            Object blobVal = getValueCaseInsensitive(source, 'json_blob__c');
            if (blobVal != null && blobVal instanceof String) {
                source = (Map<String, Object>) JSON.deserializeUntyped((String) blobVal);
            }

            // Nagłówki
            if (String.isBlank(target.externalCustomerId)) {
                Object custId = getValueCaseInsensitive(source, 'externalCustomerID__c');
                if (custId != null) target.externalCustomerId = String.valueOf(custId);
            }
            
            if (String.isBlank(target.externalRelationId)) {
                Object relId = getValueCaseInsensitive(source, 'externalRelationID__c');
                if (relId != null) target.externalRelationId = String.valueOf(relId);
            }
            
            if (String.isBlank(target.externalAppId)) {
                Object appId = getValueCaseInsensitive(source, 'externalAppId__c');
                if (appId != null) target.externalAppId = String.valueOf(appId);
            }

            // Przetwarzanie bannerów - relacja BannerPlaceholder__dlm
            Object rawDLMObj = getValueCaseInsensitive(source, 'BannerPlaceholder__dlm');

            if (rawDLMObj != null && rawDLMObj instanceof List<Object>) {
                List<Object> rawDLMList = (List<Object>) rawDLMObj;

                for (Object rawItem : rawDLMList) {
                    Map<String, Object> item = (Map<String, Object>) rawItem;

                    String compositeId = (String) getValueCaseInsensitive(item, 'CompositeUniqueID__c');
                    
                    Object variantIdObj = getValueCaseInsensitive(item, 'MessageVariantId__c');
                    if (variantIdObj == null) {
                        variantIdObj = getValueCaseInsensitive(item, 'KQ_MessageVariantId__c');
                    }
                    String dlmMessageVersionId = variantIdObj != null ? String.valueOf(variantIdObj) : '';

                    // Deduplikacja po CompositeUniqueID__c
                    if (String.isNotBlank(compositeId) && processedCompositeIds.contains(compositeId)) {
                        continue;
                    }
                    if (String.isNotBlank(compositeId)) {
                        processedCompositeIds.add(compositeId);
                    }

                    // Ekstrakcja z pola contentData__c
                    Map<String, Object> rawContentMap = extractContentMap(item);

                    String targetKey = determineCategory(rawContentMap, compositeId);

                    ContentWrapper contentWrapper = new ContentWrapper(targetKey);
                    populateContentData(contentWrapper.contentData, rawContentMap, targetKey);
                    populateCampaignData(contentWrapper.campaignData, rawContentMap, dlmMessageVersionId);

                    if (target.placeholders.containsKey(targetKey)) {
                        target.placeholders.get(targetKey).content.add(contentWrapper);
                    }
                }
            }
        }

        return JSON.serialize(target);
    }

    public static String transformDataGraph(String sourceJson) {
        return transformDataGraphList(new List<String>{ sourceJson });
    }

    // ==========================================
    // 3. PARSING & AUTO-REPAIR HELPERS
    // ==========================================
    private static Map<String, Object> extractContentMap(Map<String, Object> item) {
        Map<String, Object> rawContentMap = new Map<String, Object>();
        if (item == null) return rawContentMap;

        Object rawContentObj = getValueCaseInsensitive(item, 'contentData__c');

        if (rawContentObj instanceof Map<String, Object>) {
            rawContentMap = (Map<String, Object>) rawContentObj;
        } else if (rawContentObj instanceof String) {
            String rawStr = (String) rawContentObj;
            if (String.isNotBlank(rawStr)) {
                try {
                    Object parsed = JSON.deserializeUntyped(rawStr);
                    if (parsed instanceof Map<String, Object>) {
                        return (Map<String, Object>) parsed;
                    }
                } catch (Exception e) {}

                List<String> fixSuffixes = new List<String>{ '"}', '}', '"]}', '"}' };
                for (String suffix : fixSuffixes) {
                    try {
                        Object parsed = JSON.deserializeUntyped(rawStr + suffix);
                        if (parsed instanceof Map<String, Object>) {
                            return (Map<String, Object>) parsed;
                        }
                    } catch (Exception e) {}
                }

                rawContentMap = parseMalformedJsonViaRegex(rawStr);
            }
        }

        if (rawContentMap.isEmpty()) {
            rawContentMap = item;
        }

        return rawContentMap;
    }

    private static Map<String, Object> parseMalformedJsonViaRegex(String rawStr) {
        Map<String, Object> resultMap = new Map<String, Object>();
        if (String.isBlank(rawStr)) return resultMap;

        Pattern keyValPattern = Pattern.compile('"([^"]+)":\\s*(?:"([^"]*)"|(true|false|null|\\d+(?:\\.\\d+)?))');
        Matcher matcher = keyValPattern.matcher(rawStr);

        while (matcher.find()) {
            String key = matcher.group(1);
            String strVal = matcher.group(2);
            String boolOrNumVal = matcher.group(3);

            if (strVal != null) {
                resultMap.put(key, strVal);
            } else if (boolOrNumVal != null) {
                if (boolOrNumVal == 'true') resultMap.put(key, true);
                else if (boolOrNumVal == 'false') resultMap.put(key, false);
                else if (boolOrNumVal != 'null') resultMap.put(key, boolOrNumVal);
            }
        }
        return resultMap;
    }

    private static Object getValueCaseInsensitive(Map<String, Object> sourceMap, String targetKey) {
        if (sourceMap == null || String.isBlank(targetKey)) return null;
        if (sourceMap.containsKey(targetKey)) {
            return sourceMap.get(targetKey);
        }
        for (String key : sourceMap.keySet()) {
            if (key.equalsIgnoreCase(targetKey)) {
                return sourceMap.get(key);
            }
        }
        return null;
    }

    // ==========================================
    // 4. SCHEMA INITIALIZERS
    // ==========================================
    public static Map<String, Object> getInitialCampaignDataSchema() {
        return new Map<String, Object>{
            'entryCampaignName' => '',
            'entryCampaignId'   => '',
            'offerName'         => '',
            'offerId'           => '',
            'entryScore'        => '',
            'messageVersionId'  => '',
            'timestamp'         => ''
        };
    }

    public static Map<String, Object> getInitialContentDataSchema(String category) {
        Map<String, Object> schema = new Map<String, Object>();
        if (category == 'PH_HOME_MAIN') {
            schema.put('title', '');
            schema.put('description', '');
            schema.put('imageURLLight', '');
            schema.put('imageURLDark', '');
            schema.put('legalLabel', '');
            schema.put('legalNote', '');
            schema.put('CTAPrimaryLabel', '');
            schema.put('CTAPrimaryURL', '');
            schema.put('CTAPrimaryIntent', '');
            schema.put('CTASecondaryLabel', '');
            schema.put('CTASecondaryURL', '');
            schema.put('CTASecondaryIntent', '');
            schema.put('showClose', true);
        } else if (category == 'PH_HOME_VAS') {
            schema.put('title_Expanded', '');
            schema.put('title_HalfLong', '');
            schema.put('title_HalfShort', '');
            schema.put('backgroundImageURL', '');
            schema.put('backgroundPositionX_Expanded', '');
            schema.put('backgroundPositionX_HalfLong', '');
            schema.put('backgroundPositionX_HalfShort', '');
            schema.put('backgroundPositionY_Expanded', '');
            schema.put('backgroundPositionY_HalfLong', '');
            schema.put('backgroundPositionY_HalfShort', '');
            schema.put('logoImage', '');
            schema.put('focusBorderColor', '');
            schema.put('CTAURL', '');
            schema.put('CTAIntent', '');
            schema.put('showClose', true);
        } else if (category == 'PH_HOME_PHOTO') {
            schema.put('title', '');
            schema.put('description', '');
            schema.put('backgroundImageURL', '');
            schema.put('legalLabel', '');
            schema.put('legalNote', '');
            schema.put('CTAPrimaryLabel', '');
            schema.put('CTAPrimaryURL', '');
            schema.put('CTAPrimaryIntent', '');
            schema.put('CTASecondaryLabel', '');
            schema.put('CTASecondaryURL', '');
            schema.put('CTASecondaryIntent', '');
            schema.put('showClose', true);
        }
        return schema;
    }

    // ==========================================
    // 5. MAPPING HELPERS
    // ==========================================
    private static String determineCategory(Map<String, Object> rawContentMap, String compositeId) {
        Object bannerTypeObj = getValueCaseInsensitive(rawContentMap, 'bannerType');
        if (bannerTypeObj != null) {
            String bannerType = String.valueOf(bannerTypeObj);
            if (bannerType == 'mainBanner' || bannerType == 'PH_HOME_MAIN') return 'PH_HOME_MAIN';
            if (bannerType == 'vasBanner'  || bannerType == 'PH_HOME_VAS')  return 'PH_HOME_VAS';
            if (bannerType == 'photoBanner'|| bannerType == 'PH_HOME_PHOTO') return 'PH_HOME_PHOTO';
            if (String.isNotBlank(bannerType)) return bannerType;
        }
        if (String.isNotBlank(compositeId)) {
            if (compositeId.contains('VAS'))   return 'PH_HOME_VAS';
            if (compositeId.contains('PHOTO')) return 'PH_HOME_PHOTO';
        }
        return 'PH_HOME_MAIN';
    }

    private static void populateContentData(Map<String, Object> schema, Map<String, Object> source, String category) {
        if (source == null || source.isEmpty()) return;

        for (String schemaKey : schema.keySet()) {
            Object val = getValueCaseInsensitive(source, schemaKey);
            if (val != null) {
                schema.put(schemaKey, val);
            }
        }

        Object titleVal = getValueCaseInsensitive(source, 'title');
        if (titleVal != null) {
            if (schema.containsKey('title_Expanded') && String.isBlank(String.valueOf(schema.get('title_Expanded')))) {
                schema.put('title_Expanded', titleVal);
            }
        }

        Object legalNoteVal = getValueCaseInsensitive(source, 'legal_note');
        if (legalNoteVal != null && schema.containsKey('legalNote') && String.isBlank(String.valueOf(schema.get('legalNote')))) {
            schema.put('legalNote', legalNoteVal);
        }

        Object legalLabelVal = getValueCaseInsensitive(source, 'tertiaryLabel');
        if (legalLabelVal != null && schema.containsKey('legalLabel') && String.isBlank(String.valueOf(schema.get('legalLabel')))) {
            schema.put('legalLabel', legalLabelVal);
        }

        Object imgUrlVal = getValueCaseInsensitive(source, 'imageUrl');
        if (imgUrlVal != null) {
            if (schema.containsKey('imageURLLight') && String.isBlank(String.valueOf(schema.get('imageURLLight')))) {
                schema.put('imageURLLight', imgUrlVal);
            }
            if (schema.containsKey('backgroundImageURL') && String.isBlank(String.valueOf(schema.get('backgroundImageURL')))) {
                schema.put('backgroundImageURL', imgUrlVal);
            }
        }

        Object pLabel = getValueCaseInsensitive(source, 'primaryLabel');
        if (pLabel != null && schema.containsKey('CTAPrimaryLabel') && String.isBlank(String.valueOf(schema.get('CTAPrimaryLabel')))) {
            schema.put('CTAPrimaryLabel', pLabel);
        }

        Object pUrl = getValueCaseInsensitive(source, 'primaryUrl');
        if (pUrl != null) {
            if (schema.containsKey('CTAPrimaryURL') && String.isBlank(String.valueOf(schema.get('CTAPrimaryURL')))) schema.put('CTAPrimaryURL', pUrl);
            if (schema.containsKey('CTAURL') && String.isBlank(String.valueOf(schema.get('CTAURL')))) schema.put('CTAURL', pUrl);
        }

        Object pIntent = getValueCaseInsensitive(source, 'primaryIntent');
        if (pIntent != null) {
            if (schema.containsKey('CTAPrimaryIntent') && String.isBlank(String.valueOf(schema.get('CTAPrimaryIntent')))) schema.put('CTAPrimaryIntent', pIntent);
            if (schema.containsKey('CTAIntent') && String.isBlank(String.valueOf(schema.get('CTAIntent')))) schema.put('CTAIntent', pIntent);
        }

        Object sLabel = getValueCaseInsensitive(source, 'secondaryLabel');
        if (sLabel != null && schema.containsKey('CTASecondaryLabel') && String.isBlank(String.valueOf(schema.get('CTASecondaryLabel')))) {
            schema.put('CTASecondaryLabel', sLabel);
        }

        Object sUrl = getValueCaseInsensitive(source, 'secondaryUrl');
        if (sUrl != null && schema.containsKey('CTASecondaryURL') && String.isBlank(String.valueOf(schema.get('CTASecondaryURL')))) {
            schema.put('CTASecondaryURL', sUrl);
        }

        Object sIntent = getValueCaseInsensitive(source, 'secondaryIntent');
        if (sIntent != null && schema.containsKey('CTASecondaryIntent') && String.isBlank(String.valueOf(schema.get('CTASecondaryIntent')))) {
            schema.put('CTASecondaryIntent', sIntent);
        }

        Object showCloseVal = getValueCaseInsensitive(source, 'showClose');
        if (showCloseVal != null && schema.containsKey('showClose')) {
            schema.put('showClose', Boolean.valueOf(showCloseVal));
        }
    }

    private static void populateCampaignData(Map<String, Object> schema, Map<String, Object> source, String dlmMessageVersionId) {
        if (source != null) {
            Object innerCampaignObj = getValueCaseInsensitive(source, 'campaignData');
            if (innerCampaignObj != null && innerCampaignObj instanceof Map<String, Object>) {
                Map<String, Object> innerCampaign = (Map<String, Object>) innerCampaignObj;
                for (String key : innerCampaign.keySet()) {
                    if (schema.containsKey(key)) {
                        schema.put(key, getValueOrDefault(innerCampaign.get(key), ''));
                    }
                }
            }
        }
        if (String.isBlank((String) schema.get('messageVersionId'))) {
            schema.put('messageVersionId', getValueOrDefault(dlmMessageVersionId, ''));
        }
    }

    private static Object getValueOrDefault(Object val, Object defaultVal) {
        return val != null ? val : defaultVal;
    }
}