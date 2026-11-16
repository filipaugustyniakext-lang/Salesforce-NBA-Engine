/**
 * SFMC -> Core push for CC_Message_Metadata.
 *
 * Must stay aligned with MarketingCloudCopySync (Core -> pull from SFMC):
 * same match key (MessageVariantId__c, case-insensitive), same field mapping,
 * so both directions update the same CC_Message_Metadata__c record.
 */
public with sharing class CcMirrorMetadataSync {
  public static CcMirrorService.OpResult upsertRows(
    List<Map<String, Object>> rows,
    CcMirrorService.OpResult result
  ) {
    if (rows == null || rows.isEmpty()) {
      result.errors.add('upsert requires rows[].');
      result.failed = 1;
      return result;
    }
    result.requested = rows.size();

    Map<String, CC_Message_Metadata__c> incoming = new Map<String, CC_Message_Metadata__c>();
    for (Integer i = 0; i < rows.size(); i++) {
      Map<String, String> row = lowerCaseRow(rows[i]);
      String variantId = row.get('messagevariantid');
      if (String.isBlank(variantId)) {
        result.failed++;
        result.errors.add('Row ' + i + ': MessageVariantId is required.');
        continue;
      }
      variantId = variantId.trim();
      incoming.put(variantId.toLowerCase(), toRecord(row, variantId));
    }
    if (incoming.isEmpty()) {
      return result;
    }

    Map<String, List<Id>> existingIds = findExistingIds(incoming.keySet());
    List<CC_Message_Metadata__c> toInsert = new List<CC_Message_Metadata__c>();
    List<CC_Message_Metadata__c> toUpdate = new List<CC_Message_Metadata__c>();
    for (String key : incoming.keySet()) {
      CC_Message_Metadata__c rec = incoming.get(key);
      List<Id> matches = existingIds.get(key);
      if (matches == null || matches.isEmpty()) {
        toInsert.add(rec);
        continue;
      }
      rec.Id = matches[0];
      toUpdate.add(rec);
      for (Integer index = 1; index < matches.size(); index++) {
        CC_Message_Metadata__c duplicate = rec.clone(false, true, false, false);
        duplicate.Id = matches[index];
        duplicate.Message_Variant_Id__c = null;
        toUpdate.add(duplicate);
      }
    }
    applyDml(toInsert, true, result);
    applyDml(toUpdate, false, result);
    return result;
  }

  public static CcMirrorService.OpResult deleteRows(
    List<Map<String, Object>> keys,
    CcMirrorService.OpResult result
  ) {
    if (keys == null || keys.isEmpty()) {
      result.errors.add('delete requires keys[] with MessageVariantId.');
      result.failed = 1;
      return result;
    }
    result.requested = keys.size();

    Set<String> variantIds = new Set<String>();
    for (Map<String, Object> keyRow : keys) {
      String variantId = lowerCaseRow(keyRow).get('messagevariantid');
      if (String.isNotBlank(variantId)) {
        variantIds.add(variantId.trim().toLowerCase());
      }
    }
    if (variantIds.isEmpty()) {
      result.errors.add('No delete keys resolved.');
      result.failed = keys.size();
      return result;
    }

    List<Id> recordIds = new List<Id>();
    for (List<Id> ids : findExistingIds(variantIds).values()) {
      recordIds.addAll(ids);
    }
    if (recordIds.isEmpty()) {
      result.success = keys.size();
      return result;
    }

    Database.DeleteResult[] deleted = Database.delete(recordIds, false);
    for (Integer i = 0; i < deleted.size(); i++) {
      if (deleted[i].isSuccess()) {
        result.success++;
        continue;
      }
      result.failed++;
      result.errors.add('Delete row ' + i + ': ' + firstError(deleted[i].getErrors()));
    }
    return result;
  }

  private static Map<String, List<Id>> findExistingIds(Set<String> keys) {
    Map<String, List<Id>> existingIds = new Map<String, List<Id>>();
    List<String> keyList = new List<String>(keys);
    for (Integer start = 0; start < keyList.size(); start += 200) {
      List<String> chunk = new List<String>();
      for (Integer index = start; index < Math.min(start + 200, keyList.size()); index++) {
        chunk.add(keyList[index]);
      }
      for (CC_Message_Metadata__c existing : [
        SELECT Id, MessageVariantId__c, Message_Variant_Id__c
        FROM CC_Message_Metadata__c
        WHERE MessageVariantId__c IN :chunk OR Message_Variant_Id__c IN :chunk
        ORDER BY CreatedDate ASC
      ]) {
        String raw = String.isNotBlank(existing.MessageVariantId__c)
          ? existing.MessageVariantId__c
          : existing.Message_Variant_Id__c;
        if (String.isBlank(raw)) {
          continue;
        }
        String key = raw.trim().toLowerCase();
        if (!existingIds.containsKey(key)) {
          existingIds.put(key, new List<Id>());
        }
        existingIds.get(key).add(existing.Id);
      }
    }
    return existingIds;
  }

  private static void applyDml(
    List<CC_Message_Metadata__c> records,
    Boolean isInsert,
    CcMirrorService.OpResult result
  ) {
    if (records.isEmpty()) {
      return;
    }
    List<Database.SaveResult> saved = isInsert
      ? Database.insert(records, false)
      : Database.update(records, false);
    for (Integer i = 0; i < saved.size(); i++) {
      if (saved[i].isSuccess()) {
        result.success++;
        continue;
      }
      result.failed++;
      result.errors.add(
        (isInsert ? 'Insert' : 'Update') + ' row ' + i + ': ' + firstError(saved[i].getErrors())
      );
    }
  }

  private static String firstError(List<Database.Error> errors) {
    if (errors == null || errors.isEmpty()) {
      return 'Unknown error';
    }
    return errors[0].getStatusCode() + ': ' + errors[0].getMessage();
  }

  private static Map<String, String> lowerCaseRow(Map<String, Object> source) {
    Map<String, String> row = new Map<String, String>();
    if (source == null) {
      return row;
    }
    for (String key : source.keySet()) {
      Object value = source.get(key);
      if (value == null) {
        continue;
      }
      row.put(key.toLowerCase(), value instanceof String ? (String) value : String.valueOf(value));
    }
    return row;
  }

  private static CC_Message_Metadata__c toRecord(Map<String, String> row, String variantId) {
    CC_Message_Metadata__c rec = new CC_Message_Metadata__c();
    rec.MessageVariantId__c = variantId;
    rec.Message_Variant_Id__c = variantId;
    putText(rec, 'Name', firstFilled(row, new List<String>{ 'messagename', 'messagevariantid' }), 80);
    putText(rec, 'MessageName__c', row.get('messagename'), 255);
    putText(rec, 'MessageType__c', row.get('messagetype'), 255);
    putText(rec, 'Message_Type__c', row.get('messagetype'), 100);
    putText(rec, 'Channel_Type__c', cockpitChannelType(row.get('messagetype')), 100);
    String channelName = row.get('channelname');
    if (String.isBlank(channelName)) {
      channelName = cockpitChannelType(row.get('messagetype'));
    }
    putText(rec, 'Channel__c', channelName, 100);
    putText(rec, 'Subject__c', row.get('subject'), 255);
    putText(rec, 'Body__c', row.get('body'), 131072);
    putText(rec, 'CampaignId__c', row.get('campaignid'), 255);
    putText(rec, 'MCE_Campaign_Id__c', row.get('campaignid'), 255);
    putText(rec, 'ContentBuilderMessagePath__c', row.get('contentbuildermessagepath'), 255);
    putText(rec, 'Content_Builder_Message_Path__c', row.get('contentbuildermessagepath'), 255);
    putText(rec, 'Content_Builder_Message_Id__c', row.get('contentbuildermessageid'), 255);
    putText(rec, 'CurrentMessageVariantVersionId__c', row.get('currentmessagevariantversionid'), 255);
    putText(rec, 'Current_Message_Variant_Version_Id__c', row.get('currentmessagevariantversionid'), 255);
    putText(rec, 'LastModifiedBy__c', row.get('lastmodifiedby'), 255);
    putText(rec, 'MCE_Last_Modified_By__c', row.get('lastmodifiedby'), 255);
    putText(rec, 'MessagePropertiesJSON__c', row.get('messagepropertiesjson'), 131072);
    putText(rec, 'Message_Properties_JSON__c', row.get('messagepropertiesjson'), 131072);
    putText(rec, 'MessagePropertiesJSON2__c', row.get('messagepropertiesjson2'), 131072);
    putText(rec, 'Message_Properties_JSON2__c', row.get('messagepropertiesjson2'), 131072);
    putText(rec, 'Message_Variant__c', row.get('messagevariant'), 255);
    putText(rec, 'ScheduledAction__c', row.get('scheduledaction'), 255);
    putText(rec, 'Scheduled_Action__c', row.get('scheduledaction'), 100);
    putText(rec, 'ScheduledAtLocal__c', row.get('scheduledatlocal'), 255);
    putText(rec, 'Scheduled_At_Local__c', row.get('scheduledatlocal'), 50);
    putText(rec, 'ScheduledChangeId__c', row.get('scheduledchangeid'), 255);
    putText(rec, 'Scheduled_Change_Id__c', row.get('scheduledchangeid'), 255);
    putText(rec, 'ScheduledFromStatus__c', row.get('scheduledfromstatus'), 255);
    putText(rec, 'Scheduled_From_Status__c', row.get('scheduledfromstatus'), 100);
    putText(rec, 'ScheduledNote__c', row.get('schedulednote'), 255);
    putText(rec, 'Scheduled_Note__c', row.get('schedulednote'), 255);
    putText(rec, 'ScheduledStatus__c', row.get('scheduledstatus'), 255);
    putText(rec, 'Scheduled_Status__c', row.get('scheduledstatus'), 100);
    putText(rec, 'ScheduledToStatus__c', row.get('scheduledtostatus'), 255);
    putText(rec, 'Scheduled_To_Status__c', row.get('scheduledtostatus'), 100);
    putText(rec, 'TopicGoalId__c', row.get('topicgoalid'), 255);
    putText(rec, 'Topic_Goal_Id__c', row.get('topicgoalid'), 255);
    putText(rec, 'VariantStatus__c', row.get('variantstatus'), 255);
    putLanguage(rec, row.get('language'));
    putBoolean(rec, 'IsActive__c', row.get('isactive'));
    putBoolean(rec, 'Is_Active__c', row.get('isactive'));
    putBoolean(rec, 'StagedOnly__c', row.get('stagedonly'));
    putBoolean(rec, 'Staged_Only__c', row.get('stagedonly'));
    putNumber(rec, 'BlockCount__c', row.get('blockcount'));
    putNumber(rec, 'Block_Count__c', row.get('blockcount'));
    putNumber(rec, 'ContentBuilderMessageId__c', row.get('contentbuildermessageid'));
    putNumber(rec, 'MessageVariant__c', row.get('messagevariant'));
    // Copy Center shows Version__c (label "Variant"). MCE stores that number in MessageVariant.
    putNumber(rec, 'Version__c', firstFilled(row, new List<String>{ 'messagevariant', 'version' }));
    putProbability(rec, row.get('displayprobability'));
    putProbabilityManual(rec, row.get('displayprobabilitymanual'));
    putDatetime(rec, 'CancelledAt__c', row.get('cancelledat'));
    putDatetime(rec, 'Cancelled_At__c', row.get('cancelledat'));
    putDatetime(rec, 'CreatedAt__c', row.get('createdat'));
    putDatetime(rec, 'MCE_Created_At__c', row.get('createdat'));
    putDatetime(rec, 'DeactivatedAt__c', row.get('deactivatedat'));
    putDatetime(rec, 'Deactivated_At__c', row.get('deactivatedat'));
    putDatetime(rec, 'LastModifiedAt__c', row.get('lastmodifiedat'));
    putDatetime(rec, 'PublishedAt__c', row.get('publishedat'));
    putDatetime(rec, 'Published_At__c', row.get('publishedat'));
    putDatetime(rec, 'ScheduledAt__c', row.get('scheduledat'));
    putDatetime(rec, 'Scheduled_At__c', row.get('scheduledat'));
    putDatetime(rec, 'ScheduledCancelledAt__c', row.get('scheduledcancelledat'));
    putDatetime(rec, 'Scheduled_Cancelled_At__c', row.get('scheduledcancelledat'));
    putDatetime(rec, 'ScheduledCreatedAt__c', row.get('scheduledcreatedat'));
    putDatetime(rec, 'Scheduled_Created_At__c', row.get('scheduledcreatedat'));
    putDatetime(rec, 'ScheduledUpdatedAt__c', row.get('scheduledupdatedat'));
    putDatetime(rec, 'Scheduled_Updated_At__c', row.get('scheduledupdatedat'));
    putDatetime(rec, 'UpdatedAt__c', row.get('updatedat'));
    putDatetime(rec, 'MCE_Updated_At__c', row.get('updatedat'));
    putDate(rec, 'Valid_From__c', row.get('validfrom'));
    putDate(rec, 'Valid_To__c', row.get('validto'));
    return rec;
  }

  private static String firstFilled(Map<String, String> row, List<String> keys) {
    for (String key : keys) {
      if (String.isNotBlank(row.get(key))) {
        return row.get(key);
      }
    }
    return null;
  }

  private static void putText(SObject rec, String field, String value, Integer maxLength) {
    if (String.isBlank(value)) {
      return;
    }
    rec.put(field, value.length() > maxLength ? value.substring(0, maxLength) : value);
  }

  private static void putLanguage(CC_Message_Metadata__c rec, String value) {
    if (String.isBlank(value)) {
      return;
    }
    String language = value.trim().toUpperCase();
    if (language == 'PL' || language == 'EN' || language == 'ES') {
      rec.Language__c = language;
    }
  }

  private static void putBoolean(SObject rec, String field, String value) {
    if (String.isBlank(value)) {
      return;
    }
    String normalized = value.trim().toLowerCase();
    if (normalized == 'true' || normalized == '1' || normalized == 'yes') {
      rec.put(field, true);
    } else if (normalized == 'false' || normalized == '0' || normalized == 'no') {
      rec.put(field, false);
    }
  }

  private static void putNumber(SObject rec, String field, String value) {
    Decimal parsed = parseDecimal(value);
    if (parsed != null) {
      rec.put(field, parsed);
    }
  }

  private static void putProbability(CC_Message_Metadata__c rec, String value) {
    Decimal parsed = parseDecimal(value);
    if (parsed == null) {
      return;
    }
    rec.DisplayProbability__c = parsed;
    Decimal scaled = parsed.setScale(4, System.RoundingMode.HALF_UP);
    if (scaled.abs() < 10) {
      rec.Display_Probability__c = scaled;
    }
  }

  private static void putProbabilityManual(CC_Message_Metadata__c rec, String value) {
    Decimal parsed = parseDecimal(value);
    if (parsed != null && parsed.abs() < 10) {
      rec.Display_Probability_Manual__c = parsed;
      return;
    }
    putBoolean(rec, 'DisplayProbabilityManual__c', value);
  }

  private static void putDatetime(SObject rec, String field, String value) {
    Datetime parsed = parseDatetime(value);
    if (parsed != null) {
      rec.put(field, parsed);
    }
  }

  private static void putDate(SObject rec, String field, String value) {
    if (String.isBlank(value)) {
      return;
    }
    Datetime parsed = parseDatetime(value);
    if (parsed != null) {
      rec.put(field, parsed.dateGmt());
      return;
    }
    try {
      rec.put(field, Date.valueOf(value.trim().substring(0, 10)));
    } catch (Exception ignored) {
      return;
    }
  }

  private static Decimal parseDecimal(String value) {
    if (String.isBlank(value)) {
      return null;
    }
    try {
      return Decimal.valueOf(value.trim().replace(',', ''));
    } catch (Exception ignored) {
      return null;
    }
  }

  private static Datetime parseDatetime(String value) {
    if (String.isBlank(value)) {
      return null;
    }
    String raw = value.trim();
    try {
      return (Datetime) JSON.deserialize('"' + raw + '"', Datetime.class);
    } catch (Exception ignored) {
      // Fall through to the Marketing Cloud rowset format.
    }
    try {
      String normalized = raw.replace('T', ' ').replace('Z', '');
      if (normalized.length() >= 19) {
        return Datetime.valueOfGmt(normalized.substring(0, 19));
      }
    } catch (Exception ignored) {
      // Fall through to month/day/year.
    }
    List<String> parts = raw.split(' ');
    if (parts.size() < 2) {
      return null;
    }
    List<String> dateParts = parts[0].split('/');
    List<String> timeParts = parts[1].split(':');
    if (dateParts.size() != 3 || timeParts.size() < 2) {
      return null;
    }
    try {
      Integer hour = Integer.valueOf(timeParts[0]);
      if (parts.size() > 2) {
        String meridiem = parts[2].trim().toUpperCase();
        if (meridiem == 'PM' && hour < 12) {
          hour += 12;
        } else if (meridiem == 'AM' && hour == 12) {
          hour = 0;
        }
      }
      return Datetime.newInstanceGmt(
        Integer.valueOf(dateParts[2]),
        Integer.valueOf(dateParts[0]),
        Integer.valueOf(dateParts[1]),
        hour,
        Integer.valueOf(timeParts[1]),
        timeParts.size() > 2 ? Integer.valueOf(timeParts[2]) : 0
      );
    } catch (Exception ignored) {
      return null;
    }
  }

  private static String cockpitChannelType(String messageType) {
    if (messageType != null && messageType.trim().equalsIgnoreCase('WebBanner')) {
      return 'Banner';
    }
    return messageType;
  }
}