@isTest
private class ProductMassUpdateControllerTest {

    private static Id productDictRt() {
        return Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Product').getRecordTypeId();
    }

    private static Marketing_Dictionary__c makeDict(String name, String subType) {
        return new Marketing_Dictionary__c(
            Name = name,
            RecordTypeId = productDictRt(),
            Dictionary_Sub_Type__c = subType
        );
    }

    @testSetup
    static void setupTestData() {
        insert new List<Marketing_Dictionary__c>{
            makeDict('Test Product Family', 'Product Family'),
            makeDict('Test Family of Needs', 'Family of Needs'),
            makeDict('Test Customer Type', 'Customer Type')
        };

        List<Product2> testProducts = new List<Product2>();
        for (Integer i = 0; i < 5; i++) {
            testProducts.add(new Product2(Name = 'Test Product ' + i, IsActive = true));
        }
        insert testProducts;
    }

    private static ProductMassUpdateController buildController(List<Product2> selected) {
        ApexPages.StandardSetController ssc =
            new ApexPages.StandardSetController([SELECT Id, Name FROM Product2]);
        ssc.setSelected(selected);
        return new ProductMassUpdateController(ssc);
    }

    private static Id dictId(String subType) {
        return [SELECT Id FROM Marketing_Dictionary__c WHERE Dictionary_Sub_Type__c = :subType LIMIT 1].Id;
    }

    @isTest
    static void testUpdateProductFamilyDict_Success() {
        List<Product2> products = [SELECT Id FROM Product2];
        ProductMassUpdateController c = buildController(products);
        Id fam = dictId('Product Family');
        c.dummyProduct.Product_Family_Dict__c = fam;

        Test.startTest();
        PageReference pr = c.updateProductFamilyDict();
        Test.stopTest();

        System.assertNotEquals(null, pr, 'Should return a PageReference on success.');
        for (Product2 p : [SELECT Product_Family_Dict__c FROM Product2]) {
            System.assertEquals(fam, p.Product_Family_Dict__c, 'Product Family lookup should be updated.');
        }
    }

    @isTest
    static void testUpdateFamilyOfNeedsDict_Success() {
        List<Product2> products = [SELECT Id FROM Product2];
        ProductMassUpdateController c = buildController(products);
        Id needs = dictId('Family of Needs');
        c.dummyProduct.Family_of_Needs_Dict__c = needs;

        Test.startTest();
        PageReference pr = c.updateFamilyOfNeedsDict();
        Test.stopTest();

        System.assertNotEquals(null, pr, 'Should return a PageReference on success.');
        for (Product2 p : [SELECT Family_of_Needs_Dict__c FROM Product2]) {
            System.assertEquals(needs, p.Family_of_Needs_Dict__c, 'Family of Needs lookup should be updated.');
        }
    }

    @isTest
    static void testUpdateCustomerTypeDict_Success() {
        List<Product2> products = [SELECT Id FROM Product2];
        ProductMassUpdateController c = buildController(products);
        Id ct = dictId('Customer Type');
        c.selectedCustomerTypeId = ct;

        Test.startTest();
        PageReference pr = c.updateCustomerTypeDict();
        Test.stopTest();

        System.assertNotEquals(null, pr, 'Should return a PageReference on success.');
        System.assertEquals(products.size(),
            [SELECT COUNT() FROM Product_Customer_Type__c WHERE Customer_Type__c = :ct],
            'One junction record should be created per selected product.');
    }

    @isTest
    static void testGetCustomerTypeOptions() {
        ProductMassUpdateController c = buildController(new List<Product2>());
        Test.startTest();
        List<SelectOption> opts = c.getCustomerTypeOptions();
        Test.stopTest();
        System.assert(opts.size() >= 2,
            'Options should include the placeholder plus at least one Customer Type dictionary entry.');
    }

    @isTest
    static void testNoRecordsSelected() {
        ProductMassUpdateController c = buildController(new List<Product2>());
        Test.startTest();
        PageReference prFamily = c.updateProductFamilyDict();
        PageReference prNeeds  = c.updateFamilyOfNeedsDict();
        PageReference prCt     = c.updateCustomerTypeDict();
        Test.stopTest();

        System.assertEquals(null, prFamily, 'Should return null when no records are selected.');
        System.assertEquals(null, prNeeds, 'Should return null when no records are selected.');
        System.assertEquals(null, prCt, 'Should return null when no records are selected.');
        System.assert(ApexPages.hasMessages(ApexPages.Severity.WARNING),
            'A warning message should be displayed to the user.');
    }

    @isTest
    static void testMissingSelectionValues() {
        List<Product2> products = [SELECT Id FROM Product2];
        ProductMassUpdateController c = buildController(products);
        // dummyProduct lookups and selectedCustomerTypeId intentionally left blank
        Test.startTest();
        PageReference prFamily = c.updateProductFamilyDict();
        PageReference prNeeds  = c.updateFamilyOfNeedsDict();
        PageReference prCt     = c.updateCustomerTypeDict();
        Test.stopTest();

        System.assertEquals(null, prFamily, 'Should return null when no Product Family is chosen.');
        System.assertEquals(null, prNeeds, 'Should return null when no Family of Needs is chosen.');
        System.assertEquals(null, prCt, 'Should return null when no Customer Type is chosen.');
        System.assert(ApexPages.hasMessages(ApexPages.Severity.WARNING),
            'A warning message should be displayed to the user.');
    }

    @isTest
    static void testDmlException() {
        List<Product2> products = [SELECT Id FROM Product2];
        ProductMassUpdateController c = buildController(products);
        c.dummyProduct.Product_Family_Dict__c = dictId('Product Family');

        // Delete the underlying records to force a DML exception during update
        delete products;

        Test.startTest();
        PageReference pr = c.updateProductFamilyDict();
        Test.stopTest();

        System.assertEquals(null, pr, 'Should return null on a DML exception.');
        System.assert(ApexPages.hasMessages(), 'An error message should be added to the page.');
    }
}