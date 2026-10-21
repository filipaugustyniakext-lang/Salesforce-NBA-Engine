/**
 * Data Cloud exclusion catalogues for Campaign Wizard (segments, DMOs, DLOs).
 */
public with sharing class CampaignExclusionController {
    private static final Integer MAX_SEGMENTS = 1000;
    private static final Integer MAX_DATA_CLOUD_OBJECTS = 2000;

    private static final List<String> DMO_CATEGORIES = new List<String>{
        null, 'Profile', 'Engagement', 'Related'
    };

    @AuraEnabled(cacheable=true)
    public static ExclusionOptions getExclusionOptions() {
        ExclusionOptions options = new ExclusionOptions();
        options.segments = loadActiveSegments(options);
        Map<String, DataCloudObjectOption> dmoByApi = new Map<String, DataCloudObjectOption>();
        Map<String, DataCloudObjectOption> dloByApi = new Map<String, DataCloudObjectOption>();
        loadDataCloudObjects('DataModelObject', 'DataModelObject', '__dlm', dmoByApi, options);
        loadDataCloudObjects('DataLakeObject', 'DataLakeObject', '__dll', dloByApi, options);
        options.dataModelObjects = new List<DataCloudObjectOption>(dmoByApi.values());
        options.dataLakeObjects = new List<DataCloudObjectOption>(dloByApi.values());
        options.dataModelObjects.sort(new DataCloudLabelSort());
        options.dataLakeObjects.sort(new DataCloudLabelSort());
        return options;
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

    private static void loadDataCloudObjects(
        String connectEntityType,
        String expectedTypeName,
        String apiSuffix,
        Map<String, DataCloudObjectOption> byApi,
        ExclusionOptions options
    ) {
        String connectError;
        try {
            collectFromConnectApi(connectEntityType, expectedTypeName, byApi);
        } catch (Exception ex) {
            connectError = ex.getMessage();
        }
        collectEntityDefinitionCatalog(apiSuffix, byApi);
        String hintField = apiSuffix == '__dlm' ? 'dmoHint' : 'dloHint';
        if (byApi.isEmpty()) {
            if (String.isNotBlank(connectError)) {
                options.putHint(
                    hintField,
                    'Data Cloud Connect API could not list '
                        + (apiSuffix == '__dlm' ? 'DMOs' : 'DLOs')
                        + '. '
                        + connectError
                        + ' Assign the user to a Data Space and grant CDP query permissions.'
                );
            } else {
                options.putHint(
                    hintField,
                    'No '
                        + (apiSuffix == '__dlm' ? 'DMOs' : 'DLOs')
                        + ' found. EntityDefinition often omits Data Cloud objects; Connect API and Data Space access are required.'
                );
            }
        } else if (String.isNotBlank(connectError) && byApi.size() < 5) {
            options.putHint(
                hintField,
                'Partial catalogue (' + byApi.size() + '). Some Data Spaces may be inaccessible: ' + connectError
            );
        }
    }

    private static void collectFromConnectApi(
        String entityType,
        String expectedTypeName,
        Map<String, DataCloudObjectOption> byApi
    ) {
        List<String> spaces = dataSpaceApiNames();
        if (spaces.isEmpty()) {
            spaces.add(null);
        }
        List<String> errors = new List<String>();
        for (String spaceName : spaces) {
            if (entityType == 'DataModelObject') {
                for (String category : DMO_CATEGORIES) {
                    try {
                        addConnectMetadataRows(
                            byApi,
                            connectApiAsUntyped(
                                queryDataCloudMetadata('DataModelObject', category, null, spaceName)
                            ),
                            expectedTypeName
                        );
                        if (category == null && !byApi.isEmpty()) {
                            break;
                        }
                    } catch (Exception e) {
                        errors.add(e.getMessage());
                    }
                }
            } else {
                try {
                    addConnectMetadataRows(
                        byApi,
                        connectApiAsUntyped(
                            queryDataCloudMetadata(entityType, null, null, spaceName)
                        ),
                        expectedTypeName
                    );
                } catch (Exception e) {
                    errors.add(e.getMessage());
                }
            }
        }
        if (byApi.isEmpty() && !errors.isEmpty()) {
            throw new AuraHandledException(errors[0]);
        }
    }

    private static ConnectApi.CdpQueryMetadataOutput queryDataCloudMetadata(
        String entityType,
        String entityCategory,
        String entityName,
        String spaceName
    ) {
        return spaceName == null
            ? ConnectApi.CdpQuery.getAllMetadata(entityType, entityCategory, entityName)
            : ConnectApi.CdpQuery.getAllMetadata(entityType, entityCategory, entityName, spaceName);
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

    private static List<String> dataSpaceApiNames() {
        List<String> names = new List<String>();
        Set<String> seen = new Set<String>();
        try {
            ConnectApi.DataSpaceCollectionRepresentation collection =
                ConnectApi.CdpDataSpace.getAllDataSpaces(200, 0, 'id');
            Object raw = connectApiAsUntyped(collection);
            Object rows = raw instanceof Map<String, Object>
                ? ((Map<String, Object>) raw).get('dataSpaces')
                : null;
            if (rows instanceof List<Object>) {
                for (Object row : (List<Object>) rows) {
                    if (!(row instanceof Map<String, Object>)) {
                        continue;
                    }
                    String api = firstString(
                        (Map<String, Object>) row,
                        new List<String>{ 'name', 'apiName', 'dataSpaceName', 'developerName', 'label' }
                    );
                    if (String.isBlank(api) || !seen.add(api.toLowerCase())) {
                        continue;
                    }
                    names.add(api);
                }
            }
        } catch (Exception e) {
            names.clear();
            seen.clear();
        }
        if (!seen.contains('default')) {
            names.add(0, null);
        }
        return names;
    }

    private static Object connectApiAsUntyped(Object value) {
        if (value == null) {
            return null;
        }
        String payload = JSON.serialize(new List<Object>{ value });
        if (String.isBlank(payload)) {
            throw new AuraHandledException('Data Cloud returned metadata that Apex could not read.');
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

    private class DataCloudLabelSort implements System.Comparator<DataCloudObjectOption> {
        public Integer compare(DataCloudObjectOption a, DataCloudObjectOption b) {
            String left = a == null || a.label == null ? '' : a.label.toLowerCase();
            String right = b == null || b.label == null ? '' : b.label.toLowerCase();
            return left.compareTo(right);
        }
    }
}
