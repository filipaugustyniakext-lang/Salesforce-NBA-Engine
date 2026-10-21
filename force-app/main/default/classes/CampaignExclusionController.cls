/**
 * Data Cloud exclusion catalogues for Campaign Wizard (segments + DMOs).
 */
public with sharing class CampaignExclusionController {
    private static final Integer MAX_SEGMENTS = 1000;
    private static final Integer MAX_DMOS = 2000;

    @AuraEnabled(cacheable=true)
    public static ExclusionOptions getExclusionOptions() {
        ExclusionOptions options = new ExclusionOptions();
        options.segments = loadActiveSegments();
        options.dataModelObjects = loadDataModelObjects();
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

    private static List<DmoOption> loadDataModelObjects() {
        List<DmoOption> rows = new List<DmoOption>();
        try {
            for (EntityDefinition ent : [
                SELECT QualifiedApiName, Label
                FROM EntityDefinition
                WHERE QualifiedApiName LIKE '%__dlm'
                ORDER BY Label ASC
                LIMIT :MAX_DMOS
            ]) {
                if (String.isBlank(ent.QualifiedApiName)) {
                    continue;
                }
                rows.add(new DmoOption(
                    ent.QualifiedApiName,
                    String.isNotBlank(ent.Label) ? ent.Label : ent.QualifiedApiName
                ));
            }
        } catch (Exception ex) {
            System.debug(LoggingLevel.WARN, 'EntityDefinition DMO catalogue unavailable: ' + ex.getMessage());
        }
        return rows;
    }

    public class ExclusionOptions {
        @AuraEnabled
        public List<SegmentOption> segments { get; set; }

        @AuraEnabled
        public List<DmoOption> dataModelObjects { get; set; }

        public ExclusionOptions() {
            segments = new List<SegmentOption>();
            dataModelObjects = new List<DmoOption>();
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

    public class DmoOption {
        @AuraEnabled
        public String apiName { get; set; }
        @AuraEnabled
        public String label { get; set; }

        public DmoOption(String apiName, String label) {
            this.apiName = apiName;
            this.label = label;
        }
    }
}
