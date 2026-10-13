/**
 * Dual-write mirror: apply SFMC DE-shaped upsert/delete batches onto Core objects.
 */
public with sharing class CcMirrorService {
  public class MirrorOp {
    public String operation; // upsert | delete
    public String objectName; // DE logical name, e.g. CC_Message_Metadata
    public List<Map<String, Object>> rows;
    public List<Map<String, Object>> keys;
  }

  public class MirrorRequest {
    public List<MirrorOp> ops;
  }

  public class OpResult {
    public String objectName;
    public String operation;
    public Integer requested;
    public Integer success;
    public Integer failed;
    public List<String> errors = new List<String>();
  }

  public class MirrorResponse {
    public Boolean ok;
    public List<OpResult> results = new List<OpResult>();
    public List<String> errors = new List<String>();
  }

  public static MirrorResponse apply(MirrorRequest request) {
    MirrorResponse response = new MirrorResponse();
    response.ok = true;

    if (request == null || request.ops == null || request.ops.isEmpty()) {
      response.ok = false;
      response.errors.add('Request.ops is required.');
      return response;
    }

    for (MirrorOp op : request.ops) {
      OpResult result = applyOne(op);
      response.results.add(result);
      if (result.failed > 0 || (result.errors != null && !result.errors.isEmpty())) {
        response.ok = false;
      }
    }
    return response;
  }

  private static OpResult applyOne(MirrorOp op) {
    OpResult result = new OpResult();
    result.requested = 0;
    result.success = 0;
    result.failed = 0;

    if (op == null) {
      result.errors.add('Null op.');
      result.failed = 1;
      return result;
    }

    result.objectName = op.objectName;
    result.operation = String.isBlank(op.operation) ? 'upsert' : op.operation.trim().toLowerCase();

    CcMirrorObjectMap.ObjectConfig cfg = CcMirrorObjectMap.get(op.objectName);
    if (cfg == null) {
      result.errors.add(
        'Unsupported object "' +
          op.objectName +
          '". Supported: ' +
          String.join(new List<String>(CcMirrorObjectMap.supportedDeNames()), ', ')
      );
      result.failed = 1;
      return result;
    }

    Boolean isMetadata = cfg.sobjectApiName == 'CC_Message_Metadata__c';
    if (result.operation == 'upsert') {
      return isMetadata
        ? CcMirrorMetadataSync.upsertRows(op.rows, result)
        : upsertRows(cfg, op.rows, result);
    }
    if (result.operation == 'delete') {
      List<Map<String, Object>> deleteKeys = op.keys != null ? op.keys : op.rows;
      return isMetadata
        ? CcMirrorMetadataSync.deleteRows(deleteKeys, result)
        : deleteRows(cfg, deleteKeys, result);
    }

    result.errors.add('Unsupported operation "' + result.operation + '". Use upsert|delete.');
    result.failed = 1;
    return result;
  }

  private static OpResult upsertRows(
    CcMirrorObjectMap.ObjectConfig cfg,
    List<Map<String, Object>> rows,
    OpResult result
  ) {
    if (rows == null || rows.isEmpty()) {
      result.errors.add('upsert requires rows[].');
      result.failed = 1;
      return result;
    }

    result.requested = rows.size();
    List<SObject> records = new List<SObject>();
    Schema.SObjectType sobjectType = Schema.getGlobalDescribe().get(cfg.sobjectApiName);
    if (sobjectType == null) {
      result.errors.add('SObject not found in org: ' + cfg.sobjectApiName);
      result.failed = rows.size();
      return result;
    }

    Map<String, Schema.SObjectField> fieldMap = sobjectType.getDescribe().fields.getMap();
    Boolean hasExternalKeyField = fieldMap.containsKey(cfg.externalIdField.toLowerCase())
      || fieldMap.containsKey(cfg.externalIdField);

    for (Integer i = 0; i < rows.size(); i++) {
      Map<String, Object> row = rows[i];
      try {
        SObject record = sobjectType.newSObject();
        for (String deField : cfg.fields) {
          String apiName = CcMirrorObjectMap.toFieldApi(deField);
          if (!hasField(fieldMap, apiName)) {
            continue;
          }
          Object raw = CcMirrorObjectMap.valueFromRow(row, deField);
          if (raw == null) {
            continue;
          }
          record.put(apiName, coerceValue(fieldMap, apiName, raw));
        }

        applyRecordName(fieldMap, record, row);

        if (hasExternalKeyField && cfg.pkFields != null && cfg.pkFields.size() > 1) {
          String externalKey = CcMirrorObjectMap.buildExternalKey(cfg, row);
          record.put(cfg.externalIdField, externalKey);
        } else if (hasExternalKeyField && cfg.pkFields != null && cfg.pkFields.size() == 1) {
          Object pkVal = CcMirrorObjectMap.valueFromRow(row, cfg.pkFields[0]);
          if (pkVal != null) {
            record.put(cfg.externalIdField, String.valueOf(pkVal));
          }
        }

        records.add(record);
      } catch (Exception ex) {
        result.failed++;
        result.errors.add('Row ' + i + ': ' + ex.getMessage());
      }
    }

    if (records.isEmpty()) {
      return result;
    }

    if (!hasExternalKeyField) {
      result.errors.add(
        'External Id field missing on ' +
          cfg.sobjectApiName +
          ': ' +
          cfg.externalIdField +
          '. Mark PK/External Key as External ID (Unique) or add CC_External_Key__c.'
      );
      result.failed += records.size();
      return result;
    }

    Schema.SObjectField extField = fieldMap.get(cfg.externalIdField.toLowerCase());
    if (extField == null) {
      extField = fieldMap.get(cfg.externalIdField);
    }

    Database.UpsertResult[] upsertResults = Database.upsert(records, extField, false);
    for (Integer i = 0; i < upsertResults.size(); i++) {
      Database.UpsertResult ur = upsertResults[i];
      if (ur.isSuccess()) {
        result.success++;
      } else {
        result.failed++;
        List<String> messages = new List<String>();
        for (Database.Error err : ur.getErrors()) {
          messages.add(err.getStatusCode() + ': ' + err.getMessage());
        }
        result.errors.add('Upsert row ' + i + ': ' + String.join(messages, '; '));
      }
    }
    return result;
  }

  private static OpResult deleteRows(
    CcMirrorObjectMap.ObjectConfig cfg,
    List<Map<String, Object>> keys,
    OpResult result
  ) {
    if (keys == null || keys.isEmpty()) {
      result.errors.add('delete requires keys[] (or rows[] with PK fields).');
      result.failed = 1;
      return result;
    }

    result.requested = keys.size();
    Schema.SObjectType sobjectType = Schema.getGlobalDescribe().get(cfg.sobjectApiName);
    if (sobjectType == null) {
      result.errors.add('SObject not found in org: ' + cfg.sobjectApiName);
      result.failed = keys.size();
      return result;
    }

    Map<String, Schema.SObjectField> fieldMap = sobjectType.getDescribe().fields.getMap();
    Boolean hasExternalKeyField = hasField(fieldMap, cfg.externalIdField);
    if (!hasExternalKeyField) {
      result.errors.add('External Id field missing for delete: ' + cfg.externalIdField);
      result.failed = keys.size();
      return result;
    }

    Set<String> externalKeys = new Set<String>();
    for (Map<String, Object> keyRow : keys) {
      String externalKey;
      if (cfg.pkFields != null && cfg.pkFields.size() > 1) {
        externalKey = CcMirrorObjectMap.buildExternalKey(cfg, keyRow);
      } else {
        Object pkVal = CcMirrorObjectMap.valueFromRow(keyRow, cfg.pkFields[0]);
        externalKey = pkVal == null ? null : String.valueOf(pkVal);
      }
      if (!String.isBlank(externalKey)) {
        externalKeys.add(externalKey);
      }
    }

    if (externalKeys.isEmpty()) {
      result.errors.add('No delete keys resolved.');
      result.failed = keys.size();
      return result;
    }

    String soql =
      'SELECT Id FROM ' +
      cfg.sobjectApiName +
      ' WHERE ' +
      cfg.externalIdField +
      ' IN :externalKeys';
    List<SObject> existing = Database.query(soql);
    if (existing.isEmpty()) {
      // Idempotent delete — treat as success.
      result.success = keys.size();
      return result;
    }

    Database.DeleteResult[] deleteResults = Database.delete(existing, false);
    Integer ok = 0;
    for (Integer i = 0; i < deleteResults.size(); i++) {
      if (deleteResults[i].isSuccess()) {
        ok++;
      } else {
        result.failed++;
        List<String> messages = new List<String>();
        for (Database.Error err : deleteResults[i].getErrors()) {
          messages.add(err.getStatusCode() + ': ' + err.getMessage());
        }
        result.errors.add('Delete row ' + i + ': ' + String.join(messages, '; '));
      }
    }
    result.success += ok;
    return result;
  }

  private static void applyRecordName(
    Map<String, Schema.SObjectField> fieldMap,
    SObject record,
    Map<String, Object> row
  ) {
    Schema.SObjectField nameField = fieldMap.get('name');
    if (nameField == null) {
      return;
    }
    Schema.DescribeFieldResult nameDescribe = nameField.getDescribe();
    if (nameDescribe.isAutoNumber() || !nameDescribe.isCreateable()) {
      return;
    }
    Object messageName = CcMirrorObjectMap.valueFromRow(row, 'MessageName');
    if (messageName == null || String.isBlank(String.valueOf(messageName))) {
      return;
    }
    String value = String.valueOf(messageName).trim();
    Integer maxLength = nameDescribe.getLength();
    if (maxLength > 0 && value.length() > maxLength) {
      value = value.substring(0, maxLength);
    }
    record.put('Name', value);
  }

  private static Boolean hasField(Map<String, Schema.SObjectField> fieldMap, String apiName) {
    if (fieldMap == null || String.isBlank(apiName)) {
      return false;
    }
    return fieldMap.containsKey(apiName.toLowerCase()) || fieldMap.containsKey(apiName);
  }

  private static Object coerceValue(
    Map<String, Schema.SObjectField> fieldMap,
    String apiName,
    Object raw
  ) {
    Schema.SObjectField token = fieldMap.get(apiName.toLowerCase());
    if (token == null) {
      token = fieldMap.get(apiName);
    }
    if (token == null || raw == null) {
      return raw;
    }

    Schema.DisplayType dtype = token.getDescribe().getType();
    String asText = String.valueOf(raw);
    Boolean isTextType =
      dtype == Schema.DisplayType.String ||
      dtype == Schema.DisplayType.TextArea ||
      dtype == Schema.DisplayType.Picklist;
    if (!isTextType && String.isBlank(asText)) {
      return null;
    }

    if (dtype == Schema.DisplayType.Boolean) {
      if (raw instanceof Boolean) {
        return raw;
      }
      return asText.toLowerCase() == 'true' || asText == '1';
    }
    if (
      dtype == Schema.DisplayType.Double ||
      dtype == Schema.DisplayType.Currency ||
      dtype == Schema.DisplayType.Percent
    ) {
      return Decimal.valueOf(asText);
    }
    if (dtype == Schema.DisplayType.Integer) {
      return Integer.valueOf(asText);
    }
    if (dtype == Schema.DisplayType.Long) {
      return Long.valueOf(asText);
    }
    if (dtype == Schema.DisplayType.Date) {
      if (raw instanceof Date) {
        return raw;
      }
      if (asText.length() >= 10) {
        return Date.valueOf(asText.substring(0, 10));
      }
      return Date.valueOf(asText);
    }
    if (dtype == Schema.DisplayType.DateTime) {
      if (raw instanceof Datetime) {
        return raw;
      }
      if (String.isBlank(asText)) {
        return null;
      }
      try {
        return (Datetime) JSON.deserialize('"' + asText.trim() + '"', Datetime.class);
      } catch (Exception isoErr) {
        // Fall through to DE-style timestamps without an offset.
      }
      String normalized = asText.replace('T', ' ').replace('Z', '');
      if (normalized.length() >= 19) {
        return Datetime.valueOf(normalized.substring(0, 19));
      }
      return Datetime.valueOf(normalized);
    }
    return asText;
  }
}