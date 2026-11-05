/**
 * Journey membership for a person account or contact.
 * Uses the same Marketing Cloud client credentials as Copy Center (MCE_Settings__mdt.Default).
 * History comes from the journey history download API, which retains 30 days of activity.
 * The Marketing Cloud contact key is External Customer Id (gcp_externalCustomerId__c on
 * Contact, gcp_externalCustomerId__pc on Person Account), not the Salesforce record id.
 * Current membership comes from contactMembership. Eject uses contactexit.
 */
public with sharing class JourneyMembershipController {
    @TestVisible
    private static MCE_Settings__mdt settingsOverride;

    private static final Integer HISTORY_DAYS = 30;
    private static final Integer MAX_VERSION_LOOKUPS = 25;

    private static final Set<String> IN_FLIGHT_STATUSES = new Set<String>{
        'active', 'waiting', 'waitingforasync', 'currentlywaitinginsameinteraction',
        'metcriteria', 'goalcriterianotmet', 'waituntileventcriteriamet', 'waituntileventcriterianotmet'
    };
    private static final Set<String> EXIT_STATUSES = new Set<String>{
        'exitcriteriamet', 'contactexitedbyapi', 'contactexitedasoutofmarketaudiencesegment',
        'stoppedbyuser', 'goalcriteriamet', 'goalcriteriametinwait', 'goalcriteriaalreadymet',
        'contactisdeleted', 'movedtohigherpriorityinteraction', 'deactivated', 'contactisrestricted'
    };
    private static final Set<String> IGNORED_STATUSES = new Set<String>{
        'didnotmeetentrycriteria', 'contactnotfound', 'notevaluatingentrycriteria',
        'interactionnotpublished', 'invalidinteractionid', 'contactkeynotprovided',
        'couldnotparseinteractionid', 'contactobjectnull', 'contactstatusisunknown'
    };

    @AuraEnabled
    public static JourneyHistory getJourneyHistory(Id recordId) {
        ContactKeyResolution resolved = resolveContactKeys(recordId);
        if (resolved.keys.isEmpty()) {
            JourneyHistory emptyResult = new JourneyHistory();
            emptyResult.journeys = new List<JourneyMembership>();
            emptyResult.historyDays = HISTORY_DAYS;
            emptyResult.message = resolved.message;
            return emptyResult;
        }
        List<String> contactKeys = resolved.keys;

        MCE_Settings__mdt settings = loadSettings();
        String token = requestToken(settings);
        String restBase = 'https://' + settings.Subdomain__c + '.rest.marketingcloudapis.com';

        List<MembershipHit> memberships = fetchMemberships(restBase, token, contactKeys);
        List<HistoryEvent> events = fetchHistory(restBase, token, contactKeys);
        Map<String, JourneyMeta> metas = fetchJourneyMetas(restBase, token, events, memberships);
        List<JourneyMembership> rows = buildRows(events, memberships, metas);

        JourneyHistory result = new JourneyHistory();
        result.contactKeys = contactKeys;
        result.historyDays = HISTORY_DAYS;
        result.journeys = rows;
        result.message = rows.isEmpty()
            ? 'No journey activity in the last ' + HISTORY_DAYS + ' days, and this contact is not in a journey right now.'
            : 'Activity detail covers the last ' + HISTORY_DAYS + ' days. Marketing Cloud does not keep older journey history.';
        return result;
    }

    @AuraEnabled
    public static void ejectFromJourney(Id recordId, String contactKey, String definitionKey) {
        if (String.isBlank(contactKey) || String.isBlank(definitionKey)) {
            throw auraError('A contact key and journey key are required to stop a journey.');
        }
        Set<String> allowed = new Set<String>(resolveContactKeys(recordId).keys);
        if (!allowed.contains(contactKey)) {
            throw auraError('That contact key does not belong to this record.');
        }
        MCE_Settings__mdt settings = loadSettings();
        String token = requestToken(settings);
        String endpoint = 'https://' + settings.Subdomain__c
            + '.rest.marketingcloudapis.com/interaction/v1/interactions/contactexit';
        HttpRequest req = authorized(endpoint, token, 'POST');
        req.setBody(JSON.serialize(new List<Object>{
            new Map<String, String>{
                'ContactKey' => contactKey,
                'DefinitionKey' => definitionKey
            }
        }));
        HttpResponse res = send(req);
        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            throw auraError('Marketing Cloud did not eject the contact (' + res.getStatusCode() + '). ' + clip(res.getBody()));
        }
    }

    @TestVisible
    static List<JourneyMembership> buildRows(
        List<HistoryEvent> events,
        List<MembershipHit> memberships,
        Map<String, JourneyMeta> metas
    ) {
        Map<String, List<HistoryEvent>> grouped = new Map<String, List<HistoryEvent>>();
        for (HistoryEvent event : events == null ? new List<HistoryEvent>() : events) {
            if (event == null || String.isBlank(event.definitionId)) {
                continue;
            }
            if (IGNORED_STATUSES.contains(normalizeStatus(event.status))) {
                continue;
            }
            String groupKey = event.definitionId + '|' + (event.definitionInstanceId == null ? '' : event.definitionInstanceId);
            if (!grouped.containsKey(groupKey)) {
                grouped.put(groupKey, new List<HistoryEvent>());
            }
            grouped.get(groupKey).add(event);
        }

        List<JourneyMembership> rows = new List<JourneyMembership>();
        Set<String> seenDefinitionIds = new Set<String>();
        for (String groupKey : grouped.keySet()) {
            List<HistoryEvent> groupEvents = grouped.get(groupKey);
            groupEvents.sort();
            HistoryEvent latest = groupEvents[groupEvents.size() - 1];
            seenDefinitionIds.add(latest.definitionId);
            JourneyMeta meta = metaFor(metas, latest.definitionInstanceId, latest.definitionId);
            JourneyMembership row = rowFromLatest(latest, meta);
            applyMembership(row, memberships, meta);
            rows.add(row);
        }

        for (MembershipHit membership : memberships == null ? new List<MembershipHit>() : memberships) {
            if (membership == null || String.isBlank(membership.definitionKey)) {
                continue;
            }
            if (seenDefinitionIds.contains(membership.definitionKey)) {
                continue;
            }
            JourneyMeta meta = metaFor(metas, membership.definitionKey, membership.definitionKey);
            if (meta != null && seenDefinitionIds.contains(meta.id)) {
                continue;
            }
            JourneyMembership row = new JourneyMembership();
            row.journeyName = meta != null && String.isNotBlank(meta.name) ? meta.name : membership.definitionKey;
            row.versionLabel = membership.version != null
                ? String.valueOf(membership.version)
                : (meta != null && meta.version != null ? String.valueOf(meta.version) : '');
            row.status = 'In-flight';
            row.canStop = true;
            row.contactKey = membership.contactKey;
            row.definitionKey = meta != null && String.isNotBlank(meta.definitionKey)
                ? meta.definitionKey
                : membership.definitionKey;
            row.rowKey = membership.definitionKey + '|' + row.contactKey;
            rows.add(row);
        }

        rows.sort();
        return rows;
    }

    private static JourneyMembership rowFromLatest(HistoryEvent latest, JourneyMeta meta) {
        JourneyMembership row = new JourneyMembership();
        row.journeyName = meta != null && String.isNotBlank(meta.name)
            ? meta.name
            : (String.isNotBlank(latest.definitionName) ? latest.definitionName : latest.definitionId);
        row.versionLabel = meta != null && meta.version != null ? String.valueOf(meta.version) : '';
        row.latestActivityName = latest.activityName;
        row.latestActivityType = latest.activityType;
        row.latestActivityStatus = latest.status;
        row.latestActivityId = latest.activityId;
        row.latestActivityDate = latest.transactionTime;
        row.contactKey = latest.contactKey;
        row.definitionKey = meta != null && String.isNotBlank(meta.definitionKey)
            ? meta.definitionKey
            : latest.definitionId;
        row.definitionId = latest.definitionId;
        row.versionNumber = meta == null ? null : meta.version;
        row.status = classify(latest.status);
        row.canStop = row.status == 'In-flight';
        row.rowKey = (latest.definitionInstanceId == null ? latest.definitionId : latest.definitionInstanceId)
            + '|' + latest.contactKey;
        return row;
    }

    private static void applyMembership(JourneyMembership row, List<MembershipHit> memberships, JourneyMeta meta) {
        if (row.status == 'Exit') {
            row.canStop = false;
            return;
        }
        for (MembershipHit membership : memberships == null ? new List<MembershipHit>() : memberships) {
            if (!membershipMatches(row, membership, meta)) {
                continue;
            }
            if (membership.version != null && row.versionNumber != null && membership.version != row.versionNumber) {
                continue;
            }
            row.status = 'In-flight';
            row.canStop = true;
            if (String.isNotBlank(membership.contactKey)) {
                row.contactKey = membership.contactKey;
            }
            if (String.isBlank(row.versionLabel) && membership.version != null) {
                row.versionLabel = String.valueOf(membership.version);
            }
            return;
        }
        row.canStop = row.status == 'In-flight';
    }

    private static Boolean membershipMatches(JourneyMembership row, MembershipHit membership, JourneyMeta meta) {
        if (membership == null || String.isBlank(membership.definitionKey)) {
            return false;
        }
        if (membership.definitionKey == row.definitionId || membership.definitionKey == row.definitionKey) {
            return true;
        }
        return meta != null && (membership.definitionKey == meta.id || membership.definitionKey == meta.definitionKey);
    }

    @TestVisible
    static String classify(String status) {
        String normalized = normalizeStatus(status);
        if (EXIT_STATUSES.contains(normalized)) {
            return 'Exit';
        }
        if (IN_FLIGHT_STATUSES.contains(normalized)) {
            return 'In-flight';
        }
        return 'Finished';
    }

    private static String normalizeStatus(String status) {
        return String.isBlank(status) ? '' : status.replace(' ', '').toLowerCase();
    }

    private static JourneyMeta metaFor(Map<String, JourneyMeta> metas, String primaryId, String fallbackId) {
        if (metas == null) {
            return null;
        }
        if (String.isNotBlank(primaryId) && metas.containsKey(primaryId)) {
            return metas.get(primaryId);
        }
        if (String.isNotBlank(fallbackId) && metas.containsKey(fallbackId)) {
            return metas.get(fallbackId);
        }
        return null;
    }

    private static ContactKeyResolution resolveContactKeys(Id recordId) {
        if (recordId == null) {
            throw auraError('A record is required.');
        }
        ContactKeyResolution resolved = new ContactKeyResolution();
        Schema.SObjectType token = recordId.getSObjectType();
        if (token == Account.SObjectType) {
            Map<String, Schema.SObjectField> fields = Account.SObjectType.getDescribe().fields.getMap();
            if (!fields.containsKey('gcp_externalcustomerid__pc')) {
                resolved.message = 'External Customer Id is not available on Account.';
                return resolved;
            }
            List<SObject> rows = Database.query(
                'SELECT IsPersonAccount, gcp_externalCustomerId__pc FROM Account WHERE Id = :recordId LIMIT 1',
                AccessLevel.USER_MODE
            );
            if (rows.isEmpty()) {
                throw auraError('Account was not found.');
            }
            if (rows[0].get('IsPersonAccount') != true) {
                resolved.message = 'Journey membership is available on person accounts and contacts.';
                return resolved;
            }
            addKey(resolved.keys, (String) rows[0].get('gcp_externalCustomerId__pc'));
            if (resolved.keys.isEmpty()) {
                resolved.message = 'Set External Customer Id on this person account. Journey search uses that value, not the Salesforce record id.';
            }
            return resolved;
        }
        if (token == Contact.SObjectType) {
            Map<String, Schema.SObjectField> fields = Contact.SObjectType.getDescribe().fields.getMap();
            if (!fields.containsKey('gcp_externalcustomerid__c')) {
                resolved.message = 'External Customer Id is not available on Contact.';
                return resolved;
            }
            List<SObject> rows = Database.query(
                'SELECT gcp_externalCustomerId__c FROM Contact WHERE Id = :recordId LIMIT 1',
                AccessLevel.USER_MODE
            );
            if (rows.isEmpty()) {
                throw auraError('Contact was not found.');
            }
            addKey(resolved.keys, (String) rows[0].get('gcp_externalCustomerId__c'));
            if (resolved.keys.isEmpty()) {
                resolved.message = 'Set External Customer Id on this contact. Journey search uses that value, not the Salesforce record id.';
            }
            return resolved;
        }
        throw auraError('Journey membership is available on person accounts and contacts.');
    }

    private static void addKey(List<String> keys, String value) {
        if (String.isBlank(value) || keys.contains(value)) {
            return;
        }
        keys.add(value);
    }

    private static List<MembershipHit> fetchMemberships(String restBase, String token, List<String> contactKeys) {
        HttpRequest req = authorized(restBase + '/interaction/v1/interactions/contactMembership', token, 'POST');
        req.setBody(JSON.serialize(new Map<String, Object>{ 'ContactKeyList' => contactKeys }));
        HttpResponse res = send(req);
        if (res.getStatusCode() == 404) {
            return new List<MembershipHit>();
        }
        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            throw auraError('Could not read journey membership (' + res.getStatusCode() + '). ' + clip(res.getBody()));
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        List<MembershipHit> hits = new List<MembershipHit>();
        List<Object> memberships = (List<Object>) body.get('contactMemberships');
        if (memberships == null) {
            return hits;
        }
        for (Object item : memberships) {
            Map<String, Object> row = (Map<String, Object>) item;
            MembershipHit hit = new MembershipHit();
            hit.contactKey = (String) row.get('contactKey');
            hit.definitionKey = (String) row.get('definitionKey');
            if (row.get('version') != null) {
                hit.version = Integer.valueOf(String.valueOf(row.get('version')));
            }
            hits.add(hit);
        }
        return hits;
    }

    private static List<HistoryEvent> fetchHistory(String restBase, String token, List<String> contactKeys) {
        Datetime endAt = Datetime.now();
        Datetime startAt = endAt.addDays(-HISTORY_DAYS);
        String columns = 'TransactionTime,Status,DefinitionId,DefinitionName,DefinitionInstanceId,ActivityId,ActivityName,ActivityType,ContactKey';
        String endpoint = restBase + '/interaction/v1/interactions/journeyhistory/download?format=csv&columns='
            + EncodingUtil.urlEncode(columns, 'UTF-8');
        HttpRequest req = authorized(endpoint, token, 'POST');
        req.setHeader('x-direct-pipe', 'true');
        req.setBody(JSON.serialize(new Map<String, Object>{
            'contactKeys' => contactKeys,
            'start' => startAt.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
            'end' => endAt.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'')
        }));
        HttpResponse res = send(req);
        if (res.getStatusCode() == 404) {
            return new List<HistoryEvent>();
        }
        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            throw auraError('Could not read journey history (' + res.getStatusCode() + '). ' + clip(res.getBody()));
        }
        String body = res.getBody();
        if (String.isBlank(body) || body.trim().startsWith('{') || body.trim().startsWith('[')) {
            return new List<HistoryEvent>();
        }
        return parseHistoryCsv(body);
    }

    @TestVisible
    static List<HistoryEvent> parseHistoryCsv(String csv) {
        List<String> lines = csv == null ? new List<String>() : csv.split('\n');
        if (lines.isEmpty()) {
            return new List<HistoryEvent>();
        }
        List<String> header = parseCsvLine(lines[0].replace('\r', ''));
        Map<String, Integer> index = new Map<String, Integer>();
        for (Integer i = 0; i < header.size(); i++) {
            index.put(header[i].trim().toLowerCase(), i);
        }
        List<HistoryEvent> events = new List<HistoryEvent>();
        for (Integer lineNo = 1; lineNo < lines.size(); lineNo++) {
            String raw = lines[lineNo].replace('\r', '');
            if (String.isBlank(raw)) {
                continue;
            }
            List<String> cells = parseCsvLine(raw);
            HistoryEvent event = new HistoryEvent();
            event.transactionTime = parseTimestamp(cell(cells, index, 'transactiontime'));
            event.status = cell(cells, index, 'status');
            event.definitionId = cell(cells, index, 'definitionid');
            event.definitionName = cell(cells, index, 'definitionname');
            event.definitionInstanceId = cell(cells, index, 'definitioninstanceid');
            event.activityName = cell(cells, index, 'activityname');
            event.activityType = cell(cells, index, 'activitytype');
            event.activityId = cell(cells, index, 'activityid');
            event.contactKey = cell(cells, index, 'contactkey');
            if (String.isNotBlank(event.definitionId)) {
                events.add(event);
            }
        }
        return events;
    }

    private static Map<String, JourneyMeta> fetchJourneyMetas(
        String restBase,
        String token,
        List<HistoryEvent> events,
        List<MembershipHit> memberships
    ) {
        Set<String> ids = new Set<String>();
        for (HistoryEvent event : events) {
            if (String.isNotBlank(event.definitionInstanceId)) {
                ids.add(event.definitionInstanceId);
            } else if (String.isNotBlank(event.definitionId)) {
                ids.add(event.definitionId);
            }
        }
        for (MembershipHit membership : memberships) {
            if (String.isNotBlank(membership.definitionKey)) {
                ids.add(membership.definitionKey);
            }
        }
        Map<String, JourneyMeta> metas = new Map<String, JourneyMeta>();
        Integer lookups = 0;
        for (String journeyId : ids) {
            if (lookups >= MAX_VERSION_LOOKUPS) {
                break;
            }
            lookups++;
            JourneyMeta meta = fetchJourneyMeta(restBase, token, journeyId);
            if (meta != null) {
                metas.put(journeyId, meta);
                if (String.isNotBlank(meta.id)) {
                    metas.put(meta.id, meta);
                }
                if (String.isNotBlank(meta.definitionKey)) {
                    metas.put(meta.definitionKey, meta);
                }
            }
        }
        return metas;
    }

    private static JourneyMeta fetchJourneyMeta(String restBase, String token, String journeyId) {
        String encoded = EncodingUtil.urlEncode(journeyId, 'UTF-8');
        HttpResponse res = send(authorized(restBase + '/interaction/v1/interactions/' + encoded, token, 'GET'));
        if (res.getStatusCode() == 404) {
            res = send(authorized(restBase + '/interaction/v1/interactions/key:' + encoded, token, 'GET'));
        }
        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            return null;
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        JourneyMeta meta = new JourneyMeta();
        meta.id = (String) body.get('id');
        meta.definitionKey = (String) body.get('key');
        meta.name = (String) body.get('name');
        if (body.get('version') != null) {
            meta.version = Integer.valueOf(String.valueOf(body.get('version')));
        }
        return meta;
    }

    private static MCE_Settings__mdt loadSettings() {
        if (settingsOverride != null) {
            return settingsOverride;
        }
        List<MCE_Settings__mdt> rows = [
            SELECT Subdomain__c, Client_Id__c, Client_Secret__c, Account_Id__c
            FROM MCE_Settings__mdt
            WHERE DeveloperName = 'Default'
            LIMIT 1
        ];
        if (rows.isEmpty()
            || String.isBlank(rows[0].Subdomain__c)
            || String.isBlank(rows[0].Client_Id__c)
            || String.isBlank(rows[0].Client_Secret__c)
            || String.isBlank(rows[0].Account_Id__c)) {
            throw auraError('Marketing Cloud settings are not configured.');
        }
        return rows[0];
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
        HttpResponse res = send(req);
        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            throw auraError('Marketing Cloud authentication failed (' + res.getStatusCode() + ').');
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        String token = (String) body.get('access_token');
        if (String.isBlank(token)) {
            throw auraError('Marketing Cloud did not return an access token.');
        }
        return token;
    }

    private static HttpRequest authorized(String endpoint, String token, String method) {
        HttpRequest req = new HttpRequest();
        req.setMethod(method);
        req.setEndpoint(endpoint);
        req.setHeader('Authorization', 'Bearer ' + token);
        req.setHeader('Content-Type', 'application/json');
        req.setTimeout(120000);
        return req;
    }

    private static HttpResponse send(HttpRequest req) {
        return new Http().send(req);
    }

    private static String cell(List<String> cells, Map<String, Integer> index, String name) {
        if (!index.containsKey(name)) {
            return '';
        }
        Integer at = index.get(name);
        return at != null && at < cells.size() ? cells[at] : '';
    }

    private static Datetime parseTimestamp(String raw) {
        if (String.isBlank(raw)) {
            return null;
        }
        try {
            return (Datetime) JSON.deserialize('"' + raw + '"', Datetime.class);
        } catch (Exception ignored) {
            return null;
        }
    }

    @TestVisible
    static List<String> parseCsvLine(String line) {
        List<String> cells = new List<String>();
        String current = '';
        Boolean inQuotes = false;
        for (Integer i = 0; i < line.length(); i++) {
            String ch = line.substring(i, i + 1);
            if (inQuotes) {
                if (ch == '"') {
                    if (i + 1 < line.length() && line.substring(i + 1, i + 2) == '"') {
                        current += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    current += ch;
                }
            } else if (ch == '"') {
                inQuotes = true;
            } else if (ch == ',') {
                cells.add(current);
                current = '';
            } else {
                current += ch;
            }
        }
        cells.add(current);
        return cells;
    }

    private static String clip(String body) {
        String text = body == null ? '' : body.replaceAll('\\s+', ' ').trim();
        return text.length() > 240 ? text.substring(0, 240) : text;
    }

    private static AuraHandledException auraError(String message) {
        AuraHandledException error = new AuraHandledException(message);
        error.setMessage(message);
        return error;
    }

    private class ContactKeyResolution {
        public List<String> keys = new List<String>();
        public String message;
    }

    public class JourneyHistory {
        @AuraEnabled public List<String> contactKeys = new List<String>();
        @AuraEnabled public List<JourneyMembership> journeys = new List<JourneyMembership>();
        @AuraEnabled public String message;
        @AuraEnabled public Integer historyDays;
    }

    public class JourneyMembership implements Comparable {
        @AuraEnabled public String rowKey;
        @AuraEnabled public String journeyName;
        @AuraEnabled public String versionLabel;
        @AuraEnabled public String status;
        @AuraEnabled public String latestActivityName;
        @AuraEnabled public String latestActivityType;
        @AuraEnabled public String latestActivityStatus;
        @AuraEnabled public String latestActivityId;
        @AuraEnabled public Datetime latestActivityDate;
        @AuraEnabled public Boolean canStop;
        @AuraEnabled public String contactKey;
        @AuraEnabled public String definitionKey;
        public String definitionId;
        public Integer versionNumber;

        public Integer compareTo(Object other) {
            JourneyMembership that = (JourneyMembership) other;
            if (latestActivityDate == that.latestActivityDate) {
                return 0;
            }
            if (latestActivityDate == null) {
                return 1;
            }
            if (that.latestActivityDate == null) {
                return -1;
            }
            return latestActivityDate.getTime() > that.latestActivityDate.getTime() ? -1 : 1;
        }
    }

    public class HistoryEvent implements Comparable {
        public Datetime transactionTime;
        public String status;
        public String definitionId;
        public String definitionName;
        public String definitionInstanceId;
        public String activityName;
        public String activityType;
        public String activityId;
        public String contactKey;

        public Integer compareTo(Object other) {
            HistoryEvent that = (HistoryEvent) other;
            Long left = transactionTime == null ? 0 : transactionTime.getTime();
            Long right = that.transactionTime == null ? 0 : that.transactionTime.getTime();
            if (left == right) {
                return 0;
            }
            return left > right ? 1 : -1;
        }
    }

    public class MembershipHit {
        public String contactKey;
        public String definitionKey;
        public Integer version;
    }

    public class JourneyMeta {
        public String id;
        public String definitionKey;
        public String name;
        public Integer version;
    }
}
