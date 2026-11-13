@IsTest
private class CampaignCopyVariantHandlerTest {
    @IsTest
    static void clearsEligibilityWhenAVariantLeavesPublished() {
        CC_Message_Metadata__c variant = new CC_Message_Metadata__c(
            Name = 'EMA_PL_Handler_1',
            MessageName__c = 'EMA_PL_Handler',
            MessageVariantId__c = 'handler-variant-1',
            Status__c = 'Published'
        );
        insert variant;
        Campaign campaign = new Campaign(Name = 'Copy Campaign', IsActive = true);
        insert campaign;
        insert new Campaign_Copy_Variant__c(
            Campaign__c = campaign.Id,
            Message_Variant__c = variant.Id,
            Is_Eligible__c = true
        );

        CC_Message_Metadata__c prior = variant.clone(true, true, true, true);
        variant.Status__c = 'Draft';
        CampaignCopyVariantHandler.handleMessageStatusChanges(
            new List<CC_Message_Metadata__c>{ variant },
            new Map<Id, CC_Message_Metadata__c>{ variant.Id => prior }
        );

        System.assertEquals(
            false,
            [SELECT Is_Eligible__c FROM Campaign_Copy_Variant__c WHERE Message_Variant__c = :variant.Id].Is_Eligible__c
        );
        CampaignCopyVariantHandler.handleMessageStatusChanges(null, null);
        CampaignCopyVariantHandler.handleMessageStatusChanges(
            new List<CC_Message_Metadata__c>{ variant },
            new Map<Id, CC_Message_Metadata__c>()
        );
    }
}
