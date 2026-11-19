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

    private static List<Marketing_Dictionary__c> insertLocales() {
        Id campaignRt = Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Campaign').getRecordTypeId();
        List<Marketing_Dictionary__c> rows = new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Name = 'pl-EN', RecordTypeId = campaignRt,
                Dictionary_Sub_Type__c = 'Locale', Is_Active__c = true, Is_Default__c = true),
            new Marketing_Dictionary__c(Name = 'pl-PL', RecordTypeId = campaignRt,
                Dictionary_Sub_Type__c = 'Locale', Is_Active__c = true, Is_Default__c = false),
            new Marketing_Dictionary__c(Name = 'de-DE', RecordTypeId = campaignRt,
                Dictionary_Sub_Type__c = 'Locale', Is_Active__c = true, Is_Default__c = false)
        };
        insert rows;
        return rows;
    }

    private static Set<String> defaultNames(List<Marketing_Dictionary__c> rows) {
        Set<String> names = new Set<String>();
        for (Marketing_Dictionary__c r : rows) {
            if (r.Is_Default__c == true) {
                names.add(r.Name);
            }
        }
        return names;
    }

    @IsTest
    static void setDefaultLocaleOnMakesOnlyThatRowDefault() {
        List<Marketing_Dictionary__c> rows = insertLocales();

        Test.startTest();
        List<Marketing_Dictionary__c> saved = MarketingDictionaryManagerController.setDefaultLocale(rows[2].Id, true);
        Test.stopTest();

        System.assertEquals(new Set<String>{ 'de-DE' }, defaultNames(saved));
        System.assertEquals(
            new Set<String>{ 'de-DE' },
            defaultNames([SELECT Name, Is_Default__c FROM Marketing_Dictionary__c WHERE Dictionary_Sub_Type__c = 'Locale'])
        );
    }

    @IsTest
    static void setDefaultLocaleOffClearsEveryDefault() {
        List<Marketing_Dictionary__c> rows = insertLocales();

        Test.startTest();
        List<Marketing_Dictionary__c> saved = MarketingDictionaryManagerController.setDefaultLocale(rows[0].Id, false);
        Test.stopTest();

        System.assertEquals(0, defaultNames(saved).size(), 'No locale should remain the default.');
        System.assertEquals(
            0,
            [SELECT COUNT() FROM Marketing_Dictionary__c WHERE Dictionary_Sub_Type__c = 'Locale' AND Is_Default__c = true]
        );
    }

    @IsTest
    static void setDefaultLocaleActivatesAnInactiveLocale() {
        List<Marketing_Dictionary__c> rows = insertLocales();
        rows[1].Is_Active__c = false;
        update rows[1];

        Test.startTest();
        MarketingDictionaryManagerController.setDefaultLocale(rows[1].Id, true);
        Test.stopTest();

        Marketing_Dictionary__c saved = [
            SELECT Is_Default__c, Is_Active__c FROM Marketing_Dictionary__c WHERE Id = :rows[1].Id
        ];
        System.assertEquals(true, saved.Is_Default__c);
        System.assertEquals(true, saved.Is_Active__c);
    }

    @IsTest
    static void setDefaultLocaleRejectsAnUnknownLocaleAndKeepsTheCurrentDefault() {
        List<Marketing_Dictionary__c> rows = insertLocales();
        Id notALocale = UserInfo.getUserId();

        String message;
        Test.startTest();
        try {
            MarketingDictionaryManagerController.setDefaultLocale(notALocale, true);
        } catch (AuraHandledException e) {
            message = e.getMessage();
        }
        Test.stopTest();

        System.assertNotEquals(null, message, 'An unknown locale must raise an error.');
        System.assertEquals(
            new Set<String>{ 'pl-EN' },
            defaultNames([SELECT Name, Is_Default__c FROM Marketing_Dictionary__c WHERE Dictionary_Sub_Type__c = 'Locale'])
        );
    }

    @IsTest
    static void saveLocaleStoresTheSalesforceLocaleCode() {
        Test.startTest();
        List<Marketing_Dictionary__c> saved = MarketingDictionaryManagerController.saveLocale(
            new Marketing_Dictionary__c(Name = ' pl_PL ', Is_Active__c = true)
        );
        Test.stopTest();

        System.assertEquals(1, saved.size());
        System.assertEquals('pl_PL', saved[0].Name);
    }

    @IsTest
    static void saveLocaleRejectsNonSalesforceCodesAndDuplicates() {
        insertLocales();
        String invalidMessage;
        String duplicateMessage;
        Test.startTest();
        try {
            MarketingDictionaryManagerController.saveLocale(new Marketing_Dictionary__c(Name = 'pl-XX'));
        } catch (AuraHandledException e) {
            invalidMessage = e.getMessage();
        }
        MarketingDictionaryManagerController.saveLocale(new Marketing_Dictionary__c(Name = 'it_IT'));
        try {
            MarketingDictionaryManagerController.saveLocale(new Marketing_Dictionary__c(Name = 'it_IT'));
        } catch (AuraHandledException e) {
            duplicateMessage = e.getMessage();
        }
        Test.stopTest();

        System.assert(invalidMessage != null && invalidMessage.contains('not a Salesforce locale'), invalidMessage);
        System.assert(duplicateMessage != null && duplicateMessage.contains('already exists'), duplicateMessage);
        System.assertEquals(1, [SELECT COUNT() FROM Marketing_Dictionary__c WHERE Name = 'it_IT']);
    }

    @IsTest
    static void saveLocalesCreatesEachCodeOnceAndOneDefault() {
        Test.startTest();
        List<Marketing_Dictionary__c> saved = MarketingDictionaryManagerController.saveLocales(
            new List<String>{ 'de_CH', 'fr_CH', 'it_CH' },
            'Switzerland'
        );
        Test.stopTest();

        System.assertEquals(3, saved.size());
        Integer defaults = 0;
        for (Marketing_Dictionary__c row : saved) {
            System.assertEquals('Switzerland', row.Topic_Description__c);
            if (row.Is_Default__c == true) {
                defaults++;
            }
        }
        System.assertEquals(1, defaults);
    }

    @IsTest
    static void saveLocalesRejectsConfiguredAndUnknownCodes() {
        MarketingDictionaryManagerController.saveLocales(new List<String>{ 'pl_PL' }, null);
        String duplicateMessage;
        String invalidMessage;
        try {
            MarketingDictionaryManagerController.saveLocales(new List<String>{ 'pl_PL', 'en_GB' }, null);
        } catch (AuraHandledException e) {
            duplicateMessage = e.getMessage();
        }
        try {
            MarketingDictionaryManagerController.saveLocales(new List<String>{ 'not_A_Locale' }, null);
        } catch (AuraHandledException e) {
            invalidMessage = e.getMessage();
        }

        System.assert(duplicateMessage != null && duplicateMessage.contains('already exists'), duplicateMessage);
        System.assert(invalidMessage != null && invalidMessage.contains('not a Salesforce locale'), invalidMessage);
        System.assertEquals(1, [SELECT COUNT() FROM Marketing_Dictionary__c WHERE Name = 'pl_PL']);
        System.assertEquals(0, [SELECT COUNT() FROM Marketing_Dictionary__c WHERE Name = 'en_GB']);
    }

    @IsTest
    static void updateLocaleDescriptionsLeavesTheCodeUnchanged() {
        List<Marketing_Dictionary__c> created = MarketingDictionaryManagerController.saveLocales(
            new List<String>{ 'it_IT' },
            'old'
        );
        Test.startTest();
        List<Marketing_Dictionary__c> saved = MarketingDictionaryManagerController.updateLocaleDescriptions(
            new List<Id>{ created[0].Id },
            'new description'
        );
        Test.stopTest();

        System.assertEquals('it_IT', saved[0].Name);
        System.assertEquals('new description', saved[0].Topic_Description__c);
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