public with sharing class CommBlockOutTimeProbe {
    public static String createViaUiApi() {
        Map<String, Object> fields = new Map<String, Object>{
            'BlockoutName' => 'MD_Probe_' + String.valueOf(DateTime.now().getTime()),
            'MasterLabel' => 'MD Probe',
            'EngagementChannelTypeId' => '0eFds0000001NFYEA2',
            'MessagePurpose' => 'All',
            'BlockoutStartTime' => '22:00',
            'BlockoutEndTime' => '08:00',
            'TimezoneCalculationMethod' => 'MessagingChannelSourceCountry',
            'IsActive' => true
        };
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
        HttpResponse res = new Http().send(req);
        return res.getStatusCode() + ' | ' + res.getBody().left(4000);
    }
}