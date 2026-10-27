/**
 * Mirrors Marketing Dictionary weekly SMS blockout rules into Salesforce Unified Messaging
 * (Setup > Unified Messaging > Blockout Windows / CommBlockOutTime) via UI API.
 *
 * Calendar blockout dates (Blackout_Window__c) are NBA-specific holds and do not map to
 * UM daily schedule windows — those records are marked Not Applicable.
 *
 * Sync requires an automation context with Configure Messaging / UM blockout access.
 * Marketing Dictionary users stay out of Setup; failed syncs remain Pending for admin Flow.
 */
public with sharing class UnifiedMessagingBlockoutSync {

    public class SyncResult {
        @AuraEnabled public String status;
        @AuraEnabled public String message;
    }

    private static UM_Blockout_Sync_Setting__mdt settings() {
        UM_Blockout_Sync_Setting__mdt row = UM_Blockout_Sync_Setting__mdt.getInstance('Default');
        return row != null ? row : new UM_Blockout_Sync_Setting__mdt();
    }

    public static void afterDayRuleSave(Id ruleId) {
        if (ruleId == null) {
            return;
        }
        applyDayRuleSync(ruleId);
    }

    public static void afterCalendarWindowSave(Id windowId) {
        if (windowId == null) {
            return;
        }
        Blackout_Window__c win = [
            SELECT Id
            FROM Blackout_Window__c
            WHERE Id = :windowId
            LIMIT 1
        ];
        win.UM_Sync_Status__c = 'Not Applicable';
        win.UM_Sync_Message__c =
            'Calendar blockout dates are enforced by NBA Engine. Unified Messaging blockout windows are daily SMS schedules (see channel weekly rules).';
        update win;
    }

    @InvocableMethod(
        label='Sync pending UM blockout rules'
        description='Run as an admin-automation user to push Pending weekly SMS blockout rules to Unified Messaging.'
    )
    public static void syncPendingInvocable(List<Id> dummy) {
        syncAllPendingDayRules();
    }

    public static Integer syncAllPendingDayRules() {
        List<Blackout_Day_Rule__c> pending = [
            SELECT Id
            FROM Blackout_Day_Rule__c
            WHERE UM_Sync_Status__c = 'Pending'
            LIMIT 200
        ];
        Integer synced = 0;
        for (Blackout_Day_Rule__c rule : pending) {
            SyncResult res = applyDayRuleSync(rule.Id);
            if (res != null && res.status == 'Synced') {
                synced++;
            }
        }
        return synced;
    }

    private static SyncResult applyDayRuleSync(Id ruleId) {
        SyncResult out = new SyncResult();
        if (!settings().Sync_Enabled__c) {
            out.status = 'Skipped';
            out.message = 'Unified Messaging sync is disabled in UM Blockout Sync Setting.';
            updateDayRule(ruleId, 'Skipped', out.message, null);
            return out;
        }

        Blackout_Day_Rule__c rule = [
            SELECT Id, Day_Of_Week__c, Is_Fully_Blocked__c, Blocked_From_Hour__c, Blocked_To_Hour__c,
                   UM_Blockout_Record_Id__c, Channel__r.Name, Channel__r.Channel_Type__c
            FROM Blackout_Day_Rule__c
            WHERE Id = :ruleId
            LIMIT 1
        ];

        if (!isSmsChannel(rule.Channel__r)) {
            out.status = 'Skipped';
            out.message = 'Unified Messaging blockout windows apply to SMS only.';
            updateDayRule(ruleId, 'Skipped', out.message, rule.UM_Blockout_Record_Id__c);
            return out;
        }

        String startTime = formatHour(rule.Is_Fully_Blocked__c, rule.Blocked_From_Hour__c, true);
        String endTime = formatHour(rule.Is_Fully_Blocked__c, rule.Blocked_To_Hour__c, false);
        String blockoutName = buildBlockoutName(rule);

        Map<String, Object> fields = new Map<String, Object>{
            'BlockoutName' => blockoutName,
            'MasterLabel' => blockoutName.left(80),
            'EngagementChannelTypeId' => settings().Default_SMS_Engagement_Channel_Id__c,
            'MessagePurpose' => 'All',
            'BlockoutStartTime' => startTime,
            'BlockoutEndTime' => endTime,
            'TimezoneCalculationMethod' => 'MessagingChannelSourceCountry',
            'IsActive' => true
        };

        HttpResponse res;
        if (String.isNotBlank(rule.UM_Blockout_Record_Id__c)) {
            res = uiApiPatchRecord(rule.UM_Blockout_Record_Id__c, fields);
        } else {
            res = uiApiCreateRecord(fields);
        }

        if (res.getStatusCode() >= 200 && res.getStatusCode() < 300) {
            String umId = extractRecordId(res.getBody(), rule.UM_Blockout_Record_Id__c);
            out.status = 'Synced';
            out.message = 'Unified Messaging blockout window updated.';
            updateDayRule(ruleId, 'Synced', out.message, umId);
            return out;
        }

        out.status = 'Failed';
        out.message = parseError(res);
        if (out.message.contains('INSUFFICIENT_ACCESS') || res.getStatusCode() == 403) {
            out.message =
                'Pending Unified Messaging sync — run the admin automation Flow or grant Configure Messaging to the integration user.';
            updateDayRule(ruleId, 'Pending', out.message, rule.UM_Blockout_Record_Id__c);
        } else {
            updateDayRule(ruleId, 'Failed', out.message, rule.UM_Blockout_Record_Id__c);
        }
        return out;
    }

    private static Boolean isSmsChannel(Marketing_Dictionary__c channel) {
        if (channel == null) {
            return false;
        }
        String type = (channel.Channel_Type__c != null ? channel.Channel_Type__c : '').toLowerCase();
        String name = (channel.Name != null ? channel.Name : '').toLowerCase();
        return type.contains('sms') || type.contains('text') || name.contains('sms');
    }

    private static String buildBlockoutName(Blackout_Day_Rule__c rule) {
        String channel = rule.Channel__r != null ? rule.Channel__r.Name : 'Channel';
        String day = rule.Day_Of_Week__c != null ? rule.Day_Of_Week__c : 'Day';
        String raw = 'MD_' + channel + '_' + day;
        return raw.replaceAll('[^A-Za-z0-9_]', '_').left(255);
    }

    private static String formatHour(Boolean fullyBlocked, Decimal hour, Boolean isStart) {
        if (fullyBlocked == true) {
            return isStart ? '00:00' : '23:59';
        }
        Integer h = hour != null ? hour.intValue() : (isStart ? 22 : 8);
        if (h < 0) {
            h = 0;
        }
        if (h > 23) {
            h = 23;
        }
        return (h < 10 ? '0' : '') + String.valueOf(h) + ':00';
    }

    private static HttpResponse uiApiCreateRecord(Map<String, Object> fields) {
        Map<String, Object> body = new Map<String, Object>{
            'apiName' => 'CommBlockOutTime',
            'fields' => fields
        };
        HttpRequest req = new HttpRequest();
        req.setEndpoint(URL.getOrgDomainUrl().toExternalForm() + '/services/data/v68.0/ui-api/records');
        req.setMethod('POST');
        req.setHeader('Authorization', 'Bearer ' + UserInfo.getSessionId());
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(body));
        req.setTimeout(120000);
        return new Http().send(req);
    }

    private static HttpResponse uiApiPatchRecord(String recordId, Map<String, Object> fields) {
        Map<String, Object> body = new Map<String, Object>{ 'fields' => fields };
        HttpRequest req = new HttpRequest();
        req.setEndpoint(
            URL.getOrgDomainUrl().toExternalForm()
                + '/services/data/v68.0/ui-api/records/'
                + EncodingUtil.urlEncode(recordId, 'UTF-8')
        );
        req.setMethod('PATCH');
        req.setHeader('Authorization', 'Bearer ' + UserInfo.getSessionId());
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(body));
        req.setTimeout(120000);
        return new Http().send(req);
    }

    private static String extractRecordId(String body, String fallback) {
        if (String.isBlank(body)) {
            return fallback;
        }
        try {
            Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(body);
            if (parsed.containsKey('id')) {
                return String.valueOf(parsed.get('id'));
            }
            Object results = parsed.get('results');
            if (results instanceof List<Object> && !((List<Object>) results).isEmpty()) {
                Map<String, Object> first = (Map<String, Object>) ((List<Object>) results)[0];
                if (first.containsKey('id')) {
                    return String.valueOf(first.get('id'));
                }
            }
        } catch (Exception e) {
            // keep fallback
        }
        return fallback;
    }

    private static String parseError(HttpResponse res) {
        String body = res.getBody();
        if (String.isBlank(body)) {
            return 'HTTP ' + res.getStatusCode();
        }
        try {
            List<Object> errors = (List<Object>) JSON.deserializeUntyped(body);
            if (!errors.isEmpty() && errors[0] instanceof Map<String, Object>) {
                Map<String, Object> err = (Map<String, Object>) errors[0];
                if (err.containsKey('message')) {
                    return String.valueOf(err.get('message'));
                }
            }
        } catch (Exception e) {
            return body.left(255);
        }
        return body.left(255);
    }

    private static void updateDayRule(Id ruleId, String status, String message, String umId) {
        Blackout_Day_Rule__c upd = new Blackout_Day_Rule__c(
            Id = ruleId,
            UM_Sync_Status__c = status,
            UM_Sync_Message__c = message != null ? message.left(255) : null,
            UM_Blockout_Record_Id__c = umId
        );
        update upd;
    }
}