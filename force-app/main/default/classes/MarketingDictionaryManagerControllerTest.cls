@IsTest
private class MarketingDictionaryManagerControllerTest {

    private static Id productDictRt() {
        return Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Product').getRecordTypeId();
    }

    private static Marketing_Dictionary__c productType(String name) {
        return new Marketing_Dictionary__c(
            Name = name,
            RecordTypeId = productDictRt(),
            Dictionary_Sub_Type__c = 'Product Type'
        );
    }

    @IsTest
    static void productTypeWithProductsCannotBeDeleted() {
        Marketing_Dictionary__c typeRecord = productType('Checking');
        insert typeRecord;
        insert new List<Product2>{
            new Product2(Name = 'Everyday Checking', IsActive = true, Product_Type_Dict__c = typeRecord.Id),
            new Product2(Name = 'Savings', IsActive = true, Product_Type_Dict__c = typeRecord.Id)
        };

        Boolean blocked = false;
        String message;
        Test.startTest();
        try {
            MarketingDictionaryManagerController.deleteDictionaryRecord(typeRecord.Id);
        } catch (AuraHandledException e) {
            blocked = true;
            message = e.getMessage();
        }
        Test.stopTest();

        System.assertEquals(true, blocked, 'Delete should be rejected while products reference the type.');
        System.assert(message.contains('Please remove dependencies first'), message);
        System.assert(message.contains('Everyday Checking'), message);
        System.assert(message.contains('Savings'), message);
        System.assertEquals(1, [SELECT COUNT() FROM Marketing_Dictionary__c WHERE Id = :typeRecord.Id]);
        System.assertEquals(
            2,
            [SELECT COUNT() FROM Product2 WHERE Product_Type_Dict__c = :typeRecord.Id],
            'Related products should keep the product type lookup.'
        );
    }

    @IsTest
    static void unusedProductTypeCanBeDeleted() {
        Marketing_Dictionary__c typeRecord = productType('Unused Type');
        insert typeRecord;

        Test.startTest();
        MarketingDictionaryManagerController.deleteDictionaryRecord(typeRecord.Id);
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Marketing_Dictionary__c WHERE Id = :typeRecord.Id]);
    }
}
