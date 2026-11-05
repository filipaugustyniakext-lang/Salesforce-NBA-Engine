@IsTest
private class JourneyMembershipControllerTest {
    private static List<String> endpoints = new List<String>();

    private class JourneyMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            endpoints.add(req.getEndpoint() + ' ' + req.getMethod());
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setHeader('Content-Type', 'application/json');
            String endpoint = req.getEndpoint();
            if (endpoint.contains('/v2/token')) {
                res.setBody('{"access_token":"token"}');
            } else if (endpoint.contains('/contactMembership')) {
                res.setBody('{"contactMemberships":[{"contactKey":"003000000000001","definitionKey":"journey-welcome","version":2}]}');
            } else if (endpoint.contains('/journeyhistory/download')) {
                res.setHeader('Content-Type', 'text/csv');
                res.setBody(
                    'TransactionTime,Status,DefinitionId,DefinitionName,DefinitionInstanceId,ActivityName,ActivityType,ContactKey\n'
                    + '2026-10-01T10:00:00.000Z,Complete,journey-welcome,Welcome,instance-2,Email 1,emailv2,003000000000001\n'
                    + '2026-10-02T11:00:00.000Z,Waiting,journey-welcome,Welcome,instance-2,Wait 1 day,wait,003000000000001\n'
                    + '2026-09-01T09:00:00.000Z,ExitCriteriaMet,journey-old,"Old, Journey",instance-1,Exit,exitcriteriaactivity,003000000000001\n'
                    + '2026-08-01T09:00:00.000Z,Complete,journey-done,Done path,instance-3,End,stopinteractionactivity,003000000000001\n'
                    + '2026-07-01T09:00:00.000Z,DidNotMeetEntryCriteria,journey-skip,Skipped,,Entry,trigger,003000000000001\n'
                );
            } else if (endpoint.contains('/contactexit')) {
                res.setBody('[{"status":"OK"}]');
            } else if (endpoint.contains('/interactions/')) {
                res.setBody('{"id":"instance-2","key":"journey-welcome","name":"Welcome journey","version":2}');
            } else {
                res.setStatusCode(404);
                res.setBody('{}');
            }
            return res;
        }
    }

    @IsTest
    static void classifiesLatestHistoryAndSortsByActivityDate() {
        JourneyMembershipController.HistoryEvent waiting = event(
            '2026-10-02T11:00:00.000Z', 'Waiting', 'journey-welcome', 'Welcome', 'instance-2', 'Wait 1 day'
        );
        JourneyMembershipController.HistoryEvent earlier = event(
            '2026-10-01T10:00:00.000Z', 'Complete', 'journey-welcome', 'Welcome', 'instance-2', 'Email 1'
        );
        JourneyMembershipController.HistoryEvent exited = event(
            '2026-11-01T09:00:00.000Z', 'ExitCriteriaMet', 'journey-old', 'Old journey', 'instance-1', 'Exit criteria'
        );
        JourneyMembershipController.HistoryEvent finished = event(
            '2026-08-01T09:00:00.000Z', 'Complete', 'journey-done', 'Done path', 'instance-3', 'End'
        );
        JourneyMembershipController.HistoryEvent ignored = event(
            '2026-11-02T09:00:00.000Z', 'DidNotMeetEntryCriteria', 'journey-skip', 'Skipped', null, 'Entry'
        );

        JourneyMembershipController.JourneyMeta welcome = new JourneyMembershipController.JourneyMeta();
        welcome.id = 'instance-2';
        welcome.definitionKey = 'journey-welcome';
        welcome.name = 'Welcome journey';
        welcome.version = 2;
        Map<String, JourneyMembershipController.JourneyMeta> metas = new Map<String, JourneyMembershipController.JourneyMeta>{
            'instance-2' => welcome
        };

        JourneyMembershipController.MembershipHit current = new JourneyMembershipController.MembershipHit();
        current.contactKey = '003000000000001';
        current.definitionKey = 'journey-live';
        current.version = 4;

        List<JourneyMembershipController.JourneyMembership> rows = JourneyMembershipController.buildRows(
            new List<JourneyMembershipController.HistoryEvent>{ waiting, earlier, exited, finished, ignored },
            new List<JourneyMembershipController.MembershipHit>{ current },
            metas
        );

        System.assertEquals(4, rows.size());
        System.assertEquals('Old journey', rows[0].journeyName);
        System.assertEquals('Exit', rows[0].status);
        System.assertEquals(false, rows[0].canStop);
        System.assertEquals('Welcome journey', rows[1].journeyName);
        System.assertEquals('2', rows[1].versionLabel);
        System.assertEquals('In-flight', rows[1].status);
        System.assertEquals(true, rows[1].canStop);
        System.assertEquals('Wait 1 day', rows[1].latestActivityName);
        System.assertEquals('Done path', rows[2].journeyName);
        System.assertEquals('Finished', rows[2].status);
        System.assertEquals(false, rows[2].canStop);
        System.assertEquals('In-flight', rows[3].status);
        System.assertEquals('journey-live', rows[3].definitionKey);
        System.assertEquals('4', rows[3].versionLabel);
    }

    @IsTest
    static void completeActivityStaysInFlightWhenMembershipMatches() {
        JourneyMembershipController.HistoryEvent complete = event(
            '2026-10-02T11:00:00.000Z', 'Complete', 'journey-welcome', 'Welcome', 'instance-2', 'Email 1'
        );
        JourneyMembershipController.JourneyMeta welcome = new JourneyMembershipController.JourneyMeta();
        welcome.id = 'journey-welcome';
        welcome.definitionKey = 'journey-welcome';
        welcome.name = 'Welcome';
        welcome.version = 2;
        JourneyMembershipController.MembershipHit current = new JourneyMembershipController.MembershipHit();
        current.contactKey = '003000000000001';
        current.definitionKey = 'journey-welcome';
        current.version = 2;

        List<JourneyMembershipController.JourneyMembership> rows = JourneyMembershipController.buildRows(
            new List<JourneyMembershipController.HistoryEvent>{ complete },
            new List<JourneyMembershipController.MembershipHit>{ current },
            new Map<String, JourneyMembershipController.JourneyMeta>{ 'journey-welcome' => welcome }
        );

        System.assertEquals(1, rows.size());
        System.assertEquals('In-flight', rows[0].status);
        System.assertEquals(true, rows[0].canStop);
    }

    @IsTest
    static void loadsHistoryAndEjectsUsingMarketingCloud() {
        endpoints.clear();
        String externalId = 'EXT-' + String.valueOf(Math.abs(Crypto.getRandomInteger()));
        Contact contact = new Contact(LastName = 'Journey');
        contact.put('gcp_externalCustomerId__c', externalId);
        insert contact;

        JourneyMembershipController.settingsOverride = new MCE_Settings__mdt(
            Subdomain__c = 'mc-example',
            Client_Id__c = 'client',
            Client_Secret__c = 'secret',
            Account_Id__c = '1'
        );
        Test.setMock(HttpCalloutMock.class, new JourneyMock());

        Test.startTest();
        JourneyMembershipController.JourneyHistory history = JourneyMembershipController.getJourneyHistory(contact.Id);
        JourneyMembershipController.ejectFromJourney(contact.Id, externalId, 'journey-welcome');
        Test.stopTest();

        System.assert(!history.journeys.isEmpty());
        System.assertEquals(1, history.contactKeys.size());
        System.assertEquals(externalId, history.contactKeys[0]);
        System.assert(!history.contactKeys.contains(String.valueOf(contact.Id)));
        System.assert(endpoints[0].contains('/v2/token'));
        Boolean ejected = false;
        for (String endpoint : endpoints) {
            if (endpoint.contains('/contactexit')) {
                ejected = true;
            }
        }
        System.assert(ejected, 'Stop should call contactexit');
    }

    @IsTest
    static void rejectsEjectForAnotherContactKey() {
        String externalId = 'EXT-' + String.valueOf(Math.abs(Crypto.getRandomInteger()));
        Contact contact = new Contact(LastName = 'Journey');
        contact.put('gcp_externalCustomerId__c', externalId);
        insert contact;
        JourneyMembershipController.settingsOverride = new MCE_Settings__mdt(
            Subdomain__c = 'mc-example',
            Client_Id__c = 'client',
            Client_Secret__c = 'secret',
            Account_Id__c = '1'
        );
        Test.setMock(HttpCalloutMock.class, new JourneyMock());

        try {
            JourneyMembershipController.ejectFromJourney(contact.Id, String.valueOf(contact.Id), 'journey-welcome');
            System.assert(false, 'Salesforce record id must not be accepted as the contact key');
        } catch (AuraHandledException error) {
            System.assert(error.getMessage().contains('does not belong'));
        }
    }

    private static JourneyMembershipController.HistoryEvent event(
        String timestamp,
        String status,
        String definitionId,
        String definitionName,
        String instanceId,
        String activityName
    ) {
        JourneyMembershipController.HistoryEvent row = new JourneyMembershipController.HistoryEvent();
        row.transactionTime = (Datetime) JSON.deserialize('"' + timestamp + '"', Datetime.class);
        row.status = status;
        row.definitionId = definitionId;
        row.definitionName = definitionName;
        row.definitionInstanceId = instanceId;
        row.activityName = activityName;
        row.contactKey = '003000000000001';
        return row;
    }
}
