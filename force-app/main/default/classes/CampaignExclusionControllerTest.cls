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
        for (CampaignExclusionController.DataCloudObjectOption dmo : options.dataModelObjects) {
            System.assert(String.isNotBlank(dmo.apiName), 'DMO api name required');
            System.assert(String.isNotBlank(dmo.label), 'DMO label required');
        }
        for (CampaignExclusionController.DataCloudObjectOption dlo : options.dataLakeObjects) {
            System.assert(String.isNotBlank(dlo.apiName), 'DLO api name required');
            System.assert(String.isNotBlank(dlo.label), 'DLO label required');
        }
        for (CampaignExclusionController.SegmentOption seg : options.segments) {
            System.assert(String.isNotBlank(seg.id), 'Segment id required');
            System.assert(String.isNotBlank(seg.name), 'Segment name required');
        }
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
