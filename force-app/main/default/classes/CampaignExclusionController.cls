/**
 * Data Cloud exclusion catalogues for Campaign Wizard (segments, DMOs, DLOs).
 */
public with sharing class CampaignExclusionController {
    private static final Integer MAX_SEGMENTS = 1000;
    private static final Integer SEARCH_RESULT_LIMIT = 25;

    @AuraEnabled(cacheable=true)
    public static ExclusionOptions getExclusionOptions() {
        ExclusionOptions options = new ExclusionOptions();
        options.segments = loadActiveSegments(options);
        options.dmoHint =
            'Search by DMO label or API name (minimum 2 characters). The full Data Cloud catalog is not loaded in the wizard.';
        options.dloHint =
            'Search by DLO label or API name (minimum 2 characters). The full Data Cloud catalog is not loaded in the wizard.';
        return options;
    }

    /**
     * Type-ahead search for DMOs/DLOs (avoids loading the full Connect API catalog).
     */
    @AuraEnabled
    public static List<DataCloudObjectOption> searchDataCloudExclusionObjects(
        String kind,
        String searchTerm
    ) {
        try {
            return searchDataCloudExclusionObjectsInternal(kind, searchTerm);
        } catch (Exception ex) {
            System.debug(LoggingLevel.WARN, 'searchDataCloudExclusionObjects failed: ' + ex.getMessage());
            AuraHandledException handled = new AuraHandledException(
                'Data Cloud search failed. Try the object API name, or check Data Cloud permissions.'
            );
            handled.setMessage(
                'Data Cloud search failed. Try the object API name, or check Data Cloud permissions.'
            );
            throw handled;
        }
    }

    private static List<DataCloudObjectOption> searchDataCloudExclusionObjectsInternal(
        String kind,
        String searchTerm
    ) {
        List<DataCloudObjectOption> results = new List<DataCloudObjectOption>();
        if (String.isBlank(searchTerm) || searchTerm.trim().length() < 2) {
            return results;
        }
        String normalizedKind = kind == null ? '' : kind.trim().toLowerCase();
        Boolean isDlo = normalizedKind == 'dlo';
        String suffixToken = isDlo ? '__dll' : '__dlm';
        String trimmed = searchTerm.trim();
        String nameLike = '%' + trimmed + '%';
        String suffixLike = '%' + suffixToken;

        Map<String, DataCloudObjectOption> byApi = new Map<String, DataCloudObjectOption>();
        searchEntityDefinitionCatalog(suffixLike, nameLike, byApi);
        if (byApi.size() < SEARCH_RESULT_LIMIT) {
            searchConnectApiCatalog(isDlo, trimmed, suffixToken, byApi);
        }
        results.addAll(byApi.values());
        results.sort(new DataCloudLabelSort());
        if (results.size() > SEARCH_RESULT_LIMIT) {
            List<DataCloudObjectOption> capped = new List<DataCloudObjectOption>();
            for (Integer i = 0; i < SEARCH_RESULT_LIMIT; i++) {
                capped.add(results[i]);
            }
            return capped;
        }
        return results;
    }

    @AuraEnabled
    public static List<FieldOption> getExclusionRecordFieldOptions(String source, String recordKey) {
        List<FieldOption> options = new List<FieldOption>();
        if (String.isBlank(source) || String.isBlank(recordKey)) {
            return options;
        }
        String normalized = source.toLowerCase();
        if (normalized == 'dmo' || normalized == 'dlo') {
            for (Map<String, String> field : MarketingDictionaryManagerController.getData360DmoFields(recordKey)) {
                addFieldOption(options, field.get('value'), field.get('label'));
            }
            return options;
        }
        if (normalized == 'campaign') {
            return entityFieldOptions('CampaignMember');
        }
        if (normalized == 'segment') {
            return entityFieldOptions('MarketSegment');
        }
        if (normalized == 'report') {
            return reportColumnOptions(recordKey);
        }
        return options;
    }

    private static void searchEntityDefinitionCatalog(
        String suffixLike,
        String nameLike,
        Map<String, DataCloudObjectOption> byApi
    ) {
        // EntityDefinition does not support OR in WHERE — run api-name and label queries separately.
        mergeEntityDefinitionRows(
            byApi,
            queryEntityDefinitionByApiName(suffixLike, nameLike)
        );
        if (byApi.size() < SEARCH_RESULT_LIMIT) {
            mergeEntityDefinitionRows(
                byApi,
                queryEntityDefinitionByLabel(suffixLike, nameLike)
            );
        }
    }

    private static List<EntityDefinition> queryEntityDefinitionByApiName(
        String suffixLike,
        String nameLike
    ) {
        try {
            return [
                SELECT QualifiedApiName, Label
                FROM EntityDefinition
                WHERE QualifiedApiName LIKE :suffixLike
                    AND QualifiedApiName LIKE :nameLike
                ORDER BY Label ASC
                LIMIT :SEARCH_RESULT_LIMIT
            ];
        } catch (Exception ex) {
            System.debug(LoggingLevel.WARN, 'EntityDefinition api search unavailable: ' + ex.getMessage());
            return new List<EntityDefinition>();
        }
    }

    private static List<EntityDefinition> queryEntityDefinitionByLabel(
        String suffixLike,
        String nameLike
    ) {
        try {
            return [
                SELECT QualifiedApiName, Label
                FROM EntityDefinition
                WHERE QualifiedApiName LIKE :suffixLike
                    AND Label LIKE :nameLike
                ORDER BY Label ASC
                LIMIT :SEARCH_RESULT_LIMIT
            ];
        } catch (Exception ex) {
            System.debug(LoggingLevel.WARN, 'EntityDefinition label search unavailable: ' + ex.getMessage());
            return new List<EntityDefinition>();
        }
    }

    private static void mergeEntityDefinitionRows(
        Map<String, DataCloudObjectOption> byApi,
        List<EntityDefinition> entities
    ) {
        if (entities == null || entities.isEmpty()) {
            return;
        }
        for (EntityDefinition ent : entities) {
            if (String.isBlank(ent.QualifiedApiName)) {
                continue;
            }
            String key = ent.QualifiedApiName.toLowerCase();
            if (byApi.containsKey(key)) {
                continue;
            }
            byApi.put(
                key,
                new DataCloudObjectOption(
                    ent.QualifiedApiName,
                    String.isNotBlank(ent.Label) ? ent.Label : ent.QualifiedApiName
                )
            );
            if (byApi.size() >= SEARCH_RESULT_LIMIT) {
                return;
            }
        }
    }

    private static final Pattern CONNECT_ENTITY_ROW_PATTERN = Pattern.compile(
        'name=([A-Za-z][A-Za-z0-9_]*__dl[ml]), displayName=([^,]+), relationships'
    );

    /**
     * Connect getAllMetadata cannot be JSON-serialized in this org; match entity rows from
     * String.valueOf and filter client-side (catalog size is typically a few hundred objects).
     */
    private static void searchConnectApiCatalog(
        Boolean isDlo,
        String searchTerm,
        String suffixToken,
        Map<String, DataCloudObjectOption> byApi
    ) {
        String entityType = isDlo ? 'DataLakeObject' : 'DataModelObject';
        String termLower = searchTerm.toLowerCase();
        String suffixLower = suffixToken.toLowerCase();
        List<String> spaces = dataSpaceApiNamesForConnect();
        for (String spaceName : spaces) {
            ConnectApi.CdpQueryMetadataOutput output;
            try {
                output = spaceName == null
                    ? ConnectApi.CdpQuery.getAllMetadata(entityType, null, null)
                    : ConnectApi.CdpQuery.getAllMetadata(entityType, null, null, spaceName);
            } catch (Exception ex) {
                System.debug(LoggingLevel.FINE, 'Connect catalog for ' + entityType + ': ' + ex.getMessage());
                continue;
            }
            if (output == null || output.metadata == null || output.metadata.isEmpty()) {
                continue;
            }
            for (Object rowObj : output.metadata) {
                DataCloudObjectOption option = parseConnectEntityRow(String.valueOf(rowObj));
                if (option == null) {
                    continue;
                }
                if (!option.apiName.toLowerCase().endsWith(suffixLower)) {
                    continue;
                }
                String apiLower = option.apiName.toLowerCase();
                String labelLower = option.label == null ? '' : option.label.toLowerCase();
                if (!apiLower.contains(termLower) && !labelLower.contains(termLower)) {
                    continue;
                }
                String key = apiLower;
                if (byApi.containsKey(key)) {
                    continue;
                }
                byApi.put(key, option);
                if (byApi.size() >= SEARCH_RESULT_LIMIT) {
                    return;
                }
            }
            if (!byApi.isEmpty()) {
                return;
            }
        }
    }

    private static DataCloudObjectOption parseConnectEntityRow(String rowText) {
        if (String.isBlank(rowText)) {
            return null;
        }
        Matcher matcher = CONNECT_ENTITY_ROW_PATTERN.matcher(rowText);
        if (!matcher.find()) {
            return null;
        }
        String api = matcher.group(1);
        String label = matcher.group(2);
        if (String.isBlank(api)) {
            return null;
        }
        if (String.isBlank(label)) {
            label = api;
        }
        return new DataCloudObjectOption(api, label.trim());
    }

    private static List<String> dataSpaceApiNamesForConnect() {
        List<String> names = new List<String>();
        Set<String> seen = new Set<String>();
        try {
            ConnectApi.DataSpaceCollectionRepresentation collection =
                ConnectApi.CdpDataSpace.getAllDataSpaces(200, 0, 'id');
            String payload = JSON.serialize(new List<Object>{ collection });
            if (String.isNotBlank(payload)) {
                Object parsed = JSON.deserializeUntyped(payload);
                if (parsed instanceof List<Object> && !((List<Object>) parsed).isEmpty()) {
                    Object raw = ((List<Object>) parsed)[0];
                    if (raw instanceof Map<String, Object>) {
                        Object rows = ((Map<String, Object>) raw).get('dataSpaces');
                        if (rows instanceof List<Object>) {
                            for (Object row : (List<Object>) rows) {
                                if (!(row instanceof Map<String, Object>)) {
                                    continue;
                                }
                                String api = firstString(
                                    (Map<String, Object>) row,
                                    new List<String>{ 'name', 'apiName', 'dataSpaceName', 'developerName' }
                                );
                                if (String.isBlank(api) || !seen.add(api.toLowerCase())) {
                                    continue;
                                }
                                names.add(api);
                            }
                        }
                    }
                }
            }
        } catch (Exception ex) {
            System.debug(LoggingLevel.FINE, 'Data spaces unavailable: ' + ex.getMessage());
        }
        if (names.isEmpty()) {
            names.add(null);
        }
        return names;
    }

    private static String firstString(Map<String, Object> values, List<String> keys) {
        if (values == null) {
            return null;
        }
        for (String key : keys) {
            Object value = values.get(key);
            if (value instanceof String && String.isNotBlank((String) value)) {
                return ((String) value).trim();
            }
        }
        return null;
    }

    private static List<FieldOption> entityFieldOptions(String entityApiName) {
        List<FieldOption> options = new List<FieldOption>();
        try {
            for (FieldDefinition fd : [
                SELECT QualifiedApiName, Label
                FROM FieldDefinition
                WHERE EntityDefinition.QualifiedApiName = :entityApiName
                ORDER BY Label ASC
                LIMIT 500
            ]) {
                addFieldOption(
                    options,
                    fd.QualifiedApiName,
                    String.isNotBlank(fd.Label) ? fd.Label : fd.QualifiedApiName
                );
            }
        } catch (Exception ex) {
            System.debug(LoggingLevel.WARN, 'FieldDefinition unavailable for ' + entityApiName + ': ' + ex.getMessage());
        }
        return options;
    }

    private static List<FieldOption> reportColumnOptions(String reportId) {
        List<FieldOption> options = new List<FieldOption>();
        try {
            Id rid = (Id) reportId;
            Reports.ReportDescribeResult described = Reports.ReportManager.describeReport(rid);
            if (described != null && described.getReportExtendedMetadata() != null) {
                Map<String, Reports.DetailColumn> columns =
                    described.getReportExtendedMetadata().getDetailColumnInfo();
                if (columns != null) {
                    for (String api : columns.keySet()) {
                        Reports.DetailColumn col = columns.get(api);
                        String label = col != null && String.isNotBlank(col.getLabel()) ? col.getLabel() : api;
                        addFieldOption(options, api, label);
                    }
                }
            }
        } catch (Exception ex) {
            System.debug(LoggingLevel.WARN, 'Report columns unavailable for ' + reportId + ': ' + ex.getMessage());
        }
        return options;
    }

    private static void addFieldOption(List<FieldOption> options, String api, String label) {
        if (String.isBlank(api)) {
            return;
        }
        String display = String.isNotBlank(label) && label != api ? label + ' (' + api + ')' : api;
        options.add(new FieldOption(api, display));
    }

    private static List<SegmentOption> loadActiveSegments(ExclusionOptions options) {
        List<SegmentOption> rows = new List<SegmentOption>();
        if (Schema.getGlobalDescribe().get('MarketSegment') == null) {
            options.segmentHint =
                'MarketSegment is not available in this org (Data Cloud Marketing Segments may be disabled).';
            return rows;
        }
        try {
            List<String> statuses = new List<String>{ 'Active', 'Published', 'Processing' };
            for (SObject segment : Database.query(
                'SELECT Id, Name, SegmentStatus FROM MarketSegment '
                    + 'WHERE SegmentStatus IN :statuses '
                    + 'ORDER BY Name ASC '
                    + 'LIMIT ' + MAX_SEGMENTS
            )) {
                rows.add(new SegmentOption(
                    (String) segment.get('Id'),
                    (String) segment.get('Name'),
                    (String) segment.get('SegmentStatus')
                ));
            }
            if (rows.isEmpty()) {
                for (SObject segment : Database.query(
                    'SELECT Id, Name, SegmentStatus FROM MarketSegment '
                        + 'ORDER BY Name ASC '
                        + 'LIMIT ' + MAX_SEGMENTS
                )) {
                    rows.add(new SegmentOption(
                        (String) segment.get('Id'),
                        (String) segment.get('Name'),
                        (String) segment.get('SegmentStatus')
                    ));
                }
            }
        } catch (Exception ex) {
            options.segmentHint =
                'Could not load segments. Check Data Cloud segment permissions and FLS on MarketSegment.';
            System.debug(LoggingLevel.WARN, 'MarketSegment catalogue unavailable: ' + ex.getMessage());
        }
        if (rows.isEmpty() && String.isBlank(options.segmentHint)) {
            options.segmentHint =
                'No segments returned. Confirm active Data Cloud segments exist and your user can read MarketSegment.';
        }
        return rows;
    }

    public class ExclusionOptions {
        @AuraEnabled
        public List<SegmentOption> segments { get; set; }

        @AuraEnabled
        public List<DataCloudObjectOption> dataModelObjects { get; set; }

        @AuraEnabled
        public List<DataCloudObjectOption> dataLakeObjects { get; set; }

        @AuraEnabled
        public String segmentHint { get; set; }

        @AuraEnabled
        public String dmoHint { get; set; }

        @AuraEnabled
        public String dloHint { get; set; }

        public ExclusionOptions() {
            segments = new List<SegmentOption>();
            dataModelObjects = new List<DataCloudObjectOption>();
            dataLakeObjects = new List<DataCloudObjectOption>();
        }

        public void putHint(String field, String message) {
            if (field == 'dmoHint') {
                dmoHint = message;
            } else if (field == 'dloHint') {
                dloHint = message;
            }
        }
    }

    public class SegmentOption {
        @AuraEnabled
        public String id { get; set; }
        @AuraEnabled
        public String name { get; set; }
        @AuraEnabled
        public String status { get; set; }

        public SegmentOption(String id, String name, String status) {
            this.id = id;
            this.name = name;
            this.status = status;
        }
    }

    public class DataCloudObjectOption {
        @AuraEnabled
        public String apiName { get; set; }
        @AuraEnabled
        public String label { get; set; }

        public DataCloudObjectOption(String apiName, String label) {
            this.apiName = apiName;
            this.label = label;
        }
    }

    public class FieldOption {
        @AuraEnabled
        public String value { get; set; }
        @AuraEnabled
        public String label { get; set; }

        public FieldOption(String value, String label) {
            this.value = value;
            this.label = label;
        }
    }

    private class DataCloudLabelSort implements System.Comparator<DataCloudObjectOption> {
        public Integer compare(DataCloudObjectOption a, DataCloudObjectOption b) {
            String left = a == null || a.label == null ? '' : a.label.toLowerCase();
            String right = b == null || b.label == null ? '' : b.label.toLowerCase();
            return left.compareTo(right);
        }
    }
}
