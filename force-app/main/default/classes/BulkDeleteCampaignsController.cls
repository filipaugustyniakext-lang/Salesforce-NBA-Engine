public with sharing class BulkDeleteCampaignsController {
    private ApexPages.StandardSetController setController;

    public BulkDeleteCampaignsController(ApexPages.StandardSetController controller) {
        this.setController = controller;
    }

    // NEW: Method to safely pass the count of selected records to the Visualforce page
    public Integer getSelectedCount() {
        return this.setController.getSelected().size();
    }

    public PageReference deleteSelectedRecords() {
        List<Campaign> selectedCampaigns = (List<Campaign>) setController.getSelected();

        if (selectedCampaigns == null || selectedCampaigns.isEmpty()) {
            ApexPages.addMessage(new ApexPages.Message(
                ApexPages.Severity.WARNING, 
                'Please select at least one Campaign to delete.'
            ));
            return null;
        }

        try {
            delete selectedCampaigns;
        } catch (DmlException e) {
            ApexPages.addMessages(e);
            return null; 
        }

        Schema.DescribeSObjectResult result = Campaign.SObjectType.getDescribe();
        PageReference pageRef = new PageReference('/' + result.getKeyPrefix());
        pageRef.setRedirect(true);
        return pageRef;
    }
}