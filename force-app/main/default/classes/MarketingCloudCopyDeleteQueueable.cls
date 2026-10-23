public class MarketingCloudCopyDeleteQueueable implements Queueable, Database.AllowsCallouts {
    private final List<String> messageVariantIds;

    public MarketingCloudCopyDeleteQueueable(List<String> messageVariantIds) {
        this.messageVariantIds = messageVariantIds == null
            ? new List<String>()
            : new List<String>(messageVariantIds);
    }

    public void execute(QueueableContext context) {
        if (messageVariantIds.isEmpty()) {
            MceDeleteLogService.logFailure(
                MceDeleteLogService.SOURCE_SOAP_QUEUEABLE,
                messageVariantIds,
                'Queueable started with no message variant ids.',
                'JobId=' + context.getJobId()
            );
            return;
        }
        MarketingCloudCopyDelete.deleteVariantsFromMce(messageVariantIds);
    }
}
