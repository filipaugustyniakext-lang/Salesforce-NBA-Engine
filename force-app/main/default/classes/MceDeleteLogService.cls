public without sharing class MceDeleteLogService {
    public static final String SOURCE_SOAP_QUEUEABLE = 'SOAP Queueable';
    public static final String SOURCE_REST_FUTURE = 'REST Future';

    public static void logSuccess(
        String source,
        List<String> messageVariantIds,
        String summary,
        String detail
    ) {
        persist(source, 'Success', messageVariantIds, summary, detail);
    }

    public static void logFailure(
        String source,
        List<String> messageVariantIds,
        String summary,
        String detail
    ) {
        persist(source, 'Failed', messageVariantIds, summary, detail);
    }

    public static void logPartial(
        String source,
        List<String> messageVariantIds,
        String summary,
        String detail
    ) {
        persist(source, 'Partial', messageVariantIds, summary, detail);
    }

    private static void persist(
        String source,
        String status,
        List<String> messageVariantIds,
        String summary,
        String detail
    ) {
        try {
            insert new MCE_Delete_Log__c(
                Source__c = source,
                Status__c = status,
                Message_Variant_Ids__c = joinVariantIds(messageVariantIds),
                Summary__c = truncate(summary, 255),
                Detail__c = truncate(detail, 131072)
            );
        } catch (Exception ex) {
            System.debug(LoggingLevel.ERROR, 'MCE Delete Log insert failed: ' + ex.getMessage());
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
