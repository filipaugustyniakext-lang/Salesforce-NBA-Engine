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
        if (Pattern.matches('^[A-Za-z][A-Za-z0-9_]*(__dlm|__dll)?$', trimmed)) {
            tryAddConnectMetadataMatch(isDlo, trimmed, byApi);
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
        try {
            for (EntityDefinition ent : [
                SELECT QualifiedApiName, Label
                FROM EntityDefinition
                WHERE QualifiedApiName LIKE :suffixLike
                    AND (QualifiedApiName LIKE :nameLike OR Label LIKE :nameLike)
                ORDER BY Label ASC
                LIMIT :SEARCH_RESULT_LIMIT
            ]) {
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
            }
        } catch (Exception ex) {
            System.debug(LoggingLevel.WARN, 'EntityDefinition search unavailable: ' + ex.getMessage());
        }
    }

    private static void tryAddConnectMetadataMatch(
        Boolean isDlo,
        String apiName,
        Map<String, DataCloudObjectOption> byApi
    ) {
        String entityType = isDlo ? 'DataLakeObject' : 'DataModelObject';
        String expectedType = isDlo ? 'DataLakeObject' : 'DataModelObject';
        try {
            ConnectApi.CdpQueryMetadataOutput meta =
                ConnectApi.CdpQuery.getAllMetadata(entityType, null, apiName);
            Object raw = connectApiAsUntyped(meta);
            addConnectMetadataRows(byApi, raw, expectedType);
        } catch (Exception ex) {
            System.debug(LoggingLevel.FINE, 'Connect metadata lookup for ' + apiName + ': ' + ex.getMessage());
        }
    }

    private static void addConnectMetadataRows(
        Map<String, DataCloudObjectOption> byApi,
        Object raw,
        String expectedTypeName
    ) {
        if (!(raw instanceof Map<String, Object>)) {
            return;
        }
        Object rows = ((Map<String, Object>) raw).get('metadata');
        if (!(rows instanceof List<Object>)) {
            return;
        }
        for (Object row : (List<Object>) rows) {
            if (!(row instanceof Map<String, Object>)) {
                continue;
            }
            Map<String, Object> entity = (Map<String, Object>) row;
            String api = firstString(entity, new List<String>{ 'name', 'apiName' });
            String typeName = firstString(entity, new List<String>{ 'type' });
            if (String.isBlank(api)) {
                continue;
            }
            if (String.isNotBlank(typeName) && typeName != expectedTypeName) {
                continue;
            }
            String key = api.toLowerCase();
            if (byApi.containsKey(key)) {
                continue;
            }
            String label = firstString(entity, new List<String>{ 'displayName', 'label' });
            if (String.isBlank(label)) {
                label = api;
            }
            byApi.put(key, new DataCloudObjectOption(api, label));
        }
    }

    private static Object connectApiAsUntyped(Object value) {
        if (value == null) {
            return null;
        }
        String payload = JSON.serialize(new List<Object>{ value });
        if (String.isBlank(payload)) {
            return null;
        }
        Object parsed = JSON.deserializeUntyped(payload);
        if (parsed instanceof List<Object>) {
            List<Object> rows = (List<Object>) parsed;
            return rows.isEmpty() ? null : rows[0];
        }
        return parsed;
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
