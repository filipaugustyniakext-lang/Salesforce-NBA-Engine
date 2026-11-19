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
        System.assert(message.contains('must be removed before it can be deleted'), message);
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

    @IsTest
    static void settingLocaleDefaultClearsThePreviousDefault() {
        Id campaignRt = Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Campaign').getRecordTypeId();
        Marketing_Dictionary__c english = new Marketing_Dictionary__c(
            Name = 'pl-EN',
            RecordTypeId = campaignRt,
            Dictionary_Sub_Type__c = 'Locale',
            Is_Active__c = true,
            Is_Default__c = true
        );
        Marketing_Dictionary__c polish = new Marketing_Dictionary__c(
            Name = 'pl-PL',
            RecordTypeId = campaignRt,
            Dictionary_Sub_Type__c = 'Locale',
            Is_Active__c = true,
            Is_Default__c = false
        );
        insert new List<Marketing_Dictionary__c>{ english, polish };

        Test.startTest();
        MarketingDictionaryManagerController.saveCampaignRecord(new Marketing_Dictionary__c(
            Id = polish.Id,
            Is_Default__c = true
        ));
        Test.stopTest();

        Map<Id, Marketing_Dictionary__c> saved = new Map<Id, Marketing_Dictionary__c>([
            SELECT Id, Is_Default__c, Is_Active__c
            FROM Marketing_Dictionary__c
            WHERE Id IN :new Set<Id>{ english.Id, polish.Id }
        ]);
        System.assertEquals(false, saved.get(english.Id).Is_Default__c, 'The previous default must be cleared.');
        System.assertEquals(true, saved.get(polish.Id).Is_Default__c, 'The toggled locale must be the only default.');
        System.assertEquals(true, saved.get(polish.Id).Is_Active__c);
    }

    @IsTest
    static void saveLocaleReturnsTheRefreshedListWithOneDefault() {
        Id campaignRt = Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Campaign').getRecordTypeId();
        Marketing_Dictionary__c english = new Marketing_Dictionary__c(
            Name = 'pl-EN', RecordTypeId = campaignRt, Dictionary_Sub_Type__c = 'Locale',
            Is_Active__c = true, Is_Default__c = true
        );
        Marketing_Dictionary__c polish = new Marketing_Dictionary__c(
            Name = 'pl-PL', RecordTypeId = campaignRt, Dictionary_Sub_Type__c = 'Locale',
            Is_Active__c = true, Is_Default__c = false
        );
        insert new List<Marketing_Dictionary__c>{ english, polish };

        List<Marketing_Dictionary__c> before = MarketingDictionaryManagerController.getLocales();
        System.assertEquals(2, before.size());

        Test.startTest();
        List<Marketing_Dictionary__c> after = MarketingDictionaryManagerController.saveLocale(
            new Marketing_Dictionary__c(Id = polish.Id, Is_Default__c = true, Is_Active__c = true)
        );
        Test.stopTest();

        Integer defaults = 0;
        for (Marketing_Dictionary__c loc : after) {
            if (loc.Is_Default__c == true) {
                defaults++;
                System.assertEquals('pl-PL', loc.Name);
            }
        }
        System.assertEquals(1, defaults, 'Exactly one locale may be the default.');
    }
}