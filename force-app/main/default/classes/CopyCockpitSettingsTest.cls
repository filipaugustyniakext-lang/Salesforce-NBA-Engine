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
            'variants' => new List<Object>{
                new Map<String, Object>{ 'id' => firstVariant.Id, 'probability' => 0.4 },
                new Map<String, Object>{ 'id' => secondVariant.Id, 'probability' => 0.6 }
            }
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
        System.assert(saved.get(firstVariant.Id).Display_Probability_Manual__c == 0.4);

        List<CC_Message_Metadata__c> listed = CopyCockpitController.getMessagesByChannelType('Email');
        System.assertEquals(2, listed.size());
        System.assertEquals(family.Id, listed[0].Product_Family__c);
        System.assertEquals('Cash Offer', listed[0].Offer__r.Name);
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
            Channel_Type__c = 'Email',
            Status__c = 'Published',
            Product_Family__c = family.Id,
            Offer__c = offer.Id
        );
        CC_Message_Metadata__c draftSame = new CC_Message_Metadata__c(
            Name = 'EMA_PL_Wiz_2',
            Channel_Type__c = 'Email',
            Status__c = 'Draft',
            Product_Family__c = family.Id,
            Offer__c = offer.Id
        );
        CC_Message_Metadata__c publishedOtherChannel = new CC_Message_Metadata__c(
            Name = 'SMS_PL_Wiz_1',
            Channel_Type__c = 'SMS',
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
    static void updateMessageStatus_changesVariantStatus() {
        CC_Message_Metadata__c row = new CC_Message_Metadata__c(
            Name = 'EMA_PL_StatusTest_1',
            Channel_Type__c = 'Email',
            Status__c = 'Draft'
        );
        insert row;

        CopyCockpitController.updateMessageStatus(row.Id, 'Published');

        row = [SELECT Status__c FROM CC_Message_Metadata__c WHERE Id = :row.Id];
        System.assertEquals('Published', row.Status__c);
    }
}