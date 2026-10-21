/**
 * Data Cloud exclusion catalogues for Campaign Wizard (segments, DMOs, DLOs).
 */
public with sharing class CampaignExclusionController {
    private static final Integer MAX_SEGMENTS = 1000;
    private static final Integer MAX_DATA_CLOUD_OBJECTS = 2000;

    @AuraEnabled(cacheable=true)
    public static ExclusionOptions getExclusionOptions() {
        ExclusionOptions options = new ExclusionOptions();
        options.segments = loadActiveSegments(options);
        Map<String, DataCloudObjectOption> dmoByApi = new Map<String, DataCloudObjectOption>();
        Map<String, DataCloudObjectOption> dloByApi = new Map<String, DataCloudObjectOption>();
        loadManagerCatalog('DMO', dmoByApi, options);
        loadManagerCatalog('DLO', dloByApi, options);
        options.dataModelObjects = new List<DataCloudObjectOption>(dmoByApi.values());
        options.dataLakeObjects = new List<DataCloudObjectOption>(dloByApi.values());
        options.dataModelObjects.sort(new DataCloudLabelSort());
        options.dataLakeObjects.sort(new DataCloudLabelSort());
        return options;
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

    private static void loadManagerCatalog(
        String kind,
        Map<String, DataCloudObjectOption> byApi,
        ExclusionOptions options
    ) {
        String suffix = kind == 'DMO' ? '__dlm' : '__dll';
        String hintField = kind == 'DMO' ? 'dmoHint' : 'dloHint';
        String connectError;
        try {
            List<Map<String, String>> rows = kind == 'DMO'
                ? MarketingDictionaryManagerController.getData360DmoOptions()
                : MarketingDictionaryManagerController.getData360DloOptions();
            mergeManagerRows(byApi, rows);
        } catch (Exception ex) {
            connectError = sanitizeConnectMessage(ex.getMessage());
        }
        collectEntityDefinitionCatalog(suffix, byApi);
        if (byApi.isEmpty()) {
            if (String.isNotBlank(connectError)) {
                options.putHint(
                    hintField,
                    'Data Cloud could not list ' + kind + 's. ' + connectError
                        + ' Confirm Data Space assignment and CDP Connect permissions for this user.'
                );
            } else {
                options.putHint(
                    hintField,
                    'No ' + kind + 's were returned. Data Space access or CDP metadata permissions may be missing.'
                );
            }
        } else if (String.isNotBlank(connectError)) {
            options.putHint(
                hintField,
                'Showing ' + byApi.size() + ' ' + kind + '(s). Some Data Spaces may be unavailable: ' + connectError
            );
        }
    }

    private static void mergeManagerRows(
        Map<String, DataCloudObjectOption> byApi,
        List<Map<String, String>> rows
    ) {
        if (rows == null) {
            return;
        }
        for (Map<String, String> row : rows) {
            String api = row.get('value');
            if (String.isBlank(api)) {
                continue;
            }
            String label = row.get('label');
            if (String.isBlank(label)) {
                label = api;
            }
            byApi.put(api.toLowerCase(), new DataCloudObjectOption(api, label));
        }
    }

    private static String sanitizeConnectMessage(String raw) {
        if (String.isBlank(raw)) {
            return '';
        }
        String message = raw.trim();
        if (message.containsIgnoreCase('Script-thrown exception')) {
            message = message.replace('Script-thrown exception', '').trim();
            if (message.startsWith(':')) {
                message = message.substring(1).trim();
            }
        }
        return message;
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

    private static void collectEntityDefinitionCatalog(
        String apiSuffix,
        Map<String, DataCloudObjectOption> byApi
    ) {
        String likePattern = '%' + apiSuffix;
        try {
            for (EntityDefinition ent : [
                SELECT QualifiedApiName, Label
                FROM EntityDefinition
                WHERE QualifiedApiName LIKE :likePattern
                ORDER BY Label ASC
                LIMIT :MAX_DATA_CLOUD_OBJECTS
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
            System.debug(
                LoggingLevel.WARN,
                'EntityDefinition catalogue unavailable (' + apiSuffix + '): ' + ex.getMessage()
            );
        }
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
