/**
 * Logical DE name → Core SObject API name (1:1 with SFMC Data Extensions).
 * Field lists match cloudpages/ssjs/cc-repository-lib.ssjs + cc-async-jobs-lib.ssjs.
 * Adjust sobjectApiName / externalIdField if your org uses a namespace.
 */
public with sharing class CcMirrorObjectMap {
  public class ObjectConfig {
    public String sobjectApiName;
    /** External Id field used for upsert (must exist + be External ID in Core). */
    public String externalIdField;
    /** Ordered PK fields (DE names, without __c). */
    public List<String> pkFields;
    /** Mirrored fields (DE names, without __c). */
    public List<String> fields;

    public ObjectConfig(
      String sobjectApiName,
      String externalIdField,
      List<String> pkFields,
      List<String> fields
    ) {
      this.sobjectApiName = sobjectApiName;
      this.externalIdField = externalIdField;
      this.pkFields = pkFields;
      this.fields = fields;
    }
  }

  private static final Map<String, ObjectConfig> BY_DE = new Map<String, ObjectConfig>{
    'CC_Message_Metadata' => new ObjectConfig(
      'CC_Message_Metadata__c',
      'Message_Variant_Id__c',
      new List<String>{ 'MessageVariantId' },
      new List<String>{
        'MessageVariantId',
        'CurrentMessageVariantVersionId',
        'MessageType',
        'MessageName',
        'MessageVariant',
        'MessagePropertiesJSON',
        'MessagePropertiesJSON2',
        'VariantStatus',
        'IsActive',
        'BlockCount',
        'CampaignId',
        'TopicGoalId',
        'DisplayProbability',
        'DisplayProbabilityManual',
        'CreatedAt',
        'UpdatedAt',
        'PublishedAt',
        'DeactivatedAt',
        'CancelledAt',
        'LastModifiedAt',
        'LastModifiedBy',
        'ScheduledChangeId',
        'ScheduledStatus',
        'ScheduledAction',
        'ScheduledAt',
        'ScheduledAtLocal',
        'ScheduledNote',
        'ScheduledFromStatus',
        'ScheduledToStatus',
        'ScheduledCreatedAt',
        'ScheduledUpdatedAt',
        'ScheduledCancelledAt',
        'StagedOnly',
        'ContentBuilderMessageId',
        'ContentBuilderMessagePath'
      }
    ),
    'CC_Message_Blocks' => new ObjectConfig(
      'CC_Message_Blocks__c',
      'CC_External_Key__c',
      new List<String>{ 'MessageVariantId', 'ContentBlockOrder' },
      new List<String>{
        'MessageType',
        'MessageName',
        'MessageVariant',
        'MessageVariantId',
        'ContentBlockOrder',
        'BlockType',
        'ContentBlockPath',
        'ContentBuilderAssetId',
        'ContentJson',
        'ContentJsonPart2',
        'UpdatedAt',
        'UpdatedBy'
      }
    ),
    'CC_Message_Blocks_All' => new ObjectConfig(
      'CC_Message_Blocks_All__c',
      'CC_External_Key__c',
      new List<String>{ 'MessageVariantId', 'ContentBlockOrder' },
      new List<String>{
        'MessageType',
        'MessageName',
        'MessageVariant',
        'MessageVariantId',
        'ContentBlockOrder',
        'BlockType',
        'ContentBlockPath',
        'ContentBuilderAssetId',
        'ContentJson',
        'ContentJsonPart2',
        'UpdatedAt',
        'UpdatedBy'
      }
    ),
    'CC_Message_VersionHistoryLog' => new ObjectConfig(
      'CC_Message_VersionHistoryLog__c',
      'CC_External_Key__c',
      new List<String>{
        'MessageVariantId',
        'MessageVariantVersionId',
        'ContentBlockOrder'
      },
      new List<String>{
        'MessageVariantId',
        'MessageVariantVersionId',
        'ContentBlockOrder',
        'MessageType',
        'MessageName',
        'MessageVariant',
        'Action',
        'BlockType',
        'SnapshotJson',
        'SnapshotJsonPart2',
        'CommitComment',
        'RevertedFromStateId',
        'CreatedAt',
        'CreatedBy'
      }
    ),
    'CC_Staging_Changes' => new ObjectConfig(
      'CC_Staging_Changes__c',
      'CC_External_Key__c',
      new List<String>{ 'MessageVariantId', 'ContentBlockOrder' },
      new List<String>{
        'MessageVariantId',
        'ContentBlockOrder',
        'StagingChangeId',
        'Status',
        'ChangeType',
        'MessageType',
        'MessageName',
        'MessageVariant',
        'BlockType',
        'SnapshotJson',
        'SnapshotJsonPart2',
        'MetadataJson',
        'ScheduledAt',
        'ScheduledAtLocal',
        'Note',
        'PublicationMode',
        'CreatedAt',
        'UpdatedAt',
        'CreatedBy'
      }
    ),
    'CC_Async_Jobs' => new ObjectConfig(
      'CC_Async_Jobs__c',
      'JobId__c',
      new List<String>{ 'JobId' },
      new List<String>{
        'JobId',
        'Action',
        'Status',
        'PayloadJson',
        'ResultJson',
        'ErrorMessage',
        'RequestId',
        'MessageVariantId',
        'MessageType',
        'CreatedBy',
        'CreatedAt',
        'StartedAt',
        'FinishedAt'
      }
    )
  };

  public static ObjectConfig get(String deName) {
    if (String.isBlank(deName)) {
      return null;
    }
    return BY_DE.get(deName.trim());
  }

  public static Set<String> supportedDeNames() {
    return BY_DE.keySet();
  }

  public static String toFieldApi(String deFieldName) {
    if (String.isBlank(deFieldName)) {
      return null;
    }
    String trimmed = deFieldName.trim();
    if (trimmed.endsWith('__c')) {
      return trimmed;
    }
    return trimmed + '__c';
  }

  public static String buildExternalKey(ObjectConfig cfg, Map<String, Object> row) {
    if (cfg == null || row == null || cfg.pkFields == null || cfg.pkFields.isEmpty()) {
      return null;
    }
    List<String> parts = new List<String>();
    for (String pk : cfg.pkFields) {
      Object raw = valueFromRow(row, pk);
      parts.add(raw == null ? '' : String.valueOf(raw));
    }
    return String.join(parts, '#');
  }

  public static Object valueFromRow(Map<String, Object> row, String deField) {
    if (row == null || String.isBlank(deField)) {
      return null;
    }
    if (row.containsKey(deField)) {
      return row.get(deField);
    }
    String camel = deField.substring(0, 1).toLowerCase() + deField.substring(1);
    if (row.containsKey(camel)) {
      return row.get(camel);
    }
    String withSuffix = deField.endsWith('__c') ? deField : deField + '__c';
    if (row.containsKey(withSuffix)) {
      return row.get(withSuffix);
    }
    return null;
  }
}