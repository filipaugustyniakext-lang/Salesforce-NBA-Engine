public with sharing class ProductBulkUpdateController {

    @AuraEnabled(cacheable=true)
    public static List<String> getCustomerTypeValues() {
        List<String> options = new List<String>();
        Schema.DescribeFieldResult fieldResult = Product2.Customer_Type__c.getDescribe();
        for (Schema.PicklistEntry entry : fieldResult.getPicklistValues()) {
            if (entry.isActive()) {
                options.add(entry.getLabel());
            }
        }
        return options;
    }

    @AuraEnabled
    public static void updateCustomerType(List<Id> productIds, String customerTypeValue) {
        if (productIds == null || productIds.isEmpty()) {
            throw new AuraHandledException('No product IDs provided.');
        }
        if (String.isBlank(customerTypeValue)) {
            throw new AuraHandledException('Customer Type value is required.');
        }

        List<Product2> productsToUpdate = new List<Product2>();
        for (Id productId : productIds) {
            productsToUpdate.add(new Product2(Id = productId, Customer_Type__c = customerTypeValue));
        }

        try {
            update productsToUpdate;
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to update products: ' + e.getMessage());
        }
    }
}