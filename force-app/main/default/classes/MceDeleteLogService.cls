/**
 * Persists Marketing Cloud integration events to MCE Sync Logs (MCE_Delete_Log__c API name).
 */
public without sharing class MceDeleteLogService {
    public static final String OP_DELETE = 'Delete';
    public static final String OP_INBOUND_SYNC = 'Inbound Sync';
    public static final String OP_OUTBOUND_PUSH = 'Outbound Push';

    public static final String SOURCE_SOAP_QUEUEABLE = 'SOAP Queueable';
    public static final String SOURCE_REST_FUTURE = 'REST Future';
    public static final String SOURCE_ON_DEMAND = 'On-Demand Sync';
    public static final String SOURCE_SCHEDULED = 'Scheduled Apex Job';
    public static final String SOURCE_COPY_CENTER = 'Copy Center Save';

    public static void logSuccess(
        String source,
        List<String> messageVariantIds,
        String summary,
        String detail
    ) {
        logSuccess(OP_DELETE, source, messageVariantIds, summary, detail);
    }

    public static void logFailure(
        String source,
        List<String> messageVariantIds,
        String summary,
        String detail
    ) {
        logFailure(OP_DELETE, source, messageVariantIds, summary, detail);
    }

    public static void logPartial(
        String source,
        List<String> messageVariantIds,
        String summary,
        String detail
    ) {
        logPartial(OP_DELETE, source, messageVariantIds, summary, detail);
    }

    public static void logSuccess(
        String operation,
        String source,
        List<String> messageVariantIds,
        String summary,
        String detail
    ) {
        persist(operation, source, 'Success', messageVariantIds, summary, detail);
    }

    public static void logFailure(
        String operation,
        String source,
        List<String> messageVariantIds,
        String summary,
        String detail
    ) {
        persist(operation, source, 'Failed', messageVariantIds, summary, detail);
    }

    public static void logPartial(
        String operation,
        String source,
        List<String> messageVariantIds,
        String summary,
        String detail
    ) {
        persist(operation, source, 'Partial', messageVariantIds, summary, detail);
    }

    public static void logInboundSync(String source, MarketingCloudCopySync.SyncResult result, List<String> variantIds) {
        if (result == null) {
            return;
        }
        String summary = buildInboundSummary(result);
        String detail = result.errorMessage;
        List<String> ids = variantIds != null && !variantIds.isEmpty() ? variantIds : null;
        if (String.isNotBlank(result.errorMessage) && (result.createdCount == 0 && result.updatedCount == 0)) {
            logFailure(OP_INBOUND_SYNC, source, ids, summary, detail);
            return;
        }
        if (result.failedCount != null && result.failedCount > 0) {
            logPartial(OP_INBOUND_SYNC, source, ids, summary, detail);
            return;
        }
        logSuccess(OP_INBOUND_SYNC, source, ids, summary, detail);
    }

    private static String buildInboundSummary(MarketingCloudCopySync.SyncResult result) {
        List<String> parts = new List<String>();
        if (String.isNotBlank(result.channel)) {
            parts.add('Channel ' + result.channel);
        }
        if (result.fetchedCount != null) {
            parts.add('fetched ' + result.fetchedCount);
        }
        if (result.createdCount != null && result.createdCount > 0) {
            parts.add('created ' + result.createdCount);
        }
        if (result.updatedCount != null && result.updatedCount > 0) {
            parts.add('updated ' + result.updatedCount);
        }
        if (result.skippedCount != null && result.skippedCount > 0) {
            parts.add('skipped ' + result.skippedCount);
        }
        if (result.failedCount != null && result.failedCount > 0) {
            parts.add('failed ' + result.failedCount);
        }
        return parts.isEmpty() ? 'Inbound sync completed.' : String.join(parts, ', ');
    }

    private static void persist(
        String operation,
        String source,
        String status,
        List<String> messageVariantIds,
        String summary,
        String detail
    ) {
        try {
            insert new MCE_Delete_Log__c(
                Operation__c = operation,
                Source__c = source,
                Status__c = status,
                Message_Variant_Ids__c = joinVariantIds(messageVariantIds),
                Summary__c = truncate(summary, 255),
                Detail__c = truncate(detail, 131072)
            );
        } catch (Exception ex) {
            System.debug(LoggingLevel.ERROR, 'MCE Sync Log insert failed: ' + ex.getMessage());
        }
    }

    private static String joinVariantIds(List<String> messageVariantIds) {
        if (messageVariantIds == null || messageVariantIds.isEmpty()) {
            return null;
        }
        return String.join(messageVariantIds, '\n');
    }

    private static String truncate(String value, Integer maxLen) {
        if (String.isBlank(value)) {
            return null;
        }
        return value.length() > maxLen ? value.substring(0, maxLen) : value;
    }
}
