public with sharing class ProductMassUpdateController {
    private ApexPages.StandardSetController standardController;
    public Product2 dummyProduct { get; set; }
    public List<Product2> selectedRecords { get; set; }
    public String selectedCustomerTypeId { get; set; }

    public ProductMassUpdateController(ApexPages.StandardSetController controller) {
        this.standardController = controller;
        this.selectedRecords = (List<Product2>) controller.getSelected();
        this.dummyProduct = new Product2();
    }

    public List<SelectOption> getCustomerTypeOptions() {
        List<SelectOption> opts = new List<SelectOption>();
        opts.add(new SelectOption('', '— Select —'));
        for (Marketing_Dictionary__c rec : [
            SELECT Id, Name FROM Marketing_Dictionary__c
            WHERE RecordType.DeveloperName = 'Product'
            AND Dictionary_Sub_Type__c = 'Customer Type'
            ORDER BY Name ASC
        ]) {
            opts.add(new SelectOption(rec.Id, rec.Name));
        }
        return opts;
    }

    public PageReference updateProductFamilyDict() {
        if (selectedRecords.isEmpty()) {
            ApexPages.addMessage(new ApexPages.Message(ApexPages.Severity.WARNING, 'Please select at least one record.'));
            return null;
        }
        Id dictId = dummyProduct.Product_Family_Dict__c;
        if (dictId == null) {
            ApexPages.addMessage(new ApexPages.Message(ApexPages.Severity.WARNING, 'Please select a Product Family.'));
            return null;
        }
        for (Product2 p : selectedRecords) p.Product_Family_Dict__c = dictId;
        try {
            update selectedRecords;
            return standardController.cancel();
        } catch (Exception e) {
            ApexPages.addMessages(e);
            return null;
        }
    }

    public PageReference updateFamilyOfNeedsDict() {
        if (selectedRecords.isEmpty()) {
            ApexPages.addMessage(new ApexPages.Message(ApexPages.Severity.WARNING, 'Please select at least one record.'));
            return null;
        }
        Id dictId = dummyProduct.Family_of_Needs_Dict__c;
        if (dictId == null) {
            ApexPages.addMessage(new ApexPages.Message(ApexPages.Severity.WARNING, 'Please select a Family of Needs.'));
            return null;
        }
        for (Product2 p : selectedRecords) p.Family_of_Needs_Dict__c = dictId;
        try {
            update selectedRecords;
            return standardController.cancel();
        } catch (Exception e) {
            ApexPages.addMessages(e);
            return null;
        }
    }

    public PageReference updateCustomerTypeDict() {
        if (selectedRecords.isEmpty()) {
            ApexPages.addMessage(new ApexPages.Message(ApexPages.Severity.WARNING, 'Please select at least one record.'));
            return null;
        }
        if (String.isBlank(selectedCustomerTypeId)) {
            ApexPages.addMessage(new ApexPages.Message(ApexPages.Severity.WARNING, 'Please select a Customer Type.'));
            return null;
        }
        Id ctId = (Id) selectedCustomerTypeId;
        Set<Id> productIds = new Set<Id>();
        for (Product2 p : selectedRecords) productIds.add(p.Id);

        // Delete existing junction records for selected products, then insert new ones
        delete [SELECT Id FROM Product_Customer_Type__c WHERE Product__c IN :productIds AND Customer_Type__c = :ctId];
        List<Product_Customer_Type__c> toInsert = new List<Product_Customer_Type__c>();
        for (Id pid : productIds) {
            toInsert.add(new Product_Customer_Type__c(Product__c = pid, Customer_Type__c = ctId));
        }
        try {
            insert toInsert;
            return standardController.cancel();
        } catch (Exception e) {
            ApexPages.addMessages(e);
            return null;
        }
    }
}
