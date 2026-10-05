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
}
