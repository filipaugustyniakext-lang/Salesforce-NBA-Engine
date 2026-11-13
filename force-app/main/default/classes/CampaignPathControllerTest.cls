@IsTest
private class CampaignPathControllerTest {
    @IsTest
    static void readsAndSavesAllocations() {
        Campaign campaign = new Campaign(Name = 'Path Campaign', IsActive = true);
        insert campaign;
        Campaign_Path_Allocation__c allocation = new Campaign_Path_Allocation__c(
            Campaign__c = campaign.Id,
            Path_Name__c = 'Primary',
            Path_Propability__c = 60,
            Path_Status__c = true
        );
        CampaignPathController.saveAllocations(
            new List<Campaign_Path_Allocation__c>{ allocation },
            new List<Campaign_Path_Allocation__c>()
        );

        System.assertEquals(1, CampaignPathController.getAllPathAllocations().size());
        System.assertEquals(1, CampaignPathController.getPathAllocations(campaign.Id).size());
        System.assert(!CampaignPathController.getActiveCampaigns().isEmpty());

        allocation.Path_Propability__c = 40;
        CampaignPathController.saveAllocations(
            new List<Campaign_Path_Allocation__c>{ allocation },
            null
        );
        CampaignPathController.deleteSingleAllocation(allocation.Id);
        System.assertEquals(0, CampaignPathController.getPathAllocations(campaign.Id).size());
    }

    @IsTest
    static void reportsADeleteFailure() {
        try {
            CampaignPathController.deleteSingleAllocation(null);
            System.assert(false, 'Expected a delete failure');
        } catch (AuraHandledException error) {
            System.assertNotEquals(null, error);
        }
    }
}
