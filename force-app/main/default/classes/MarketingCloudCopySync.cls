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

    // Overload to fix deployment dependency
    public static SyncResult syncAllWithMCE() {
        return syncAllWithMCE(15);
    }

    @AuraEnabled
    public static SyncResult syncAllWithMCE(Integer minutesBack) {
        try {
            MCE_Settings__mdt settings = loadSettings();
            String token = requestToken(settings);
            Map<String, Object> dataExtension = findDataExtension(settings, token);
            
            // Pass the minutesBack parameter to limit the rowset
            SyncResult result = fetchRows(settings, token, dataExtension, null, minutesBack); 
            
            // Initiate the block sync asynchronously, passing the same window
            syncBlocksAsync(null, minutesBack);
            
            return result;
        } catch (AuraHandledException ex) {
            throw ex;
        } catch (Exception ex) {
            throw auraError(ex.getMessage());
        }
    }

    /**
     * Pulls CC_Message_Metadata rows from MCE for specific MessageVariantId values only.
     */
    @AuraEnabled
    public static SyncResult syncVariantsWithMCE(List<String> messageVariantIds) {
        try {
            List<String> variantIds = normalizeVariantIds(messageVariantIds);
            if (variantIds.isEmpty()) {
                throw auraError('Select at least one variant with a Marketing Cloud variant id.');
            }
            if (variantIds.size() > 100) {
                throw auraError('Sync at most 100 variants at a time.');
            }

            MCE_Settings__mdt settings = loadSettings();
            String token = requestToken(settings);
            Map<String, Object> dataExtension = findDataExtension(settings, token);

            SyncResult result = new SyncResult();
            result.dataExtensionId = (String) dataExtension.get('id');
            result.dataExtensionName = (String) dataExtension.get('name');
            result.fetchedCount = 0;
            result.createdCount = 0;
            result.updatedCount = 0;
            result.failedCount = 0;
            result.skippedCount = 0;

            List<Map<String, String>> rows = new List<Map<String, String>>();
            for (String variantId : variantIds) {
                Map<String, String> row = fetchVariantRow(settings, token, variantId);
                if (row == null || row.isEmpty()) {
                    result.skippedCount++;
                    continue;
                }
                rows.add(row);
                result.fetchedCount++;
                if (result.latestMessageName == null) {
                    result.latestMessageName = row.get('messagename');
                    result.latestModifiedAt = row.get('lastmodifiedat');
                }
            }

            upsertRows(rows, result);
            syncBlocksForVariantsAsync(variantIds);
            return result;
        } catch (AuraHandledException ex) {
            throw ex;
        } catch (Exception ex) {
            throw auraError(ex.getMessage());
        }
    }

    @AuraEnabled
    public static SyncResult syncWithMCE(String channel, Integer minutesBack) {
        try {
            if (String.isBlank(channel)) {
                throw auraError('Select a channel before syncing from Marketing Cloud.');
            }
            MCE_Settings__mdt settings = loadSettings();
            String token = requestToken(settings);
            Map<String, Object> dataExtension = findDataExtension(settings, token);
            
            // Pass the parameter from the UI
            SyncResult result = fetchRows(settings, token, dataExtension, channel.trim(), minutesBack);
            
            // Initiate the block sync asynchronously
            syncBlocksAsync(channel.trim(), minutesBack);
            
            return result;
        } catch (AuraHandledException ex) {
            throw ex;
        } catch (Exception ex) {
            throw auraError(ex.getMessage());
        }
    }
    @AuraEnabled
    public static void deleteVariantsFromMCE(List<String> variantIds) {
        try {
            if (variantIds == null || variantIds.isEmpty()) {
                return;
            }
            
            MCE_Settings__mdt settings = loadSettings();
            String token = requestToken(settings);

            // Apex allows up to 100 synchronous callouts per transaction.
            // For standard LWC UI deletions, this loop is perfectly safe.
            for (String variantId : variantIds) {
                if (String.isBlank(variantId)) continue;
                
                // MCE REST API format for targeting a Data Extension row by primary key
                String endpoint = 'https://' + settings.Subdomain__c
                    + '.rest.marketingcloudapis.com/data/v1/customobjectdata/key/'
                    + EncodingUtil.urlEncode(settings.Data_Extension_Key__c, 'UTF-8')
                    + '/row/MessageVariantId:' + EncodingUtil.urlEncode(variantId, 'UTF-8');

                HttpRequest req = new HttpRequest();
                req.setMethod('DELETE');
                req.setEndpoint(endpoint);
                req.setHeader('Authorization', 'Bearer ' + token);
                req.setTimeout(120000);

                HttpResponse res = new Http().send(req);
                
                // 200-level codes are success. 
                // We also intentionally ignore 404s (if the row doesn't exist in MCE anymore, our job is already done).
                if (res.getStatusCode() >= 300 && res.getStatusCode() != 404) {
                    throw auraError('Failed to delete variant ' + variantId + ' from MCE (' + res.getStatusCode() + '): ' + res.getBody());
                }
            }
        } catch (AuraHandledException ex) {
            throw ex;
        } catch (Exception ex) {
            throw auraError(ex.getMessage());
        }
    }

    @future(callout=true)
    public static void syncBlocksForVariantsAsync(List<String> variantIds) {
        try {
            List<String> ids = normalizeVariantIds(variantIds);
            if (ids.isEmpty()) {
                return;
            }
            MCE_Settings__mdt settings = loadSettings();
            String token = requestToken(settings);

            String endpoint = 'https://' + settings.Subdomain__c
                + '.rest.marketingcloudapis.com/data/v1/customobjects?$search=CC_Message_Blocks_All';
            Map<String, Object> body = send(authorizedGet(endpoint, token));

            List<Object> items = (List<Object>) body.get('items');
            if (items == null || items.isEmpty()) {
                return;
            }
            Map<String, Object> first = (Map<String, Object>) items[0];
            String deId = (String) first.get('id');
            if (String.isBlank(deId)) {
                return;
            }

            List<Map<String, String>> blockRows = new List<Map<String, String>>();
            for (String variantId : ids) {
                blockRows.addAll(fetchBlockRowsForVariant(settings, token, deId, variantId));
            }
            upsertBlockRows(blockRows);
        } catch (Exception ex) {
            System.debug('Error in syncBlocksForVariantsAsync: ' + ex.getMessage());
        }
    }

    @future(callout=true)
    public static void deleteVariantsFromMCEAsync(List<String> variantIds) {
        try {
            if (variantIds == null || variantIds.isEmpty()) {
                return;
            }
            
            MCE_Settings__mdt settings = loadSettings(); //[cite: 3]
            String token = requestToken(settings); //[cite: 3]

            // Note: @future methods allow up to 100 callouts per transaction.
            for (String variantId : variantIds) {
                if (String.isBlank(variantId)) continue;
                
                String endpoint = 'https://' + settings.Subdomain__c //[cite: 3]
                    + '.rest.marketingcloudapis.com/data/v1/customobjectdata/key/'
                    + EncodingUtil.urlEncode(settings.Data_Extension_Key__c, 'UTF-8') //[cite: 3]
                    + '/row/MessageVariantId:' + EncodingUtil.urlEncode(variantId, 'UTF-8');

                HttpRequest req = new HttpRequest();
                req.setMethod('DELETE');
                req.setEndpoint(endpoint);
                req.setHeader('Authorization', 'Bearer ' + token);
                req.setTimeout(120000);

                HttpResponse res = new Http().send(req);
                
                // 200-level codes indicate success. 404 means it's already gone.
                if (res.getStatusCode() >= 300 && res.getStatusCode() != 404) {
                    System.debug('Failed to delete variant ' + variantId + ' from MCE (' + res.getStatusCode() + '): ' + res.getBody());
                }
            }
        } catch (Exception ex) {
            System.debug('Error in MCE Delete Async: ' + ex.getMessage());
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

    private static List<String> normalizeVariantIds(List<String> messageVariantIds) {
        List<String> cleaned = new List<String>();
        Set<String> seen = new Set<String>();
        if (messageVariantIds == null) {
            return cleaned;
        }
        for (String raw : messageVariantIds) {
            if (String.isBlank(raw)) {
                continue;
            }
            String id = raw.trim();
            String key = id.toLowerCase();
            if (seen.contains(key)) {
                continue;
            }
            seen.add(key);
            cleaned.add(id);
        }
        return cleaned;
    }

    private static Map<String, String> fetchVariantRow(
        MCE_Settings__mdt settings,
        String token,
        String variantId
    ) {
        String endpoint = 'https://' + settings.Subdomain__c
            + '.rest.marketingcloudapis.com/data/v1/customobjectdata/key/'
            + EncodingUtil.urlEncode(settings.Data_Extension_Key__c, 'UTF-8')
            + '/row/MessageVariantId:' + EncodingUtil.urlEncode(variantId, 'UTF-8');

        HttpResponse res = new Http().send(authorizedGet(endpoint, token));
        if (res.getStatusCode() == 404) {
            return null;
        }
        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            throw auraError(
                'Failed to load variant ' + variantId + ' from MCE (' + res.getStatusCode() + ').'
            );
        }
        Object parsed = JSON.deserializeUntyped(res.getBody());
        if (!(parsed instanceof Map<String, Object>)) {
            return null;
        }
        return flattenRow((Map<String, Object>) parsed);
    }

    private static List<Map<String, String>> fetchBlockRowsForVariant(
        MCE_Settings__mdt settings,
        String token,
        String dataExtensionId,
        String variantId
    ) {
        List<Map<String, String>> rows = new List<Map<String, String>>();
        Integer page = 1;
        while (page <= MAX_PAGES) {
            String endpoint = 'https://' + settings.Subdomain__c
                + '.rest.marketingcloudapis.com/data/v1/customobjectdata/'
                + dataExtensionId
                + '/rowset?$page=' + page
                + '&$pageSize=' + PAGE_SIZE
                + '&$orderBy=updatedat%20DESC'
                + '&$filter=' + messageVariantIdFilter(variantId);

            Map<String, Object> body = send(authorizedGet(endpoint, token));
            List<Object> items = (List<Object>) body.get('items');
            List<Object> pageItems = items == null ? new List<Object>() : items;
            for (Object itemValue : pageItems) {
                rows.add(flattenRow((Map<String, Object>) itemValue));
            }
            if (pageItems.size() < PAGE_SIZE) {
                break;
            }
            page++;
        }
        return rows;
    }

    private static String messageVariantIdFilter(String variantId) {
        String value = variantId.replace('\'', '\'\'');
        return 'MessageVariantId%20eq%20%27'
            + EncodingUtil.urlEncode(value, 'UTF-8').replace('+', '%20')
            + '%27';
    }

    private static SyncResult fetchRows(
        MCE_Settings__mdt settings,
        String token,
        Map<String, Object> dataExtension,
        String channel,
        Integer minutesBack
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
        Datetime cutoffTime = null;
        Boolean stopFetching = false;

        while (page <= MAX_PAGES) {
            String endpoint = 'https://' + settings.Subdomain__c
                + '.rest.marketingcloudapis.com/data/v1/customobjectdata/'
                + dataExtensionId
                + '/rowset?$page=' + page
                + '&$pageSize=' + PAGE_SIZE
                + '&$orderBy=' + ORDER_BY;
                
            if (String.isNotBlank(channel)) {
                endpoint += '&$filter=' + messageTypeFilter(channel);
            }

            Map<String, Object> body = send(authorizedGet(endpoint, token));
            List<Object> items = (List<Object>) body.get('items');
            List<Object> pageItems = items == null ? new List<Object>() : items;
            
            if (result.rowCount == null) {
                result.rowCount = toInteger(body.get('count'));
            }
            
            for (Object itemValue : pageItems) {
                if (rows.size() >= 10000) {
                    stopFetching = true;
                    break;
                }
                
                Map<String, String> row = flattenRow((Map<String, Object>) itemValue);
                
                // If a time limit is set, check the timestamp
                if (minutesBack != null) {
                    String modStr = row.get('lastmodifiedat');
                    if (String.isNotBlank(modStr)) {
                        Datetime rowTime = parseDatetime(modStr);
                        if (rowTime != null) {
                            // Set the cutoff relative to the very first (newest) record we process
                            if (cutoffTime == null) {
                                cutoffTime = rowTime.addMinutes(-minutesBack);
                            }
                            // If this row is older than the cutoff, we can safely stop fetching everything
                            if (rowTime < cutoffTime) {
                                stopFetching = true;
                                break;
                            }
                        }
                    }
                }
                rows.add(row);
            }
            
            if (pageItems.size() > 0 && result.latestMessageName == null && !rows.isEmpty()) {
                result.latestMessageName = rows[0].get('messagename');
                result.latestModifiedAt = rows[0].get('lastmodifiedat');
            }
            
            result.fetchedCount += pageItems.size(); // Note: counts raw fetched, not just what passed the cutoff
            
            if (stopFetching || pageItems.size() < PAGE_SIZE || (result.rowCount != null && result.fetchedCount >= result.rowCount)) {
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
        String value = dataExtensionMessageType(channel).replace('\'', '\'\'');
        return 'MessageType%20eq%20%27'
            + EncodingUtil.urlEncode(value, 'UTF-8').replace('+', '%20')
            + '%27';
    }

    private static String dataExtensionMessageType(String channel) {
        if (channel != null && channel.trim().equalsIgnoreCase('Banner')) {
            return 'WebBanner';
        }
        return channel;
    }

    private static String cockpitChannelType(String messageType) {
        if (messageType != null && messageType.trim().equalsIgnoreCase('WebBanner')) {
            return 'Banner';
        }
        return messageType;
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

    // ──────────────────────────────────────────────────────────────────────────
    // BLOCKS DATA EXTENSION SYNC
    // ──────────────────────────────────────────────────────────────────────────

    @future(callout=true)
    public static void syncBlocksAsync(String channel, Integer minutesBack) {
        try {
            MCE_Settings__mdt settings = loadSettings();
            String token = requestToken(settings);
            
            String endpoint = 'https://' + settings.Subdomain__c
                + '.rest.marketingcloudapis.com/data/v1/customobjects?$search=CC_Message_Blocks_All';
            Map<String, Object> body = send(authorizedGet(endpoint, token));
            
            List<Object> items = (List<Object>) body.get('items');
            if (items == null || items.isEmpty()) return;
            
            Map<String, Object> first = (Map<String, Object>) items[0];
            String deId = (String) first.get('id');
            if (String.isBlank(deId)) return;
            
            fetchBlockRows(settings, token, deId, channel, minutesBack);
        } catch (Exception ex) {
            System.debug('Error in syncBlocksAsync: ' + ex.getMessage());
        }
    }

    private static void fetchBlockRows(MCE_Settings__mdt settings, String token, String dataExtensionId, String channel, Integer minutesBack) {
        List<Map<String, String>> rows = new List<Map<String, String>>();
        Integer page = 1;
        Datetime cutoffTime = null;
        Boolean stopFetching = false;
        
        while (page <= MAX_PAGES) {
            String endpoint = 'https://' + settings.Subdomain__c
                + '.rest.marketingcloudapis.com/data/v1/customobjectdata/'
                + dataExtensionId
                + '/rowset?$page=' + page
                + '&$pageSize=' + PAGE_SIZE
                + '&$orderBy=updatedat%20DESC';
                
            if (String.isNotBlank(channel)) {
                endpoint += '&$filter=' + messageTypeFilter(channel);
            }
            
            Map<String, Object> body = send(authorizedGet(endpoint, token));
            List<Object> items = (List<Object>) body.get('items');
            List<Object> pageItems = items == null ? new List<Object>() : items;
            
            for (Object itemValue : pageItems) {
                if (rows.size() >= 10000) {
                    stopFetching = true;
                    break;
                }
                
                Map<String, String> row = flattenRow((Map<String, Object>) itemValue);
                
                if (minutesBack != null) {
                    // Note: Blocks DE uses updatedat, not lastmodifiedat
                    String modStr = row.get('updatedat'); 
                    if (String.isNotBlank(modStr)) {
                        Datetime rowTime = parseDatetime(modStr);
                        if (rowTime != null) {
                            if (cutoffTime == null) {
                                cutoffTime = rowTime.addMinutes(-minutesBack);
                            }
                            if (rowTime < cutoffTime) {
                                stopFetching = true;
                                break;
                            }
                        }
                    }
                }
                rows.add(row);
            }
            
            if (stopFetching || pageItems.size() < PAGE_SIZE) {
                break;
            }
            page++;
        }
        upsertBlockRows(rows);
    }

    private static void upsertBlockRows(List<Map<String, String>> rows) {
        Map<String, CC_Message_Blocks_All__c> incoming = new Map<String, CC_Message_Blocks_All__c>();
        
        for (Map<String, String> row : rows) {
            String variantId = row.get('messagevariantid');
            String orderStr = row.get('contentblockorder');
            
            if (String.isBlank(variantId) || String.isBlank(orderStr)) {
                continue;
            }
            
            // Build a composite key for matching: "variantId|order"
            String compositeKey = (variantId.trim() + '|' + orderStr.trim()).toLowerCase();
            incoming.put(compositeKey, toBlockRecord(row));
        }
        
        Map<String, Id> existingIds = findExistingBlockIds(incoming.keySet());
        List<CC_Message_Blocks_All__c> toInsert = new List<CC_Message_Blocks_All__c>();
        List<CC_Message_Blocks_All__c> toUpdate = new List<CC_Message_Blocks_All__c>();
        
        for (String key : incoming.keySet()) {
            CC_Message_Blocks_All__c rec = incoming.get(key);
            if (existingIds.containsKey(key)) {
                rec.Id = existingIds.get(key);
                toUpdate.add(rec);
            } else {
                toInsert.add(rec);
            }
        }
        
        if (!toInsert.isEmpty()) Database.insert(toInsert, false);
        if (!toUpdate.isEmpty()) Database.update(toUpdate, false);
    }

    private static Map<String, Id> findExistingBlockIds(Set<String> keys) {
        Map<String, Id> existingIds = new Map<String, Id>();
        if (keys.isEmpty()) return existingIds;
        
        // Extract just the variant IDs to limit our SOQL query size
        Set<String> variantIds = new Set<String>();
        for (String key : keys) {
            variantIds.add(key.substringBefore('|'));
        }
        
        List<String> variantIdList = new List<String>(variantIds);
        for (Integer start = 0; start < variantIdList.size(); start += 200) {
            Integer last = Math.min(start + 200, variantIdList.size());
            List<String> chunk = new List<String>();
            for (Integer index = start; index < last; index++) {
                chunk.add(variantIdList[index]);
            }
            
            for (CC_Message_Blocks_All__c existing : [
                SELECT Id, MessageVariantId__c, ContentBlockOrder__c
                FROM CC_Message_Blocks_All__c
                WHERE MessageVariantId__c IN :chunk
            ]) {
                if (String.isBlank(existing.MessageVariantId__c) || existing.ContentBlockOrder__c == null) {
                    continue;
                }
                // Reconstruct the composite key from the existing record to find a match
                String key = (existing.MessageVariantId__c.trim() + '|' + existing.ContentBlockOrder__c.longValue()).toLowerCase();
                existingIds.put(key, existing.Id);
            }
        }
        return existingIds;
    }

    private static CC_Message_Blocks_All__c toBlockRecord(Map<String, String> row) {
        CC_Message_Blocks_All__c rec = new CC_Message_Blocks_All__c();
        String variantId = row.get('messagevariantid');
        String orderStr = row.get('contentblockorder');
        
        rec.MessageVariantId__c = variantId;
        putNumber(rec, 'ContentBlockOrder__c', orderStr);
        
        // Fallback for Name field to ensure standard field is populated
        putText(rec, 'Name', variantId + '-' + orderStr, 80); 
        
        putText(rec, 'MessageName__c', row.get('messagename'), 255);
        putText(rec, 'MessageType__c', row.get('messagetype'), 255);
        putText(rec, 'BlockType__c', row.get('blocktype'), 255);
        putText(rec, 'ContentBlockPath__c', row.get('contentblockpath'), 255);
        putText(rec, 'ContentBuilderAssetId__c', row.get('contentbuilderassetid'), 255);
        putText(rec, 'ContentJson__c', row.get('contentjson'), 131072);
        putText(rec, 'ContentJsonPart2__c', row.get('contentjsonpart2'), 131072);
        putNumber(rec, 'MessageVariant__c', row.get('messagevariant'));
        
        return rec;
    }

}