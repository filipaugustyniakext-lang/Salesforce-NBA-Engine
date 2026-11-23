/**
 * Invoked by the CC_Scheduled_Publication flow (scheduled path at CC_Message_Scheduled__c.Run_At__c).
 * Work runs in a Queueable so the MCE push can still make callouts after the status DML.
 */
public with sharing class CcScheduledPublicationExecutor implements Queueable, Database.AllowsCallouts {
    public class Request {
        @InvocableVariable(label='Scheduled change Id' required=true)
        public Id scheduleId;
    }

    private final List<Id> scheduleIds;

    public CcScheduledPublicationExecutor(List<Id> scheduleIds) {
        this.scheduleIds = scheduleIds;
    }

    @InvocableMethod(label='Run Copy Center scheduled change' description='Publishes, unpublishes, archives or publishes changes of a message variant.' category='Copy Center')
    public static void run(List<Request> requests) {
        List<Id> ids = new List<Id>();
        for (Request request : requests) {
            if (request != null && request.scheduleId != null) ids.add(request.scheduleId);
        }
        if (ids.isEmpty()) return;
        System.enqueueJob(new CcScheduledPublicationExecutor(ids));
    }

    public void execute(QueueableContext context) {
        CcMessageLifecycleService.executeSchedules(scheduleIds);
    }
}
