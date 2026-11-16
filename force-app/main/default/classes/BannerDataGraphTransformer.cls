public class BannerDataGraphTransformer {

    // =========================================================================
    // 1. KLASY WRAPPERÓW DANYCH WYJŚCIOWYCH (KONTRAKT API DLA FRONTENDU/APLIKACJI)
    // =========================================================================

    /**
     * Główny kontener docelowego JSON-a.
     * Zawiera identyfikatory kontekstu klienta oraz mapę placeholderów ekranowych.
     */
    public class TargetPayload {
        public String externalCustomerId;
        public String externalRelationId;
        public String externalAppId;
        public Map<String, PlaceholderGroup> placeholders;

        public TargetPayload() {
            this.externalCustomerId = '';
            this.externalRelationId = '';
            this.externalAppId = '';
            
            // Inicjalizacja domyślnych, znanych grup placeholderów.
            // Jeśli w danych wejściowych pojawi się inny placeholder (np. PH_MORE_BOTTOM_PHOTO),
            // kod utworzy go dynamicznie w trakcie działania.
            this.placeholders = new Map<String, PlaceholderGroup>{
                'PH_HOME_MAIN'  => new PlaceholderGroup(),
                'PH_HOME_VAS'   => new PlaceholderGroup(),
                'PH_HOME_PHOTO' => new PlaceholderGroup()
            };
        }
    }

    /**
     * Grupa reprezentująca konkretne miejsce na ekranie (np. karuzela na stronie głównej).
     * Składa się z metadanych wyświetlania (properties) oraz listy przypisanych banerów (content).
     */
    public class PlaceholderGroup {
        public GroupProperties properties = new GroupProperties();
        public List<ContentWrapper> content = new List<ContentWrapper>();
    }

    /**
     * Właściwości konfiguracji sekcji placeholder.
     * itemLimit definiuje twardy limit liczby banerów w danej sekcji.
     */
    public class GroupProperties {
        public Boolean show = true;
        public Integer itemLimit = 5;
    }

    /**
     * Wrapper pojedynczego elementu baneru.
     * Rozdziela warstwę wizualno-treściową (contentData) od parametrów analitycznych (campaignData).
     */
    public class ContentWrapper {
        public Map<String, Object> contentData;
        public Map<String, Object> campaignData;

        public ContentWrapper(String bannerType) {
            // Szablon (boilerplate) zależy wyłącznie od typu baneru, a nie od miejsca na ekranie
            this.contentData = BannerDataGraphTransformer.getInitialContentDataSchema(bannerType);
            this.campaignData = BannerDataGraphTransformer.getInitialCampaignDataSchema();
        }
    }

    // =========================================================================
    // 2. GŁÓWNA LOGIKA TRANSFORMACJI DANYCH Z DATA CLOUD
    // =========================================================================

    /**
     * Przetwarza listę wierszy pobranych z Data Cloud Data Graph i mapuje je na finalny JSON.
     * Obsługuje deduplikację, dynamiczne tworzenie sekcji oraz twarde obcinanie do 5 banerów.
     */
    public static String transformDataGraphList(List<String> sourceJsonList) {
        if (sourceJsonList == null || sourceJsonList.isEmpty()) {
            return '{}';
        }

        TargetPayload target = new TargetPayload();
        Set<String> processedCompositeIds = new Set<String>();

        for (String sourceJson : sourceJsonList) {
            if (String.isBlank(sourceJson)) continue;

            Map<String, Object> source = (Map<String, Object>) JSON.deserializeUntyped(sourceJson);

            // KROK A: Obsługa zagnieżdżonego stringa JSON (częsty przypadek pól BLOB w Data Cloud)
            Object blobVal = getValueCaseInsensitive(source, 'json_blob__c');
            if (blobVal != null && blobVal instanceof String) {
                source = (Map<String, Object>) JSON.deserializeUntyped((String) blobVal);
            }

            // KROK B: Pobranie głównych identyfikatorów klienta z nagłówka rekordu
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

            // KROK C: Pobranie relacji potomnej z rekordami banerów (BannerPlaceholder__dlm)
            Object rawDLMObj = getValueCaseInsensitive(source, 'BannerPlaceholder__dlm');

            if (rawDLMObj != null && rawDLMObj instanceof List<Object>) {
                List<Object> rawDLMList = (List<Object>) rawDLMObj;

                for (Object rawItem : rawDLMList) {
                    Map<String, Object> item = (Map<String, Object>) rawItem;

                    // Deduplikacja: pomijaj powtarzające się banery o tym samym unikalnym ID
                    String compositeId = (String) getValueCaseInsensitive(item, 'CompositeUniqueID__c');
                    if (String.isNotBlank(compositeId) && processedCompositeIds.contains(compositeId)) {
                        continue;
                    }
                    if (String.isNotBlank(compositeId)) {
                        processedCompositeIds.add(compositeId);
                    }

                    // Pobranie ID wariantu wiadomości (sprawdza dwa warianty nazwy pola)
                    Object variantIdObj = getValueCaseInsensitive(item, 'MessageVariantId__c');
                    if (variantIdObj == null) {
                        variantIdObj = getValueCaseInsensitive(item, 'KQ_MessageVariantId__c');
                    }
                    String dlmMessageVersionId = variantIdObj != null ? String.valueOf(variantIdObj) : '';

                    // Ekstrakcja surowego obiektu treści baneru z pola contentData__c
                    Map<String, Object> rawContentMap = extractContentMap(item);

                    // 1. Określenie typu baneru (decyduje o schemacie/strukturze pól JSON)
                    String bannerType = 'mainBanner'; 
                    Object bannerTypeObj = getValueCaseInsensitive(rawContentMap, 'bannerType');
                    if (bannerTypeObj != null && String.isNotBlank(String.valueOf(bannerTypeObj))) {
                        bannerType = String.valueOf(bannerTypeObj);
                    }

                    // Budowa wrappera i uzupełnienie pól na podstawie wybranego szablonu
                    ContentWrapper contentWrapper = new ContentWrapper(bannerType);
                    populateContentData(contentWrapper.contentData, rawContentMap, bannerType);
                    populateCampaignData(contentWrapper.campaignData, rawContentMap, dlmMessageVersionId);

                    // 2. Odczyt listy miejsc docelowych (placeholderów)
                    List<String> placeholderIds = extractPlaceholderIds(rawContentMap);

                    // 3. Routing baneru do wskazanych placeholderów z wymuszeniem limitu
                    for (String pId : placeholderIds) {
                        // Tworzenie nowej sekcji, jeśli trafił się placeholder spoza listy domyślnej
                        if (!target.placeholders.containsKey(pId)) {
                            target.placeholders.put(pId, new PlaceholderGroup());
                        }
                        
                        PlaceholderGroup groupObj = target.placeholders.get(pId);
                        
                        // TWARDY LIMIT: Dodaj baner tylko, jeśli sekcja nie przekroczyła itemLimit (5)
                        if (groupObj.content.size() < groupObj.properties.itemLimit) {
                            groupObj.content.add(contentWrapper);
                        }
                    }
                }
            }
        }

        return JSON.serialize(target);
    }

    /**
     * Wersja metody przyjmująca pojedynczy ciąg JSON zamiast listy.
     */
    public static String transformDataGraph(String sourceJson) {
        return transformDataGraphList(new List<String>{ sourceJson });
    }

    // =========================================================================
    // 3. METODY POMOCNICZE PARSOWANIA I ODPORNOŚCI NA BŁĘDY DANYCH
    // =========================================================================

    /**
     * Wyciąga dane z pola contentData__c.
     * Obsługuje przypadki, gdy wartość jest obiektem Map, poprawnym ciągiem JSON
     * lub uciętym/uszkodzonym stringiem (np. ucięty przez limity długości pól).
     */
    private static Map<String, Object> extractContentMap(Map<String, Object> item) {
        Map<String, Object> rawContentMap = new Map<String, Object>();
        if (item == null) return rawContentMap;

        Object rawContentObj = getValueCaseInsensitive(item, 'contentData__c');

        // Wariant 1: ConnectApi zwróciło już zdeserializowaną mapę
        if (rawContentObj instanceof Map<String, Object>) {
            rawContentMap = (Map<String, Object>) rawContentObj;
        } 
        // Wariant 2: Pole zawiera surowy ciąg znaków JSON
        else if (rawContentObj instanceof String) {
            String rawStr = (String) rawContentObj;
            if (String.isNotBlank(rawStr)) {
                // Próba standardowego parsowania
                try {
                    Object parsed = JSON.deserializeUntyped(rawStr);
                    if (parsed instanceof Map<String, Object>) {
                        return (Map<String, Object>) parsed;
                    }
                } catch (Exception e) {}

                // Autonaprawa: próba domknięcia uciętych klamer i cudzysłowów
                List<String> fixSuffixes = new List<String>{ '"}', '}', '"]}', '"}' };
                for (String suffix : fixSuffixes) {
                    try {
                        Object parsed = JSON.deserializeUntyped(rawStr + suffix);
                        if (parsed instanceof Map<String, Object>) {
                            return (Map<String, Object>) parsed;
                        }
                    } catch (Exception e) {}
                }

                // Ostateczny fallback: ekstrakcja par klucz-wartość za pomocą wyrażeń regularnych
                rawContentMap = parseMalformedJsonViaRegex(rawStr);
            }
        }

        if (rawContentMap.isEmpty()) {
            rawContentMap = item;
        }

        return rawContentMap;
    }

    /**
     * Ekstraktor Regex na wypadek krytycznie uszkodzonego ciągu JSON.
     */
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

    /**
     * Wyszukuje wartość w mapie bez względu na wielkość liter w kluczu.
     */
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

    /**
     * Odczytuje listę identyfikatorów placeholderów.
     * Obsługuje zarówno tablicę obiektów ["ID1", "ID2"], jak i string w formacie '["ID1","ID2"]' lub 'ID1, ID2'.
     */
    private static List<String> extractPlaceholderIds(Map<String, Object> rawContentMap) {
        List<String> pIds = new List<String>();
        Object placeholdersObj = getValueCaseInsensitive(rawContentMap, 'placeholderIds');
        
        if (placeholdersObj instanceof List<Object>) {
            for (Object pObj : (List<Object>) placeholdersObj) {
                if (pObj != null && String.isNotBlank(String.valueOf(pObj))) {
                    pIds.add(String.valueOf(pObj).trim());
                }
            }
        } else if (placeholdersObj instanceof String) {
            String strVal = (String) placeholdersObj;
            // Czyszczenie ze znaków formatowania JSON w stringu
            strVal = strVal.replace('[', '').replace(']', '').replace('"', '');
            
            if (strVal.contains(',')) {
                for (String s : strVal.split(',')) {
                    if (String.isNotBlank(s)) pIds.add(s.trim());
                }
            } else if (String.isNotBlank(strVal)) {
                pIds.add(strVal.trim());
            }
        }
        
        // Zabezpieczenie: jeśli pole było puste, baner trafia do domyślnego placeholdera
        if (pIds.isEmpty()) {
            pIds.add('PH_HOME_MAIN'); 
        }
        
        return pIds;
    }

    // =========================================================================
    // 4. INICJALIZATORY SCHEMATÓW DANYCH (SZABLONY / BOILERPLATES)
    // =========================================================================

    /**
     * Zwraca domyślny schemat pól analitycznych kampanii.
     */
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

    /**
     * Zwraca docelowy schemat JSON-a na podstawie typu baneru (bannerType).
     * Określa, jakie dokładnie klucze znajdą się w obiekcie contentData.
     */
    public static Map<String, Object> getInitialContentDataSchema(String bannerType) {
        Map<String, Object> schema = new Map<String, Object>();
        
        if (bannerType == 'mainBanner') {
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
        } else if (bannerType == 'vasBanner') {
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
        } else if (bannerType == 'photoBanner') {
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
        } else if (bannerType == 'smallBanner') {
            // Skrócony szablon dla banerów kompaktowych
            schema.put('description', '');
            schema.put('imageURLLight', '');
            schema.put('imageURLDark', '');
            schema.put('CTAPrimaryURL', '');
            schema.put('CTAPrimaryIntent', '');
        }
        
        return schema;
    }

    // =========================================================================
    // 5. REGULARNE MAPOWANIE PÓL I OBSŁUGA ALIASÓW
    // =========================================================================

    /**
     * Przepisuje surowe wartości z Data Cloud do zadeklarowanego schematu.
     * Wykonuje najpierw dopasowanie 1:1, a następnie obsługuje specyficzne aliasy pól.
     */
    private static void populateContentData(Map<String, Object> schema, Map<String, Object> source, String bannerType) {
        if (source == null || source.isEmpty()) return;

        // KROK 1: Bezpośrednie dopasowanie nazw kluczy (1:1)
        for (String schemaKey : schema.keySet()) {
            Object val = getValueCaseInsensitive(source, schemaKey);
            if (val != null) {
                schema.put(schemaKey, val);
            }
        }

        // KROK 2: Mapowanie aliasów dla specyficznych nazw pól

        // Tytuły w formacie rozszerzonym (VAS)
        Object titleVal = getValueCaseInsensitive(source, 'title');
        if (titleVal != null) {
            if (schema.containsKey('title_Expanded') && String.isBlank(String.valueOf(schema.get('title_Expanded')))) {
                schema.put('title_Expanded', titleVal);
            }
        }

        // Noty i etykiety prawne
        Object legalNoteVal = getValueCaseInsensitive(source, 'legal_note');
        if (legalNoteVal != null && schema.containsKey('legalNote') && String.isBlank(String.valueOf(schema.get('legalNote')))) {
            schema.put('legalNote', legalNoteVal);
        }

        Object legalLabelVal = getValueCaseInsensitive(source, 'tertiaryLabel');
        if (legalLabelVal != null && schema.containsKey('legalLabel') && String.isBlank(String.valueOf(schema.get('legalLabel')))) {
            schema.put('legalLabel', legalLabelVal);
        }

        // Adresy grafik: przekierowanie imageUrl do imageURLLight lub backgroundImageURL
        Object imgUrlVal = getValueCaseInsensitive(source, 'imageUrl');
        if (imgUrlVal != null) {
            if (schema.containsKey('imageURLLight') && String.isBlank(String.valueOf(schema.get('imageURLLight')))) {
                schema.put('imageURLLight', imgUrlVal);
            }
            if (schema.containsKey('backgroundImageURL') && String.isBlank(String.valueOf(schema.get('backgroundImageURL')))) {
                schema.put('backgroundImageURL', imgUrlVal);
            }
        }

        // Przyciski akcji głównej (Primary CTA)
        Object pLabel = getValueCaseInsensitive(source, 'primaryLabel');
        if (pLabel != null && schema.containsKey('CTAPrimaryLabel') && String.isBlank(String.valueOf(schema.get('CTAPrimaryLabel')))) {
            schema.put('CTAPrimaryLabel', pLabel);
        }

        Object pUrl = getValueCaseInsensitive(source, 'primaryUrl');
        if (pUrl != null) {
            if (schema.containsKey('CTAPrimaryURL') && String.isBlank(String.valueOf(schema.get('CTAPrimaryURL')))) {
                schema.put('CTAPrimaryURL', pUrl);
            }
            if (schema.containsKey('CTAURL') && String.isBlank(String.valueOf(schema.get('CTAURL')))) {
                schema.put('CTAURL', pUrl);
            }
        }

        Object pIntent = getValueCaseInsensitive(source, 'primaryIntent');
        if (pIntent != null) {
            if (schema.containsKey('CTAPrimaryIntent') && String.isBlank(String.valueOf(schema.get('CTAPrimaryIntent')))) {
                schema.put('CTAPrimaryIntent', pIntent);
            }
            if (schema.containsKey('CTAIntent') && String.isBlank(String.valueOf(schema.get('CTAIntent')))) {
                schema.put('CTAIntent', pIntent);
            }
        }

        // Przyciski akcji pobocznej (Secondary CTA)
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

        // Flaga zamykania baneru
        Object showCloseVal = getValueCaseInsensitive(source, 'showClose');
        if (showCloseVal != null && schema.containsKey('showClose')) {
            schema.put('showClose', Boolean.valueOf(showCloseVal));
        }
    }

    /**
     * Mapuje parametry analityczne kampanii.
     */
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
        
        // Zapewnienie fallbacku dla messageVersionId z poziomu relacji DLM
        if (String.isBlank((String) schema.get('messageVersionId'))) {
            schema.put('messageVersionId', getValueOrDefault(dlmMessageVersionId, ''));
        }
    }

    private static Object getValueOrDefault(Object val, Object defaultVal) {
        return val != null ? val : defaultVal;
    }
}