/**
 * Reads CC_Message_Metadata from Marketing Cloud for the Copy Center sync button.
 * This step confirms the lookup and row fetch. It does not write Core records yet.
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
            Integer pageCount = items == null ? 0 : items.size();
            if (result.rowCount == null) {
                result.rowCount = toInteger(body.get('count'));
            }
            if (pageCount > 0 && result.latestMessageName == null) {
                Map<String, Object> values = (Map<String, Object>) ((Map<String, Object>) items[0]).get('values');
                if (values != null) {
                    result.latestMessageName = (String) values.get('messagename');
                    result.latestModifiedAt = (String) values.get('lastmodifiedat');
                }
            }
            result.fetchedCount += pageCount;
            if (pageCount < PAGE_SIZE || (result.rowCount != null && result.fetchedCount >= result.rowCount)) {
                break;
            }
            page++;
        }
        if (result.rowCount == null) {
            result.rowCount = result.fetchedCount;
        }
        return result;
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
