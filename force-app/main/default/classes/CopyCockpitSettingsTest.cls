@IsTest
private class CopyCockpitSettingsTest {
    @IsTest
    static void savesProductFamilyAndOfferOnEveryVariant() {
        Id recordTypeId = [
            SELECT Id
            FROM RecordType
            WHERE SObjectType = 'Marketing_Dictionary__c'
            AND DeveloperName = 'Product'
            LIMIT 1
        ].Id;
        Marketing_Dictionary__c family = new Marketing_Dictionary__c(
            Name = 'Cash Loan Family',
            RecordTypeId = recordTypeId,
            Dictionary_Sub_Type__c = 'Product Family'
        );
        insert family;
        Offer__c offer = new Offer__c(
            Name = 'Cash Offer',
            Country_Code__c = 'PL',
            Is_Active__c = true
        );
        insert offer;
        CC_Message_Metadata__c firstVariant = new CC_Message_Metadata__c(
            Name = 'EMA_PL_Cash_1',
            Channel_Type__c = 'Email'
        );
        CC_Message_Metadata__c secondVariant = new CC_Message_Metadata__c(
            Name = 'EMA_PL_Cash_2',
            Channel_Type__c = 'Email'
        );
        insert new List<CC_Message_Metadata__c>{ firstVariant, secondVariant };

        CopyCockpitController.saveMasterRowSettings(JSON.serialize(new Map<String, Object>{
            'productFamilyId' => family.Id,
            'offerId' => offer.Id,
            'variantIds' => new List<Object>{ firstVariant.Id, secondVariant.Id }
        }));

        Map<Id, CC_Message_Metadata__c> saved = new Map<Id, CC_Message_Metadata__c>([
            SELECT Product_Family__c, Product_Family__r.Name, Offer__c, Offer__r.Name,
                   Display_Probability_Manual__c
            FROM CC_Message_Metadata__c
            WHERE Id IN :new Set<Id>{ firstVariant.Id, secondVariant.Id }
        ]);
        System.assertEquals(family.Id, saved.get(firstVariant.Id).Product_Family__c);
        System.assertEquals('Cash Loan Family', saved.get(firstVariant.Id).Product_Family__r.Name);
        System.assertEquals(offer.Id, saved.get(firstVariant.Id).Offer__c);
        System.assertEquals(offer.Id, saved.get(secondVariant.Id).Offer__c);
        System.assertEquals(family.Id, saved.get(secondVariant.Id).Product_Family__c);
        List<CC_Message_Metadata__c> listed = CopyCockpitController.getMessagesByChannelType('Email');
        System.assertEquals(2, listed.size());
        System.assertEquals(family.Id, listed[0].Product_Family__c);
        System.assertEquals('Cash Offer', listed[0].Offer__r.Name);
    }

    @IsTest
    static void updateMessageSourceTemplates_rejectsDraftTemplate() {
        Id channelRt = [
            SELECT Id FROM RecordType
            WHERE SObjectType = 'Marketing_Dictionary__c' AND DeveloperName = 'Channel'
            LIMIT 1
        ].Id;
        Marketing_Dictionary__c channel = new Marketing_Dictionary__c(
            Name = 'Wizard Email Channel',
            RecordTypeId = channelRt,
            Is_Active__c = true
        );
        insert channel;
        Id draftTemplateId = ChannelTemplateController.saveTemplate(
            new Channel_Template__c(
                Name = 'Draft Shell',
                Status__c = 'Draft',
                Version__c = 1,
                Description__c = 'Not yet validated'
            ),
            channel.Id
        );
        CC_Message_Metadata__c variant = new CC_Message_Metadata__c(
            Name = 'EMA_PL_Tpl_1',
            Channel_Type__c = 'Email'
        );
        insert variant;

        Boolean threw = false;
        try {
            CopyCockpitController.updateMessageSourceTemplates(
                new List<Id>{ variant.Id },
                draftTemplateId
            );
        } catch (Exception e) {
            threw = true;
        }
        System.assertEquals(true, threw, 'Draft template must be rejected');
    }

    @IsTest
    static void getPublishedVariantsForWizard_filtersByChannelOfferingAndStatus() {
        Id recordTypeId = [
            SELECT Id
            FROM RecordType
            WHERE SObjectType = 'Marketing_Dictionary__c'
            AND DeveloperName = 'Product'
            LIMIT 1
        ].Id;
        Marketing_Dictionary__c family = new Marketing_Dictionary__c(
            Name = 'Wizard PF',
            RecordTypeId = recordTypeId,
            Dictionary_Sub_Type__c = 'Product Family'
        );
        insert family;
        Offer__c offer = new Offer__c(
            Name = 'Wizard Offer',
            Country_Code__c = 'PL',
            Is_Active__c = true
        );
        insert offer;

        CC_Message_Metadata__c publishedMatch = new CC_Message_Metadata__c(
            Name = 'EMA_PL_Wiz_1',
            Status__c = 'Published',
            Product_Family__c = family.Id,
            Offer__c = offer.Id
        );
        CC_Message_Metadata__c draftSame = new CC_Message_Metadata__c(
            Name = 'EMA_PL_Wiz_2',
            Status__c = 'Draft',
            Product_Family__c = family.Id,
            Offer__c = offer.Id
        );
        CC_Message_Metadata__c publishedOtherChannel = new CC_Message_Metadata__c(
            Name = 'SMS_PL_Wiz_1',
            Status__c = 'Published',
            Product_Family__c = family.Id,
            Offer__c = offer.Id
        );
        insert new List<CC_Message_Metadata__c>{ publishedMatch, draftSame, publishedOtherChannel };

        List<CC_Message_Metadata__c> results = CopyCockpitController.getPublishedVariantsForWizard(
            new List<String>{ 'Email' },
            new List<String>{ 'Wizard PF' },
            new List<String>{ offer.Id }
        );

        System.assertEquals(1, results.size(), 'Only published Email variant for offering should return');
        System.assertEquals(publishedMatch.Id, results[0].Id);
    }

