@IsTest
private class CampaignExclusionControllerTest {
    @IsTest
    static void getExclusionOptions_returnsCatalogueShape() {
        Test.startTest();
        CampaignExclusionController.ExclusionOptions options =
            CampaignExclusionController.getExclusionOptions();
        Test.stopTest();

        System.assertNotEquals(null, options);
        System.assertNotEquals(null, options.segments);
        System.assertNotEquals(null, options.dataModelObjects);
        System.assertNotEquals(null, options.dataLakeObjects);
        System.assertEquals(0, options.dataModelObjects.size(), 'DMO full catalog is not loaded');
        System.assertEquals(0, options.dataLakeObjects.size(), 'DLO full catalog is not loaded');
        for (CampaignExclusionController.SegmentOption seg : options.segments) {
            System.assert(String.isNotBlank(seg.id), 'Segment id required');
            System.assert(String.isNotBlank(seg.name), 'Segment name required');
        }
    }

    @IsTest
    static void searchDataCloudExclusionObjects_shortTermEmpty() {
        Test.startTest();
        List<CampaignExclusionController.DataCloudObjectOption> hits =
            CampaignExclusionController.searchDataCloudExclusionObjects('dmo', 'a');
        Test.stopTest();
        System.assertEquals(0, hits.size());
    }

    @IsTest
    static void searchDataCloudExclusionObjects_entityDefinitionQueryNoOr() {
        Test.startTest();
        List<CampaignExclusionController.DataCloudObjectOption> dmoHits =
            CampaignExclusionController.searchDataCloudExclusionObjects('dmo', 'GCP');
        List<CampaignExclusionController.DataCloudObjectOption> dloHits =
            CampaignExclusionController.searchDataCloudExclusionObjects('dlo', 'GCP');
        Test.stopTest();
        System.assertNotEquals(null, dmoHits);
        System.assertNotEquals(null, dloHits);
    }

    @IsTest
    static void getExclusionRecordFieldOptions_campaignMemberShape() {
        Test.startTest();
        List<CampaignExclusionController.FieldOption> fields =
            CampaignExclusionController.getExclusionRecordFieldOptions('campaign', '701000000000001');
        Test.stopTest();
        System.assertNotEquals(null, fields);
    }

    @IsTest
    static void getExclusionOptions_secondCallUsesCache() {
        CampaignExclusionController.getExclusionOptions();
        Test.startTest();
        CampaignExclusionController.ExclusionOptions options =
            CampaignExclusionController.getExclusionOptions();
        Test.stopTest();
        System.assertNotEquals(null, options);
    }
}
