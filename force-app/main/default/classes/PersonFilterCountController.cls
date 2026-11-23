/**
 * Entry points for the Person tab of the Marketing Dictionary: preview and count the individuals that match the
 * filter of a Customer Type or Audience Type value on the Data360 DMO UnifiedIndividual__dlm.
 * Each value is counted in its own call so the tab fills in as results arrive and stays within governor limits.
 */
public with sharing class PersonFilterCountController {
    /** Validates the filter and returns the SQL that will be run (no query is executed). */
    @AuraEnabled
    public static String previewSql(String filterJson) {
        try {
            return Data360PersonFilterService.buildCountSql(filterJson);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    @AuraEnabled
    public static Long getFilterCount(String filterJson) {
        try {
            return Data360PersonFilterService.count(filterJson);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** All individuals in the DMO, used to show each value as a share of the total. */
    @AuraEnabled
    public static Long getTotalCount() {
        try {
            return Data360PersonFilterService.totalCount();
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    private static AuraHandledException auraError(Exception e) {
        AuraHandledException result = new AuraHandledException(e.getMessage());
        result.setMessage(e.getMessage());
        return result;
    }
}
