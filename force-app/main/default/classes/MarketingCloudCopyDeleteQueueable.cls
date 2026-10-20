public class MarketingCloudCopyDeleteQueueable implements Queueable, Database.AllowsCallouts {
    private final List<String> messageVariantIds;

    public MarketingCloudCopyDeleteQueueable(List<String> messageVariantIds) {
        this.messageVariantIds = messageVariantIds == null
            ? new List<String>()
            : new List<String>(messageVariantIds);
    }

    public void execute(QueueableContext context) {
        MarketingCloudCopyDelete.deleteVariantsFromMce(messageVariantIds);
    }
}
