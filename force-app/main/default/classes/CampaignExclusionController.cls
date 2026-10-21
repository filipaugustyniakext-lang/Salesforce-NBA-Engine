/**
 * Data Cloud exclusion catalogues for Campaign Wizard (segments, DMOs, DLOs).
 */
public with sharing class CampaignExclusionController {
    private static final Integer MAX_SEGMENTS = 1000;
    private static final Integer MAX_DATA_CLOUD_OBJECTS = 2000;

    @AuraEnabled(cacheable=true)
    public static ExclusionOptions getExclusionOptions() {
        ExclusionOptions options = new ExclusionOptions();
        options.segments = loadActiveSegments();
        options.dataModelObjects = loadEntityCatalog('__dlm');
        options.dataLakeObjects = loadEntityCatalog('__dll');
        return options;
    }

    private static List<SegmentOption> loadActiveSegments() {
        List<SegmentOption> rows = new List<SegmentOption>();
        if (Schema.getGlobalDescribe().get('MarketSegment') == null) {
            return rows;
        }
        try {
            for (SObject segment : Database.query(
                'SELECT Id, Name, SegmentStatus FROM MarketSegment '
                    + 'WHERE SegmentStatus = \'Active\' '
                    + 'ORDER BY Name ASC '
                    + 'LIMIT ' + MAX_SEGMENTS
            )) {
                rows.add(new SegmentOption(
                    (String) segment.get('Id'),
                    (String) segment.get('Name'),
                    (String) segment.get('SegmentStatus')
                ));
            }
        } catch (Exception ex) {
            System.debug(LoggingLevel.WARN, 'MarketSegment catalogue unavailable: ' + ex.getMessage());
        }
        return rows;
    }

    private static List<DataCloudObjectOption> loadEntityCatalog(String apiSuffix) {
        List<DataCloudObjectOption> rows = new List<DataCloudObjectOption>();
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
                rows.add(new DataCloudObjectOption(
                    ent.QualifiedApiName,
                    String.isNotBlank(ent.Label) ? ent.Label : ent.QualifiedApiName
                ));
            }
        } catch (Exception ex) {
            System.debug(LoggingLevel.WARN, 'EntityDefinition catalogue unavailable (' + apiSuffix + '): ' + ex.getMessage());
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

        public ExclusionOptions() {
            segments = new List<SegmentOption>();
            dataModelObjects = new List<DataCloudObjectOption>();
            dataLakeObjects = new List<DataCloudObjectOption>();
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
}
