@IsTest
private class MarketingDictionaryFonCustomerTypeTest {

    private static Id productRt() {
        return Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Product').getRecordTypeId();
    }

    private static Marketing_Dictionary__c dict(String name, String subType) {
        return new Marketing_Dictionary__c(
            Name = name,
            RecordTypeId = productRt(),
            Dictionary_Sub_Type__c = subType
        );
    }

    @IsTest
    static void newFamilyOfNeedsStoresSelectedCustomerTypes() {
        Marketing_Dictionary__c retail = dict('Retail', 'Customer Type');
        Marketing_Dictionary__c sme = dict('SME', 'Customer Type');
        insert new List<Marketing_Dictionary__c>{ retail, sme };

        String recordsJson = '['
            + '{"Name":"Daily Banking","Dictionary_Sub_Type__c":"Family of Needs"},'
            + '{"Name":"Savings","Dictionary_Sub_Type__c":"Family of Needs"}'
            + ']';

        Test.startTest();
        List<Id> savedIds = MarketingDictionaryManagerController.saveProductRecordsBulk(
            recordsJson,
            new List<Id>{ retail.Id, sme.Id }
        );
        Test.stopTest();

        System.assertEquals(2, savedIds.size(), 'Both Family of Needs rows should be saved.');
        System.assertEquals(
            4,
            [SELECT COUNT() FROM FamilyOfNeeds_CustomerType__c WHERE Family_of_Needs__c IN :savedIds],
            'Each new Family of Needs should be linked to both customer types.'
        );
    }

    @IsTest
    static void customerTypesAreNotAppliedToOtherSubtypes() {
        Marketing_Dictionary__c retail = dict('Retail', 'Customer Type');
        insert retail;

        String recordsJson = '[{"Name":"Current Account","Dictionary_Sub_Type__c":"Product Family"}]';

        Test.startTest();
        List<Id> savedIds = MarketingDictionaryManagerController.saveProductRecordsBulk(
            recordsJson,
            new List<Id>{ retail.Id }
        );
        Test.stopTest();

        System.assertEquals(1, savedIds.size());
        System.assertEquals(
            0,
            [SELECT COUNT() FROM FamilyOfNeeds_CustomerType__c WHERE Family_of_Needs__c IN :savedIds]
        );
    }
}
