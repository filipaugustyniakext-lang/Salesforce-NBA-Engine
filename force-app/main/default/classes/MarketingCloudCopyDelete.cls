/**
 * Deletes CC_Message_Metadata and CC_Message_Blocks_All rows in SFMC after Copy Cockpit
 * removes Salesforce records. Uses REST rowset filters to resolve block keys, then SOAP Delete.
 */
public with sharing class MarketingCloudCopyDelete {
    private static final Integer VARIANT_ID_CHUNK = 25;
    private static final Integer SOAP_OBJECT_CHUNK = 200;
    private static final String BLOCKS_DE_KEY = 'CC_Message_Blocks_All';
    private static final String SOAP_NS = 'http://exacttarget.com/wsdl/partnerAPI';
    private static final String SOAP_ENV = 'http://www.w3.org/2003/05/soap-envelope';
    private static final String WS_ADDR = 'http://www.w3.org/2004/08/addressing';
    private static final String WS_SEC = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
    private static final String WS_SEC_EXT = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
    private static final String FUEL_OAUTH_NS = 'http://exacttarget.com';

    @TestVisible
    private static MCE_Settings__mdt settingsOverride;

    public static void enqueueVariantDeletes(List<String> messageVariantIds) {
        List<String> variantIds = normalizeVariantIds(messageVariantIds);
        if (variantIds.isEmpty()) {
            return;
        }
        System.enqueueJob(new MarketingCloudCopyDeleteQueueable(variantIds));
    }

    public static void deleteVariantsFromMce(List<String> messageVariantIds) {
        List<String> variantIds = normalizeVariantIds(messageVariantIds);
        if (variantIds.isEmpty()) {
            return;
        }
        try {
            MCE_Settings__mdt settings = loadSettings();
            String token = requestToken(settings);
            String metadataDeKey = settings.Data_Extension_Key__c;
            Map<String, Object> blocksDe = findDataExtensionByKey(settings, token, BLOCKS_DE_KEY);
            String blocksDeId = (String) blocksDe.get('id');

            deleteMetadataRowsSoap(settings, token, metadataDeKey, variantIds);
            deleteBlockRowsSoap(settings, token, blocksDeId, BLOCKS_DE_KEY, variantIds);
        } catch (Exception ex) {
            System.debug(LoggingLevel.WARN, 'MCE variant delete failed: ' + ex.getMessage());
        }
    }

    private static void deleteMetadataRowsSoap(
        MCE_Settings__mdt settings,
        String token,
        String customerKey,
        List<String> variantIds
    ) {
        List<String> soapObjects = new List<String>();
        for (String variantId : variantIds) {
            soapObjects.add(buildDataExtensionObjectDeleteXml(customerKey, buildMessageVariantKeys(variantId)));
        }
        sendSoapDeleteBatches(settings, token, soapObjects);
    }

    private static void deleteBlockRowsSoap(
        MCE_Settings__mdt settings,
        String token,
        String blocksDeId,
        String blocksCustomerKey,
        List<String> variantIds
    ) {
        List<String> soapObjects = new List<String>();
        for (Integer start = 0; start < variantIds.size(); start += VARIANT_ID_CHUNK) {
            Integer endIndex = Math.min(start + VARIANT_ID_CHUNK, variantIds.size());
            List<String> chunk = new List<String>();
            for (Integer i = start; i < endIndex; i++) {
                chunk.add(variantIds[i]);
            }
            List<Map<String, String>> rows = fetchRowsetByVariantIds(settings, token, blocksDeId, chunk, null);
            for (Map<String, String> row : rows) {
                String variantId = firstNonBlank(row, new List<String>{ 'messagevariantid' });
                String blockOrder = firstNonBlank(row, new List<String>{ 'contentblockorder' });
                if (String.isBlank(variantId)) {
                    continue;
                }
                List<Map<String, String>> keys = buildMessageVariantKeys(variantId);
                if (String.isNotBlank(blockOrder)) {
                    keys.add(keyEntry('ContentBlockOrder', blockOrder));
                }
                soapObjects.add(buildDataExtensionObjectDeleteXml(blocksCustomerKey, keys));
            }
        }
        if (soapObjects.isEmpty()) {
            return;
        }
        sendSoapDeleteBatches(settings, token, soapObjects);
    }

    private static void sendSoapDeleteBatches(
        MCE_Settings__mdt settings,
        String token,
        List<String> objectXmlFragments
    ) {
        for (Integer start = 0; start < objectXmlFragments.size(); start += SOAP_OBJECT_CHUNK) {
            Integer endIndex = Math.min(start + SOAP_OBJECT_CHUNK, objectXmlFragments.size());
            List<String> chunk = new List<String>();
            for (Integer i = start; i < endIndex; i++) {
                chunk.add(objectXmlFragments[i]);
            }
            sendSoapDelete(settings, token, chunk);
        }
    }

    private static void sendSoapDelete(MCE_Settings__mdt settings, String token, List<String> objectXmlFragments) {
        if (objectXmlFragments == null || objectXmlFragments.isEmpty()) {
            return;
        }
        String bodyObjects = String.join(objectXmlFragments, '');
        String envelope = ''
            + '<?xml version="1.0" encoding="UTF-8"?>'
            + '<s:Envelope xmlns:s="' + SOAP_ENV + '" xmlns:a="' + WS_ADDR + '" xmlns:u="' + WS_SEC + '">'
            + '<s:Header>'
            + '<a:Action s:mustUnderstand="1">Delete</a:Action>'
            + '<a:MessageID>urn:uuid:' + generateUuid() + '</a:MessageID>'
            + '<a:To s:mustUnderstand="1">https://' + escapeXml(settings.Subdomain__c) + '.soap.marketingcloudapis.com/Service.asmx</a:To>'
            + '<o:Security s:mustUnderstand="1" xmlns:o="' + WS_SEC_EXT + '">'
            + '<fueloauth xmlns="' + FUEL_OAUTH_NS + '">' + escapeXml(token) + '</fueloauth>'
            + '</o:Security>'
            + '</s:Header>'
            + '<s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">'
            + '<DeleteRequest xmlns="' + SOAP_NS + '">'
            + '<Options/>'
            + bodyObjects
            + '</DeleteRequest>'
            + '</s:Body>'
            + '</s:Envelope>';

        HttpRequest req = new HttpRequest();
        req.setMethod('POST');
        req.setEndpoint('https://' + settings.Subdomain__c + '.soap.marketingcloudapis.com/Service.asmx');
        req.setHeader('Content-Type', 'text/xml; charset=UTF-8');
        req.setHeader('SOAPAction', 'Delete');
        req.setTimeout(120000);
        req.setBody(envelope);
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            throw new CalloutException('SOAP Delete failed (' + res.getStatusCode() + '): ' + res.getBody());
        }
        String responseBody = res.getBody() == null ? '' : res.getBody();
        if (responseBody.contains('<OverallStatus>Error</OverallStatus>')
            || responseBody.contains('<OverallStatus>Has Error</OverallStatus>')) {
            throw new CalloutException('SOAP Delete returned errors: ' + responseBody.left(2000));
        }
    }

    private static String buildDataExtensionObjectDeleteXml(
        String customerKey,
        List<Map<String, String>> keys
    ) {
        String keysXml = '';
        for (Map<String, String> key : keys) {
            keysXml += '<Key><Name>' + escapeXml(key.get('name')) + '</Name><Value>' + escapeXml(key.get('value')) + '</Value></Key>';
        }
        return ''
            + '<Objects xsi:type="DataExtensionObject">'
            + '<CustomerKey>' + escapeXml(customerKey) + '</CustomerKey>'
            + '<Keys>' + keysXml + '</Keys>'
            + '</Objects>';
    }

    private static List<Map<String, String>> buildMessageVariantKeys(String variantId) {
        return new List<Map<String, String>>{
            keyEntry('MessageVariantId', variantId)
        };
    }

    private static Map<String, String> keyEntry(String name, String value) {
        return new Map<String, String>{ 'name' => name, 'value' => value };
    }

    private static List<Map<String, String>> fetchRowsetByVariantIds(
        MCE_Settings__mdt settings,
        String token,
        String dataExtensionId,
        List<String> variantIds,
        String orderByEncoded
    ) {
        List<Map<String, String>> rows = new List<Map<String, String>>();
        String filter = messageVariantIdsInFilter(variantIds);
        if (String.isBlank(filter)) {
            return rows;
        }
        Integer page = 1;
        while (page <= 20) {
            String endpoint = 'https://' + settings.Subdomain__c
                + '.rest.marketingcloudapis.com/data/v1/customobjectdata/'
                + dataExtensionId
                + '/rowset?$page=' + page
                + '&$pageSize=2500'
                + '&$filter=' + filter;
            if (String.isNotBlank(orderByEncoded)) {
                endpoint += '&$orderBy=' + orderByEncoded;
            }
            Map<String, Object> body = sendJson(authorizedGet(endpoint, token));
            List<Object> items = (List<Object>) body.get('items');
            List<Object> pageItems = items == null ? new List<Object>() : items;
            for (Object itemValue : pageItems) {
                rows.add(flattenRow((Map<String, Object>) itemValue));
            }
            if (pageItems.size() < 2500) {
                break;
            }
            page++;
        }
        return rows;
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

    private static String messageVariantIdsInFilter(List<String> variantIds) {
        List<String> quotedIds = new List<String>();
        for (String raw : variantIds) {
            if (String.isBlank(raw)) {
                continue;
            }
            String id = raw.trim().replace('\'', '\'\'');
            quotedIds.add('\'' + id + '\'');
        }
        if (quotedIds.isEmpty()) {
            return '';
        }
        return EncodingUtil.urlEncode(
            'MessageVariantId in (' + String.join(quotedIds, ', ') + ')',
            'UTF-8'
        ).replace('+', '%20');
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

    private static String firstNonBlank(Map<String, String> row, List<String> keys) {
        for (String key : keys) {
            if (String.isNotBlank(row.get(key))) {
                return row.get(key);
            }
        }
        return null;
    }

    private static MCE_Settings__mdt loadSettings() {
        if (settingsOverride != null) {
            return settingsOverride;
        }
        List<MCE_Settings__mdt> rows = [
            SELECT Client_Id__c, Client_Secret__c, Subdomain__c, Account_Id__c, Data_Extension_Key__c
            FROM MCE_Settings__mdt
            WHERE DeveloperName = 'Default'
            LIMIT 1
        ];
        if (rows.isEmpty()) {
            throw new CalloutException('Marketing Cloud settings are missing.');
        }
        MCE_Settings__mdt settings = rows[0];
        if (String.isBlank(settings.Client_Id__c)
            || String.isBlank(settings.Client_Secret__c)
            || String.isBlank(settings.Subdomain__c)
            || String.isBlank(settings.Data_Extension_Key__c)) {
            throw new CalloutException('Marketing Cloud settings are incomplete.');
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
        Map<String, Object> body = sendJson(req);
        String token = (String) body.get('access_token');
        if (String.isBlank(token)) {
            throw new CalloutException('Marketing Cloud did not return an access token.');
        }
        return token;
    }

    private static Map<String, Object> findDataExtensionByKey(
        MCE_Settings__mdt settings,
        String token,
        String dataExtensionKey
    ) {
        String endpoint = 'https://' + settings.Subdomain__c
            + '.rest.marketingcloudapis.com/data/v1/customobjects?$search='
            + EncodingUtil.urlEncode(dataExtensionKey, 'UTF-8');
        Map<String, Object> body = sendJson(authorizedGet(endpoint, token));
        List<Object> items = (List<Object>) body.get('items');
        if (items == null || items.isEmpty()) {
            throw new CalloutException('Data extension ' + dataExtensionKey + ' was not found.');
        }
        Map<String, Object> first = (Map<String, Object>) items[0];
        if (String.isBlank((String) first.get('id'))) {
            throw new CalloutException('Data extension ' + dataExtensionKey + ' did not include an id.');
        }
        return first;
    }

    private static HttpRequest authorizedGet(String endpoint, String token) {
        HttpRequest req = new HttpRequest();
        req.setMethod('GET');
        req.setEndpoint(endpoint);
        req.setHeader('Authorization', 'Bearer ' + token);
        req.setTimeout(120000);
        return req;
    }

    private static Map<String, Object> sendJson(HttpRequest req) {
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            throw new CalloutException('Marketing Cloud call failed (' + res.getStatusCode() + ').');
        }
        Object parsed = JSON.deserializeUntyped(res.getBody());
        if (!(parsed instanceof Map<String, Object>)) {
            throw new CalloutException('Marketing Cloud returned an unexpected response.');
        }
        return (Map<String, Object>) parsed;
    }

    private static String escapeXml(String value) {
        if (value == null) {
            return '';
        }
        return value
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;')
            .replace('"', '&quot;')
            .replace('\'', '&apos;');
    }

    private static String generateUuid() {
        Blob b = Crypto.generateAesKey(128);
        String h = EncodingUtil.convertToHex(b);
        return h.substring(0, 8) + '-'
            + h.substring(8, 12) + '-'
            + h.substring(12, 16) + '-'
            + h.substring(16, 20) + '-'
            + h.substring(20, 32);
    }
}