    @IsTest
    static void saveVariantDisplayWeight_persistsManualProbability() {
        CC_Message_Metadata__c row = new CC_Message_Metadata__c(
            Name = 'EMA_PL_Weight_1',
            Channel_Type__c = 'Email'
        );
        insert row;

        CopyCockpitController.saveVariantDisplayWeight(row.Id, 78);

        row = [
            SELECT Display_Probability_Manual__c, MCE_Last_Modified_By__c, MCE_Updated_At__c
            FROM CC_Message_Metadata__c
            WHERE Id = :row.Id
        ];
        System.assertEquals(0.78, row.Display_Probability_Manual__c);
        System.assertEquals(UserInfo.getName(), row.MCE_Last_Modified_By__c);
        System.assertNotEquals(null, row.MCE_Updated_At__c);
    }

    @IsTest
    static void updateMessageStatus_changesVariantStatus() {
        CC_Message_Metadata__c row = new CC_Message_Metadata__c(
            Name = 'EMA_PL_StatusTest_1',
            Status__c = 'Draft'
        );
        insert row;

        CopyCockpitController.updateMessageStatus(row.Id, 'Published');

        row = [SELECT Status__c FROM CC_Message_Metadata__c WHERE Id = :row.Id];
        System.assertEquals('Published', row.Status__c);
    }

    @IsTest
    static void updateMessageStatus_blocksPublishedToDraft() {
        CC_Message_Metadata__c row = new CC_Message_Metadata__c(
            Name = 'EMA_PL_StatusBlock_1',
            Status__c = 'Published'
        );
        insert row;

        Boolean rejected = false;
        try {
            CopyCockpitController.assertAllowedStatusTransition('Published', 'Draft');
        } catch (AuraHandledException ex) {
            rejected = true;
        }
        System.assertEquals(true, rejected, 'Published → Draft must be rejected');
    }

    @IsTest
    static void updateMessageStatus_allowsPublishedToInactive() {
        CC_Message_Metadata__c row = new CC_Message_Metadata__c(
            Name = 'EMA_PL_StatusInactive_1',
            Status__c = 'Published'
        );
        insert row;

        CopyCockpitController.updateMessageStatus(row.Id, 'Inactive');

        row = [SELECT Status__c FROM CC_Message_Metadata__c WHERE Id = :row.Id];
        System.assertEquals('Inactive', row.Status__c);
    }

    @IsTest
    static void deleteMessageVariants_removesMetadataAndBlocks() {
        CC_Message_Metadata__c variant = new CC_Message_Metadata__c(
            Name = 'EMA_PL_Del_1',
            MessageName__c = 'EMA_PL_Del',
            MessageVariantId__c = '00000000-0000-0000-0000-000000000099',
            MessageVariant__c = 1,
            Version__c = 1
        );
        insert variant;
        CC_Message_Blocks_All__c block = new CC_Message_Blocks_All__c(
            Name = 'block-del-1',
            MessageName__c = 'EMA_PL_Del',
            MessageVariantId__c = '00000000-0000-0000-0000-000000000099',
            MessageVariant__c = 1,
            ContentBlockOrder__c = 1,
            BlockType__c = 'Content'
        );
        insert block;

        Integer deleted = CopyCockpitController.deleteMessageVariants(new List<Id>{ variant.Id });

        System.assertEquals(1, deleted);
        System.assertEquals(0, [SELECT COUNT() FROM CC_Message_Metadata__c WHERE Id = :variant.Id]);
        System.assertEquals(0, [SELECT COUNT() FROM CC_Message_Blocks_All__c WHERE Id = :block.Id]);
    }

    @IsTest
    static void deleteMasterMessageGroup_removesAllVariantsInStem() {
        CC_Message_Metadata__c first = new CC_Message_Metadata__c(
            Name = 'EMA_PL_MasterDel_1',
            MessageName__c = 'EMA_PL_MasterDel',
            MessageVariant__c = 1,
            Version__c = 1
        );
        CC_Message_Metadata__c second = new CC_Message_Metadata__c(
            Name = 'EMA_PL_MasterDel_2',
            MessageName__c = 'EMA_PL_MasterDel',
            MessageVariant__c = 2,
            Version__c = 2
        );
        insert new List<CC_Message_Metadata__c>{ first, second };

        Integer deleted = CopyCockpitController.deleteMasterMessageGroup('EMA_PL_MasterDel', 'Email');

        System.assertEquals(2, deleted);
        System.assertEquals(0, [
            SELECT COUNT()
            FROM CC_Message_Metadata__c
            WHERE MessageName__c = 'EMA_PL_MasterDel'
        ]);
    }

    @IsTest
    static void assertCanAssignSourceTemplate_blocksPublishedVariant() {
        CC_Message_Metadata__c variant = new CC_Message_Metadata__c(
            Name = 'EMA_PL_TplBlock_1',
            Status__c = 'Published'
        );
        insert variant;

        Boolean threw = false;
        try {
            CopyCockpitController.assertCanAssignSourceTemplate(new Set<Id>{ variant.Id });
        } catch (AuraHandledException e) {
            threw = true;
        }
        System.assertEquals(true, threw, 'Published variant must block template assignment');
    }
}