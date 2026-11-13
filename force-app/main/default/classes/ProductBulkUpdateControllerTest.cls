@IsTest
private class ProductBulkUpdateControllerTest {
    @IsTest
    static void readsActiveCustomerTypesAndRejectsAnEmptyUpdate() {
        System.assert(!ProductBulkUpdateController.getCustomerTypeValues().isEmpty());
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
