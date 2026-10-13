@IsTest
private class BannerDataGraphTransformerTest {

    @IsTest
    static void testTransformDataGraphList_SuccessWithNewStructure() {
        String contentData = '{"bannerType":"mainBanner","title":"Test Main Title","description":"Test Main Description",' +
                             '"imageUrl":"https://image.net/banner.png","legalNote":"Test Legal Note",' +
                             '"primaryLabel":"Click Me","primaryUrl":"https://example.com"}';

        // Struktura dostosowana do najnowszych pól: BannerPlaceholder__dlm oraz MessageVariantId__c
        String mockDataGraphJson = '{"externalCustomerID__c":"CUST-100","externalAppId__c":"APP-100",' +
            '"BannerPlaceholder__dlm":[' +
                '{"CompositeUniqueID__c":"COMP-MAIN-1","MessageVariantId__c":"VAR-001",' +
                '"contentData__c":"' + contentData.replace('"', '\\"') + '"}' +
            ']}';

        Test.startTest();
        String resultJson = BannerDataGraphTransformer.transformDataGraphList(new List<String>{ mockDataGraphJson });
        Test.stopTest();

        System.assert(String.isNotBlank(resultJson), 'Result JSON should not be empty');
        System.assert(resultJson.contains('Test Main Title'), 'Title should be extracted correctly');
        System.assert(resultJson.contains('VAR-001'), 'MessageVariantId should be mapped to messageVersionId');
        
        // Weryfikacja, czy externalRelationId jest puste
        System.assert(resultJson.contains('"externalRelationId":""'), 'externalRelationId should always be empty string');
    }

    @IsTest
    static void testDeduplicationAndCategories() {
        String mainPart = '{"bannerType":"mainBanner","title":"Main Banner"}';
        String vasPart = '{"bannerType":"vasBanner","title":"VAS Banner"}';
        String photoPart = '{"bannerType":"photoBanner","title":"Photo Banner"}';

        String mockBlob1 = '{"externalCustomerID__c":"CUST-100",' +
            '"BannerPlaceholder__dlm":[' +
                '{"CompositeUniqueID__c":"COMP-MAIN","MessageVariantId__c":"V1","contentData__c":"' + mainPart.replace('"', '\\"') + '"},' +
                '{"CompositeUniqueID__c":"COMP-VAS-1","MessageVariantId__c":"V2","contentData__c":"' + vasPart.replace('"', '\\"') + '"}' +
            ']}';

        // Powtórzony CompositeUniqueID__c (COMP-MAIN) dla przetestowania deduplikacji
        String mockBlob2 = '{"BannerPlaceholder__dlm":[' +
                '{"CompositeUniqueID__c":"COMP-MAIN","MessageVariantId__c":"V1","contentData__c":"' + mainPart.replace('"', '\\"') + '"},' +
                '{"CompositeUniqueID__c":"COMP-PHOTO-1","MessageVariantId__c":"V3","contentData__c":"' + photoPart.replace('"', '\\"') + '"}' +
            ']}';

        Test.startTest();
        String resultJson = BannerDataGraphTransformer.transformDataGraphList(new List<String>{ mockBlob1, mockBlob2 });
        Test.stopTest();

        System.assert(resultJson.contains('PH_HOME_MAIN'), 'Main category should exist');
        System.assert(resultJson.contains('PH_HOME_VAS'), 'VAS category should exist');
        System.assert(resultJson.contains('PH_HOME_PHOTO'), 'Photo category should exist');
    }

    @IsTest
    static void testEmptyAndMalformedInputs() {
        Test.startTest();
        String emptyResult = BannerDataGraphTransformer.transformDataGraphList(new List<String>());
        String nullResult = BannerDataGraphTransformer.transformDataGraphList(null);

        // Test obciętego/uszkodzonego JSON-a w contentData__c
        String brokenPart = '{"title":"Broken Title","description":"Broken Desc"';
        String mockJsonBad = '{"BannerPlaceholder__dlm":[{"CompositeUniqueID__c":"COMP-BAD","contentData__c":"' + brokenPart.replace('"', '\\"') + '"}]}';
        String badResult = BannerDataGraphTransformer.transformDataGraphList(new List<String>{ mockJsonBad });

        String singleResult = BannerDataGraphTransformer.transformDataGraph(mockJsonBad);
        Test.stopTest();

        System.assertEquals('{}', emptyResult);
        System.assertEquals('{}', nullResult);
        System.assert(badResult.contains('Broken Title'), 'Parser should recover Broken Title from malformed contentData');
        System.assert(singleResult.contains('Broken Title'), 'Single string method should work for malformed input');
    }

    @IsTest
    static void testFallbackToDirectFields() {
        String mockBlob = '{"externalCustomerID__c":"CUST-200",' +
            '"BannerPlaceholder__dlm":[' +
                '{"CompositeUniqueID__c":"COMP-DIRECT","MessageVariantId__c":"V1","bannerType":"mainBanner","title":"Direct Title","description":"Direct Desc"}' +
            ']}';
            
        Test.startTest();
        String resultJson = BannerDataGraphTransformer.transformDataGraphList(new List<String>{ mockBlob });
        Test.stopTest();
        
        System.assert(resultJson.contains('Direct Title'), 'Title should be extracted from direct object fields');
        System.assert(resultJson.contains('Direct Desc'), 'Description should be extracted from direct object fields');
    }
}