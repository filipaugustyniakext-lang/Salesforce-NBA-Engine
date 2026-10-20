@IsTest
private class MarketingDictionaryDeleteGuardTest {

    private static Id productDictRt() {
        return Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Product').getRecordTypeId();
    }

    private static Id campaignDictRt() {
        return Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Campaign').getRecordTypeId();
    }

    private static Id channelDictRt() {
        return Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Channel').getRecordTypeId();
    }

    @IsTest
    static void campaignGroupBlockedWhenCampaignReferences() {
        Marketing_Dictionary__c groupRec = new Marketing_Dictionary__c(
            Name = 'Spring Group',
            RecordTypeId = campaignDictRt(),
            Dictionary_Sub_Type__c = 'Campaign Group'
        );
        insert groupRec;

        Campaign camp = new Campaign(
            Name = 'Blocked Camp',
            Status = 'Planned',
            IsActive = false,
            Campaign_Group_Dict__c = groupRec.Id
        );
        insert camp;

        Marketing_Dictionary__c wrapper = [
            SELECT Id, Name, Dictionary_Sub_Type__c, RecordType.DeveloperName
            FROM Marketing_Dictionary__c
            WHERE Id = :groupRec.Id
        ];
        MarketingDictionaryDeleteGuard.DependencyReport report =
            MarketingDictionaryDeleteGuard.buildDictionaryDeleteReport(wrapper);
        System.assert(report.hasDependencies(), 'Campaign group should be blocked');
        System.assertEquals('Campaign', report.groups[0].category);
        System.assert(report.groups[0].recordNames.contains('Blocked Camp'), report.toString());
    }

    @IsTest
    static void campaignTierDeleteBlockedByCampaignPriorityTier() {
        Campaign_Tier__c tier = new Campaign_Tier__c(Tier_Number__c = 2);
        insert tier;

        insert new Campaign(
            Name = 'Tiered Camp',
            Status = 'Planned',
            IsActive = false,
            Priority_Tier__c = 'Tier 2'
        );

        Boolean blocked = false;
        Test.startTest();
        try {
            MarketingDictionaryDeleteGuard.assertCampaignTierDeletable(tier.Id);
        } catch (AuraHandledException e) {
            blocked = true;
            System.assert(
                e.getMessage().contains('must be removed before it can be deleted'),
                e.getMessage()
            );
        }
        Test.stopTest();
        System.assertEquals(true, blocked);
    }

    @IsTest
    static void renameImpactForCampaignTypeWithCampaigns() {
        Marketing_Dictionary__c typeRec = new Marketing_Dictionary__c(
            Name = 'Always-on',
            RecordTypeId = campaignDictRt(),
            Dictionary_Sub_Type__c = 'Campaign Type'
        );
        insert typeRec;

        insert new Campaign(
            Name = 'AO Camp',
            Status = 'Planned',
            IsActive = false,
            Activation_Type__c = 'Always-on'
        );

        MarketingDictionaryDeleteGuard.RenameImpact impact =
            MarketingDictionaryDeleteGuard.getRenameImpact(typeRec.Id, 'Always On Plus');
        System.assertEquals(true, impact.requiresConfirmation);
        System.assert(impact.message.contains('Activation Type'), impact.message);
    }

    @IsTest
    static void channelBlockedByCampaignSelectionAndCopyCenter() {
        Marketing_Dictionary__c channel = new Marketing_Dictionary__c(
            Name = 'Email',
            RecordTypeId = channelDictRt(),
            Channel_Type__c = 'Email',
            Is_Active__c = true
        );
        insert channel;

        insert new Campaign(
            Name = 'Email Camp',
            Status = 'Planned',
            IsActive = false,
            Assigned_Channels__c = 'Email; SMS'
        );

        insert new CC_Message_Metadata__c(
            Name = 'EMA_PL_Test',
            Channel_Type__c = 'Email',
            Channel__c = 'Email'
        );

        Marketing_Dictionary__c wrapper = [
            SELECT Id, Name, Dictionary_Sub_Type__c, Channel_Type__c, RecordType.DeveloperName
            FROM Marketing_Dictionary__c
            WHERE Id = :channel.Id
        ];
        MarketingDictionaryDeleteGuard.DependencyReport report =
            MarketingDictionaryDeleteGuard.buildDictionaryDeleteReport(wrapper);
        System.assertEquals(true, report.hasDependencies(), 'Channel should be blocked.');
        Set<String> categories = new Set<String>();
        for (MarketingDictionaryDeleteGuard.DependencyGroup grp : report.groups) {
            categories.add(grp.category);
        }
        System.assert(categories.contains('Campaign (channel selection)'), categories.toString());
        System.assert(categories.contains('Copy Center message variant'), categories.toString());
    }

    @IsTest
    static void tokenHelpers() {
        Marketing_Dictionary__c typeRecord = new Marketing_Dictionary__c(
            Name = 'Token Type',
            RecordTypeId = productDictRt(),
            Dictionary_Sub_Type__c = 'Product Type'
        );
        insert typeRecord;
        System.assertEquals(
            true,
            MarketingDictionaryDeleteGuard.containsDictionaryId(typeRecord.Id + ';x', typeRecord.Id)
        );
        System.assertEquals(
            true,
            MarketingDictionaryDeleteGuard.semicolonListContainsLabel('Email; SMS', 'sms')
        );
    }
}