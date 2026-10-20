@IsTest
private class CampaignCopyVariantHandlerTest {

    @IsTest
    static void archivingPublishedVariant_marksJunctionIneligible() {
        Campaign camp = new Campaign(
            Name = 'Test Camp',
            IsActive = false,
            Status = 'Planned'
        );
        insert camp;

        CC_Message_Metadata__c variant = new CC_Message_Metadata__c(
            Name = 'EMA_PL_Handler_1',
            Channel_Type__c = 'Email',
            Status__c = 'Published'
        );
        insert variant;

        insert new Campaign_Copy_Variant__c(
            Campaign__c = camp.Id,
            Message_Variant__c = variant.Id,
            Is_Eligible__c = true
        );

        Test.startTest();
        variant.Status__c = 'Archived';
        update variant;
        Test.stopTest();

        Campaign_Copy_Variant__c junction = [
            SELECT Is_Eligible__c
            FROM Campaign_Copy_Variant__c
            WHERE Campaign__c = :camp.Id
            LIMIT 1
        ];
        System.assertEquals(false, junction.Is_Eligible__c, 'Junction should be ineligible when variant leaves Published');
    }
}