public class MCEContentCenterHourlySyncQueueable implements Queueable, Database.AllowsCallouts {
    public void execute(QueueableContext context) {
        try {
            // Initiates the bulk metadata sync, which subsequently triggers the blocks sync
            MarketingCloudCopySync.syncAllWithMCE();
        } catch (Exception e) {
            System.debug('MCE Content Center Scheduled Bulk Sync Failed: ' + e.getMessage());
        }
    }
}