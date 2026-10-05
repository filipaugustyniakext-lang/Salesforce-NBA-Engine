/**
 * Reads one channel from the CC_Message_Metadata data extension and upserts
 * those rows onto CC_Message_Metadata__c by MessageVariantId.
 */
public with sharing class MarketingCloudCopySync {
    private static final Integer PAGE_SIZE = 2500;
    private static final Integer MAX_PAGES = 20;
    private static final String ORDER_BY = 'LastModifiedAt%20DESC';

    @TestVisible
    private static MCE_Settings__mdt settingsOverride;

    public class SyncResult {
        @AuraEnabled public String dataExtensionId;
        @AuraEnabled public String dataExtensionName;
        @AuraEnabled public Integer rowCount;
        @AuraEnabled public Integer fetchedCount;
        @AuraEnabled public String channel;
        @AuraEnabled public String latestMessageName;
        @AuraEnabled public String latestModifiedAt;
        @AuraEnabled public Integer createdCount;
        @AuraEnabled public Integer updatedCount;
        @AuraEnabled public Integer failedCount;
        @AuraEnabled public Integer skippedCount;
        @AuraEnabled public String errorMessage;
    }

    @AuraEnabled
    public static SyncResult syncFromMce(String channel) {
        try {
            if (String.isBlank(channel)) {
                throw auraError('Select a channel before syncing from Marketing Cloud.');
            }
            MCE_Settings__mdt settings = loadSettings();
            String token = requestToken(settings);
            Map<String, Object> dataExtension = findDataExtension(settings, token);
            return fetchRows(settings, token, dataExtension, channel.trim());
        } catch (AuraHandledException ex) {
            throw ex;
        } catch (Exception ex) {
            throw auraError(ex.getMessage());
        }
    }

    private static MCE_Settings__mdt loadSettings() {
        if (settingsOverride != null) {
            return settingsOverride;
        }
        List<MCE_Settings__mdt> rows = [
            SELECT Subdomain__c, Client_Id__c, Client_Secret__c, Account_Id__c, Data_Extension_Key__c
            FROM MCE_Settings__mdt
            WHERE DeveloperName = 'Default'
            LIMIT 1
        ];
        if (rows.isEmpty()) {
            throw auraError('Marketing Cloud settings are not configured.');
        }
        MCE_Settings__mdt settings = rows[0];
        if (String.isBlank(settings.Subdomain__c)
            || String.isBlank(settings.Client_Id__c)
            || String.isBlank(settings.Client_Secret__c)
            || String.isBlank(settings.Account_Id__c)
            || String.isBlank(settings.Data_Extension_Key__c)) {
            throw auraError('Marketing Cloud settings are incomplete.');
        }
        return settings;
    }

    private static String requestToken(MCE_Settings__mdt settings) {
        HttpRequest req = new HttpRequest();
        req.setMethod('POST');
        req.setEndpoint('https://' + settings.Subdomain__c + '.auth.marketingcloudapis.com/v2/token');
        req.setHeader('Content-Type', 'application/json');
        req.setTimeout(120000);
        req.setBody(JSON.serialize(new Map<String, String>{
            'grant_type' => 'client_credentials',
            'client_id' => settings.Client_Id__c,
            'client_secret' => settings.Client_Secret__c,
            'account_id' => settings.Account_Id__c
        }));
        Map<String, Object> body = send(req);
        String token = (String) body.get('access_token');
        if (String.isBlank(token)) {
            throw auraError('Marketing Cloud did not return an access token.');
        }
        return token;
    }

    private static Map<String, Object> findDataExtension(MCE_Settings__mdt settings, String token) {
        String endpoint = 'https://' + settings.Subdomain__c
            + '.rest.marketingcloudapis.com/data/v1/customobjects?$search='
            + EncodingUtil.urlEncode(settings.Data_Extension_Key__c, 'UTF-8');
        Map<String, Object> body = send(authorizedGet(endpoint, token));
        List<Object> items = (List<Object>) body.get('items');
        if (items == null || items.isEmpty()) {
            throw auraError('Data extension ' + settings.Data_Extension_Key__c + ' was not found.');
        }
        Map<String, Object> first = (Map<String, Object>) items[0];
        if (String.isBlank((String) first.get('id'))) {
            throw auraError('Data extension ' + settings.Data_Extension_Key__c + ' did not include an id.');
        }
        return first;
    }

    private static SyncResult fetchRows(
        MCE_Settings__mdt settings,
        String token,
        Map<String, Object> dataExtension,
        String channel
    ) {
        String dataExtensionId = (String) dataExtension.get('id');
        SyncResult result = new SyncResult();
        result.dataExtensionId = dataExtensionId;
        result.dataExtensionName = (String) dataExtension.get('name');
        result.channel = channel;
        result.fetchedCount = 0;
        result.createdCount = 0;
        result.updatedCount = 0;
        result.failedCount = 0;
        result.skippedCount = 0;

        List<Map<String, String>> rows = new List<Map<String, String>>();
        Integer page = 1;
        while (page <= MAX_PAGES) {
            String endpoint = 'https://' + settings.Subdomain__c
                + '.rest.marketingcloudapis.com/data/v1/customobjectdata/'
                + dataExtensionId
                + '/rowset?$filter=' + messageTypeFilter(channel)
                + '&$page=' + page
                + '&$pageSize=' + PAGE_SIZE
                + '&$orderBy=' + ORDER_BY;
            Map<String, Object> body = send(authorizedGet(endpoint, token));
            List<Object> items = (List<Object>) body.get('items');
            List<Object> pageItems = items == null ? new List<Object>() : items;
            Integer pageCount = pageItems.size();
            if (result.rowCount == null) {
                result.rowCount = toInteger(body.get('count'));
            }
            for (Object itemValue : pageItems) {
                if (rows.size() >= 10000) {
                    break;
                }
                rows.add(flattenRow((Map<String, Object>) itemValue));
            }
            if (pageCount > 0 && result.latestMessageName == null && !rows.isEmpty()) {
                result.latestMessageName = rows[0].get('messagename');
                result.latestModifiedAt = rows[0].get('lastmodifiedat');
            }
            result.fetchedCount += pageCount;
            if (rows.size() >= 10000
                || pageCount < PAGE_SIZE
                || (result.rowCount != null && result.fetchedCount >= result.rowCount)) {
                break;
            }
            page++;
        }
        if (result.rowCount == null) {
            result.rowCount = result.fetchedCount;
        }
        upsertRows(rows, result);
        return result;
    }

    private static void upsertRows(List<Map<String, String>> rows, SyncResult result) {
        Map<String, CC_Message_Metadata__c> incoming = new Map<String, CC_Message_Metadata__c>();
        for (Map<String, String> row : rows) {
            String variantId = row.get('messagevariantid');
            if (String.isBlank(variantId)) {
                result.skippedCount++;
                continue;
            }
            variantId = variantId.trim();
            incoming.put(variantId.toLowerCase(), toRecord(row, variantId));
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
                toUpdate.add(duplicate);
            }
        }
        result.createdCount = applyDml(toInsert, true, result);
        result.updatedCount = applyDml(toUpdate, false, result);
    }

    private static Map<String, List<Id>> findExistingIds(Set<String> keys) {
        Map<String, List<Id>> existingIds = new Map<String, List<Id>>();
        if (keys.isEmpty()) {
            return existingIds;
        }
        List<String> keyList = new List<String>(keys);
        for (Integer start = 0; start < keyList.size(); start += 200) {
            Integer last = Math.min(start + 200, keyList.size());
            List<String> chunk = new List<String>();
            for (Integer index = start; index < last; index++) {
                chunk.add(keyList[index]);
            }
            for (CC_Message_Metadata__c existing : [
                SELECT Id, MessageVariantId__c
                FROM CC_Message_Metadata__c
                WHERE MessageVariantId__c IN :chunk
            ]) {
                if (String.isBlank(existing.MessageVariantId__c)) {
                    continue;
                }
                String key = existing.MessageVariantId__c.toLowerCase();
                if (!existingIds.containsKey(key)) {
                    existingIds.put(key, new List<Id>());
                }
                existingIds.get(key).add(existing.Id);
            }
        }
        return existingIds;
    }

    private static Integer applyDml(List<CC_Message_Metadata__c> records, Boolean isInsert, SyncResult result) {
        if (records.isEmpty()) {
            return 0;
        }
        List<Database.SaveResult> saved = isInsert
            ? Database.insert(records, false)
            : Database.update(records, false);
        Integer successCount = 0;
        for (Database.SaveResult row : saved) {
            if (row.isSuccess()) {
                successCount++;
                continue;
            }
            result.failedCount++;
            if (result.errorMessage == null && !row.getErrors().isEmpty()) {
                result.errorMessage = row.getErrors()[0].getMessage();
            }
        }
        return successCount;
    }

    private static CC_Message_Metadata__c toRecord(Map<String, String> row, String variantId) {
        CC_Message_Metadata__c rec = new CC_Message_Metadata__c();
        rec.MessageVariantId__c = variantId;
        rec.Message_Variant_Id__c = variantId;
        putText(rec, 'Name', firstFilled(row, new List<String>{ 'messagename', 'messagevariantid' }), 80);
        putText(rec, 'MessageName__c', row.get('messagename'), 255);
        putText(rec, 'MessageType__c', row.get('messagetype'), 255);
        putText(rec, 'Message_Type__c', row.get('messagetype'), 100);
        putText(rec, 'Channel_Type__c', row.get('messagetype'), 100);
        putText(rec, 'Channel__c', firstFilled(row, new List<String>{ 'channelname', 'messagetype' }), 100);
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
        putNumber(rec, 'Version__c', row.get('version'));
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

    private static Map<String, String> flattenRow(Map<String, Object> item) {
        Map<String, String> row = new Map<String, String>();
        absorb(row, (Map<String, Object>) item.get('values'));
        absorb(row, (Map<String, Object>) item.get('keys'));
        return row;
    }

    private static void absorb(Map<String, String> row, Map<String, Object> source) {
        if (source == null) {
            return;
        }
        for (String key : source.keySet()) {
            Object value = source.get(key);
            if (value == null) {
                continue;
            }
            row.put(key.toLowerCase(), value instanceof String ? (String) value : String.valueOf(value));
        }
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

    private static String messageTypeFilter(String channel) {
        String value = channel.replace('\'', '\'\'');
        return 'MessageType%20eq%20%27'
            + EncodingUtil.urlEncode(value, 'UTF-8').replace('+', '%20')
            + '%27';
    }

    private static HttpRequest authorizedGet(String endpoint, String token) {
        HttpRequest req = new HttpRequest();
        req.setMethod('GET');
        req.setEndpoint(endpoint);
        req.setHeader('Authorization', 'Bearer ' + token);
        req.setTimeout(120000);
        return req;
    }

    private static Map<String, Object> send(HttpRequest req) {
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            throw auraError('Marketing Cloud call failed (' + res.getStatusCode() + ').');
        }
        Object parsed = JSON.deserializeUntyped(res.getBody());
        if (!(parsed instanceof Map<String, Object>)) {
            throw auraError('Marketing Cloud returned an unexpected response.');
        }
        return (Map<String, Object>) parsed;
    }

    private static Integer toInteger(Object value) {
        if (value == null) {
            return null;
        }
        return Integer.valueOf(String.valueOf(value));
    }

    private static AuraHandledException auraError(String message) {
        AuraHandledException ex = new AuraHandledException(message);
        ex.setMessage(message);
        return ex;
    }
}
