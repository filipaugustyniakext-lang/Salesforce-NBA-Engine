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
        MarketingDictionaryDeleteGuard.DependencyReport report =
            MarketingDictionaryDeleteGuard.getDictionaryDeleteDependencies(typeRecord.Id);
        Set<String> dependentNames = new Set<String>();
        for (MarketingDictionaryDeleteGuard.DependencyGroup grp : report.groups) {
            dependentNames.addAll(grp.recordNames);
        }
        System.assert(dependentNames.contains('Everyday Checking'), dependentNames);
        System.assert(dependentNames.contains('Savings'), dependentNames);
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

    private static Marketing_Dictionary__c personValue(String name, String subType) {
        return new Marketing_Dictionary__c(Name = name, RecordTypeId = productDictRt(), Dictionary_Sub_Type__c = subType);
    }

    @IsTest
    static void personRecordsCarryTheirDmoFilter() {
        String filterJson = '{"version":1,"logic":"AND","conditions":[{"field":"Profile_Type__c","type":"text","operator":"eq","value":"B2C"}]}';
        Marketing_Dictionary__c record = personValue('Retail', 'Customer Type');
        record.Data360_Filter_JSON__c = filterJson;
        MarketingDictionaryManagerController.saveProductRecord(record);

        Marketing_Dictionary__c found;
        for (Marketing_Dictionary__c candidate : MarketingDictionaryManagerController.getPersonRecords()) {
            if (candidate.Name == 'Retail') {
                found = candidate;
            }
        }
        System.assertNotEquals(null, found);
        System.assertEquals(filterJson, found.Data360_Filter_JSON__c);
    }

    @IsTest
    static void invalidPersonFilterIsRejectedAndBlankClearsIt() {
        Marketing_Dictionary__c record = personValue('Prospect', 'Audience Type');
        record.Data360_Filter_JSON__c = '{"version":1,"conditions":[{"field":"a; DROP","operator":"eq","value":"x"}]}';
        String message;
        try {
            MarketingDictionaryManagerController.saveProductRecord(record);
        } catch (AuraHandledException e) {
            message = e.getMessage();
        }
        System.assert(message != null && message.contains('not a valid column name'), message);
        System.assertEquals(0, [SELECT COUNT() FROM Marketing_Dictionary__c WHERE Name = 'Prospect']);

        record.Data360_Filter_JSON__c = '   ';
        MarketingDictionaryManagerController.saveProductRecord(record);
        System.assertEquals(null, [SELECT Data360_Filter_JSON__c FROM Marketing_Dictionary__c WHERE Name = 'Prospect'].Data360_Filter_JSON__c);
    }

    // ─── Activation paths ────────────────────────────────────────────────────

    private static Id campaignRt() {
        return Schema.SObjectType.Marketing_Dictionary__c.getRecordTypeInfosByDeveloperName().get('Campaign').getRecordTypeId();
    }

    private static Marketing_Dictionary__c audience(String name) {
        Marketing_Dictionary__c record = personValue(name, 'Audience Type');
        insert record;
        return record;
    }

    private static Marketing_Dictionary__c activationPath(String name, Id audienceId, Boolean active, Decimal percent) {
        return new Marketing_Dictionary__c(
            Name = name,
            RecordTypeId = campaignRt(),
            Dictionary_Sub_Type__c = 'Activation Path',
            Audience_Type_Dict__c = audienceId,
            Is_Active__c = active,
            Distribution_Percent__c = percent
        );
    }

    private static Map<String, Marketing_Dictionary__c> pathsByName() {
        Map<String, Marketing_Dictionary__c> result = new Map<String, Marketing_Dictionary__c>();
        for (Marketing_Dictionary__c path : [
            SELECT Id, Name, Is_Active__c, Distribution_Percent__c, Audience_Type_Dict__c
            FROM Marketing_Dictionary__c
            WHERE Dictionary_Sub_Type__c = 'Activation Path'
        ]) {
            result.put(path.Name, path);
        }
        return result;
    }

    private static String pathSaveError(List<Marketing_Dictionary__c> changes) {
        try {
            MarketingDictionaryManagerController.saveActivationPaths(changes);
        } catch (AuraHandledException e) {
            return e.getMessage();
        }
        return null;
    }

    @IsTest
    static void activationPathsAreRenamedAndReallocatedTogether() {
        Marketing_Dictionary__c customer = audience('Customer');
        insert new List<Marketing_Dictionary__c>{
            activationPath('ML', customer.Id, true, 65), activationPath('Random', customer.Id, true, 35),
            activationPath('Legacy', customer.Id, false, 0)
        };
        Map<String, Marketing_Dictionary__c> before = pathsByName();
        MarketingDictionaryManagerController.saveActivationPaths(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('ML').Id, Name = ' ML v2 ', Distribution_Percent__c = 50),
            new Marketing_Dictionary__c(Id = before.get('Random').Id, Distribution_Percent__c = 25),
            new Marketing_Dictionary__c(Id = before.get('Legacy').Id, Is_Active__c = true, Distribution_Percent__c = 25)
        });
        Map<String, Marketing_Dictionary__c> after = pathsByName();
        System.assertEquals(true, after.containsKey('ML v2'));
        System.assertEquals(50, after.get('ML v2').Distribution_Percent__c);
        System.assertEquals(25, after.get('Random').Distribution_Percent__c);
        System.assertEquals(true, after.get('Legacy').Is_Active__c);
        System.assertEquals(customer.Id, after.get('Legacy').Audience_Type_Dict__c, 'The audience link is kept by Id.');
    }

    @IsTest
    static void eachAudienceTypeSharesItsOwn100Percent() {
        Marketing_Dictionary__c customer = audience('Customer');
        Marketing_Dictionary__c prospect = audience('Prospect');
        insert new List<Marketing_Dictionary__c>{
            activationPath('ML', customer.Id, true, 60), activationPath('Random', customer.Id, true, 40),
            activationPath('Prospect ML', prospect.Id, true, 100)
        };
        Map<String, Marketing_Dictionary__c> before = pathsByName();
        // Customer paths change, the prospect path keeps its own 100%.
        MarketingDictionaryManagerController.saveActivationPaths(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('ML').Id, Distribution_Percent__c = 30),
            new Marketing_Dictionary__c(Id = before.get('Random').Id, Distribution_Percent__c = 70)
        });
        System.assertEquals(30, pathsByName().get('ML').Distribution_Percent__c);
        System.assertEquals(100, pathsByName().get('Prospect ML').Distribution_Percent__c);

        String message = pathSaveError(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('Prospect ML').Id, Distribution_Percent__c = 80)
        });
        System.assert(message != null && message.contains('"Prospect"') && message.contains('exactly 100%'), message);
    }

    @IsTest
    static void movingAPathToAnotherAudienceRechecksBothAudiences() {
        Marketing_Dictionary__c customer = audience('Customer');
        Marketing_Dictionary__c prospect = audience('Prospect');
        insert new List<Marketing_Dictionary__c>{
            activationPath('ML', customer.Id, true, 60), activationPath('Random', customer.Id, true, 40),
            activationPath('Other', prospect.Id, true, 100)
        };
        Map<String, Marketing_Dictionary__c> before = pathsByName();
        String message = pathSaveError(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('Random').Id, Audience_Type_Dict__c = prospect.Id)
        });
        System.assert(message != null && message.contains('exactly 100%'), message);

        MarketingDictionaryManagerController.saveActivationPaths(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('Random').Id, Audience_Type_Dict__c = prospect.Id, Distribution_Percent__c = 50),
            new Marketing_Dictionary__c(Id = before.get('Other').Id, Distribution_Percent__c = 50),
            new Marketing_Dictionary__c(Id = before.get('ML').Id, Distribution_Percent__c = 100)
        });
        System.assertEquals(prospect.Id, pathsByName().get('Random').Audience_Type_Dict__c);
    }

    @IsTest
    static void everyPathNeedsAnExistingAudienceType() {
        Marketing_Dictionary__c customer = audience('Customer');
        Marketing_Dictionary__c notAnAudience = personValue('Retail', 'Customer Type');
        insert notAnAudience;
        insert new List<Marketing_Dictionary__c>{ activationPath('ML', customer.Id, true, 100), activationPath('Old', null, false, 0) };
        Map<String, Marketing_Dictionary__c> before = pathsByName();

        String message = pathSaveError(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('ML').Id, Distribution_Percent__c = 100)
        });
        System.assert(message != null && message.contains('Select an audience type'), message);

        message = pathSaveError(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('Old').Id, Audience_Type_Dict__c = notAnAudience.Id)
        });
        System.assert(message != null && message.contains('does not exist'), message);

        MarketingDictionaryManagerController.saveActivationPaths(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('Old').Id, Audience_Type_Dict__c = customer.Id)
        });
        System.assertEquals(customer.Id, pathsByName().get('Old').Audience_Type_Dict__c);

        message = pathSaveError(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('Old').Id, Audience_Type_Dict__c = null)
        });
        System.assert(message != null && message.contains('Select an audience type'), message);
    }

    @IsTest
    static void deactivatingAPathZeroesItsAllocation() {
        Marketing_Dictionary__c customer = audience('Customer');
        insert new List<Marketing_Dictionary__c>{ activationPath('ML', customer.Id, true, 65), activationPath('Random', customer.Id, true, 35) };
        Map<String, Marketing_Dictionary__c> before = pathsByName();
        MarketingDictionaryManagerController.saveActivationPaths(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('ML').Id, Is_Active__c = false, Distribution_Percent__c = 65),
            new Marketing_Dictionary__c(Id = before.get('Random').Id, Distribution_Percent__c = 100)
        });
        Map<String, Marketing_Dictionary__c> after = pathsByName();
        System.assertEquals(false, after.get('ML').Is_Active__c);
        System.assertEquals(0, after.get('ML').Distribution_Percent__c);
        System.assertEquals(100, after.get('Random').Distribution_Percent__c);
    }

    @IsTest
    static void activationPathAllocationsMustAddUpTo100() {
        Marketing_Dictionary__c customer = audience('Customer');
        insert new List<Marketing_Dictionary__c>{ activationPath('ML', customer.Id, true, 65), activationPath('Random', customer.Id, true, 35) };
        Map<String, Marketing_Dictionary__c> before = pathsByName();
        String message = pathSaveError(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('ML').Id, Distribution_Percent__c = 70)
        });
        System.assert(message != null && message.contains('exactly 100%'), message);
        message = pathSaveError(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('ML').Id, Is_Active__c = false)
        });
        System.assert(message != null && message.contains('exactly 100%'), message);
        System.assertEquals(65, pathsByName().get('ML').Distribution_Percent__c, 'Nothing is saved when validation fails.');

        message = pathSaveError(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('ML').Id, Is_Active__c = false, Distribution_Percent__c = 0),
            new Marketing_Dictionary__c(Id = before.get('Random').Id, Is_Active__c = false, Distribution_Percent__c = 0)
        });
        System.assert(message != null && message.contains('at least one active path'), message);
        message = pathSaveError(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('ML').Id, Distribution_Percent__c = 130),
            new Marketing_Dictionary__c(Id = before.get('Random').Id, Distribution_Percent__c = -30)
        });
        System.assert(message != null && message.contains('between 0 and 100'), message);
    }

    @IsTest
    static void activationPathNamesMustBeFilledInAndUnique() {
        Marketing_Dictionary__c customer = audience('Customer');
        insert new List<Marketing_Dictionary__c>{ activationPath('ML', customer.Id, true, 65), activationPath('Random', customer.Id, true, 35) };
        Map<String, Marketing_Dictionary__c> before = pathsByName();
        String message = pathSaveError(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('ML').Id, Name = ' random ')
        });
        System.assert(message != null && message.contains('must be unique'), message);
        message = pathSaveError(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('ML').Id, Name = '   ')
        });
        System.assert(message != null && message.contains('needs a name'), message);
        message = pathSaveError(new List<Marketing_Dictionary__c>{ new Marketing_Dictionary__c(Name = 'New') });
        System.assert(message != null && message.contains('Only existing'), message);
        System.assertEquals(null, pathSaveError(null));
        System.assertEquals(null, pathSaveError(new List<Marketing_Dictionary__c>()));
    }

    @IsTest
    static void renamingAPathIgnoresAnOlderUnbalancedDistribution() {
        insert new List<Marketing_Dictionary__c>{ activationPath('ML', null, true, 10), activationPath('Random', null, true, 20) };
        Map<String, Marketing_Dictionary__c> before = pathsByName();
        MarketingDictionaryManagerController.saveActivationPaths(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('ML').Id, Name = 'ML renamed')
        });
        Map<String, Marketing_Dictionary__c> after = pathsByName();
        System.assertEquals(10, after.get('ML renamed').Distribution_Percent__c);
        System.assertEquals(20, after.get('Random').Distribution_Percent__c);
    }

    @IsTest
    static void aNewActivationPathMustNameItsAudienceType() {
        Marketing_Dictionary__c customer = audience('Customer');
        String message;
        try {
            MarketingDictionaryManagerController.saveCampaignRecord(activationPath('New', null, false, 0));
        } catch (AuraHandledException e) {
            message = e.getMessage();
        }
        System.assert(message != null && message.contains('audience type'), message);
        Id saved = MarketingDictionaryManagerController.saveCampaignRecord(activationPath('New', customer.Id, false, 0));
        System.assertEquals(customer.Id, [SELECT Audience_Type_Dict__c FROM Marketing_Dictionary__c WHERE Id = :saved].Audience_Type_Dict__c);
    }

    @IsTest
    static void anAudienceTypeUsedByAnActivationPathCannotBeDeleted() {
        Marketing_Dictionary__c customer = audience('Customer');
        insert activationPath('ML', customer.Id, true, 100);
        MarketingDictionaryDeleteGuard.DependencyReport report = MarketingDictionaryDeleteGuard.getDictionaryDeleteDependencies(customer.Id);
        System.assertEquals(true, MarketingDictionaryDeleteGuard.collectBlockingDependencies(customer).size() > 0);
        System.assertNotEquals(null, report);
    }

    @IsTest
    static void activationPathDescriptionsAreTrimmedClearedAndLimited() {
        Marketing_Dictionary__c customer = audience('Customer');
        insert new List<Marketing_Dictionary__c>{ activationPath('ML', customer.Id, true, 65), activationPath('Random', customer.Id, true, 35) };
        Map<String, Marketing_Dictionary__c> before = pathsByName();
        MarketingDictionaryManagerController.saveActivationPaths(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('ML').Id, Path_Description__c = '  Scores customers with the ML model  ')
        });
        System.assertEquals('Scores customers with the ML model', [SELECT Path_Description__c FROM Marketing_Dictionary__c WHERE Id = :before.get('ML').Id].Path_Description__c);
        System.assertEquals(65, pathsByName().get('ML').Distribution_Percent__c, 'A description change leaves the allocation alone.');

        MarketingDictionaryManagerController.saveActivationPaths(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('ML').Id, Path_Description__c = '   ')
        });
        System.assertEquals(null, [SELECT Path_Description__c FROM Marketing_Dictionary__c WHERE Id = :before.get('ML').Id].Path_Description__c);

        String message = pathSaveError(new List<Marketing_Dictionary__c>{
            new Marketing_Dictionary__c(Id = before.get('ML').Id, Path_Description__c = 'x'.repeat(256))
        });
        System.assert(message != null && message.contains('at most 255'), message);
    }

    @IsTest
    static void bannerPlaceholdersCarryTheirImpactCampaignScoreLogicFlag() {
        Marketing_Dictionary__c channel = new Marketing_Dictionary__c(
            Name = 'Banner',
            RecordTypeId = Schema.SObjectType.Marketing_Dictionary__c.getRecordTypeInfosByDeveloperName().get('Channel').getRecordTypeId()
        );
        insert channel;
        Id savedId = MarketingDictionaryManagerController.saveBannerPlacement(JSON.serialize(new Channel_Banner_Placement__c(
            Name = 'PH_HOME_MAIN', Channel__c = channel.Id, Impact_Campaign_Score_Logic__c = true
        )));
        MarketingDictionaryManagerController.saveBannerPlacementsBulk(JSON.serialize(new List<Channel_Banner_Placement__c>{
            new Channel_Banner_Placement__c(Name = 'PH_HOME_TOP', Channel__c = channel.Id)
        }));

        Map<String, Boolean> flags = new Map<String, Boolean>();
        for (Marketing_Dictionary__c record : MarketingDictionaryManagerController.getChannelRecords()) {
            if (record.Id == channel.Id) {
                for (Channel_Banner_Placement__c placement : record.Channel_Banner_Placements__r) {
                    flags.put(placement.Name, placement.Impact_Campaign_Score_Logic__c);
                }
            }
        }
        System.assertNotEquals(null, savedId);
        System.assertEquals(true, flags.get('PH_HOME_MAIN'));
        System.assertEquals(false, flags.get('PH_HOME_TOP'));
    }

    @IsTest
    static void bannerPlaceholdersCanBeMappedToAProductFamilyAndStayEmptyOtherwise() {
        Marketing_Dictionary__c channel = new Marketing_Dictionary__c(
            Name = 'Banner',
            RecordTypeId = Schema.SObjectType.Marketing_Dictionary__c.getRecordTypeInfosByDeveloperName().get('Channel').getRecordTypeId()
        );
        Marketing_Dictionary__c family = new Marketing_Dictionary__c(
            Name = 'Cash Loan',
            RecordTypeId = Schema.SObjectType.Marketing_Dictionary__c.getRecordTypeInfosByDeveloperName().get('Product').getRecordTypeId(),
            Dictionary_Sub_Type__c = 'Product Family'
        );
        insert new List<Marketing_Dictionary__c>{ channel, family };

        MarketingDictionaryManagerController.saveBannerPlacement(JSON.serialize(new Channel_Banner_Placement__c(
            Name = 'PH_LOANS_MAIN', Channel__c = channel.Id, Product_Family_Dict__c = family.Id
        )));
        MarketingDictionaryManagerController.saveBannerPlacementsBulk(JSON.serialize(new List<Channel_Banner_Placement__c>{
            new Channel_Banner_Placement__c(Name = 'PH_HOME_TOP', Channel__c = channel.Id)
        }));

        Map<String, String> familyNames = new Map<String, String>();
        for (Marketing_Dictionary__c record : MarketingDictionaryManagerController.getChannelRecords()) {
            if (record.Id == channel.Id) {
                for (Channel_Banner_Placement__c placement : record.Channel_Banner_Placements__r) {
                    familyNames.put(placement.Name, placement.Product_Family_Dict__r?.Name);
                }
            }
        }
        System.assertEquals('Cash Loan', familyNames.get('PH_LOANS_MAIN'));
        System.assertEquals(null, familyNames.get('PH_HOME_TOP'), 'A placeholder without a product family stays empty');
    }

    @IsTest
    static void onlyProductFamiliesCanBeMappedToABannerPlaceholder() {
        Marketing_Dictionary__c channel = new Marketing_Dictionary__c(
            Name = 'Banner',
            RecordTypeId = Schema.SObjectType.Marketing_Dictionary__c.getRecordTypeInfosByDeveloperName().get('Channel').getRecordTypeId()
        );
        Marketing_Dictionary__c topic = new Marketing_Dictionary__c(
            Name = 'Cross-sell',
            RecordTypeId = Schema.SObjectType.Marketing_Dictionary__c.getRecordTypeInfosByDeveloperName().get('Campaign').getRecordTypeId(),
            Dictionary_Sub_Type__c = 'Topic'
        );
        insert new List<Marketing_Dictionary__c>{ channel, topic };

        String message;
        try {
            MarketingDictionaryManagerController.saveBannerPlacement(JSON.serialize(new Channel_Banner_Placement__c(
                Name = 'PH_WRONG', Channel__c = channel.Id, Product_Family_Dict__c = topic.Id
            )));
        } catch (Exception e) {
            message = e.getMessage();
        }
        System.assertNotEquals(null, message, 'A topic is not a product family');
    }
}
