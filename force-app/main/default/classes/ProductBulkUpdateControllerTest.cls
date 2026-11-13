@IsTest
private class ProductBulkUpdateControllerTest {
    @IsTest
    static void readsActiveCustomerTypesAndRejectsAnEmptyUpdate() {
        List<String> values = ProductBulkUpdateController.getCustomerTypeValues();
        System.assert(!values.isEmpty());
        Product2 product = new Product2(Name = 'Bulk Product', IsActive = true);
        insert product;
        ProductBulkUpdateController.updateCustomerType(new List<Id>{ product.Id }, values[0]);
        System.assertEquals(values[0], [SELECT Customer_Type__c FROM Product2 WHERE Id = :product.Id].Customer_Type__c);
        try {
            ProductBulkUpdateController.updateCustomerType(null, 'Retail');
            System.assert(false, 'Expected missing ids to be rejected');
        } catch (AuraHandledException error) {
            System.assertNotEquals(null, error);
        }
        try {
            ProductBulkUpdateController.updateCustomerType(new List<Id>{ '01t000000000001' }, null);
            System.assert(false, 'Expected a missing value to be rejected');
        } catch (AuraHandledException error) {
            System.assertNotEquals(null, error);
        }
    }
}
