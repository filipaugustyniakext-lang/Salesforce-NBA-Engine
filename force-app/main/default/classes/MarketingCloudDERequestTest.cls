@IsTest
private class MarketingCloudDERequestTest {
    @IsTest
    static void storesTheRequestFields() {
        MarketingCloudDERequest request = new MarketingCloudDERequest();
        request.Prospect_Id = 'prospect';
        request.Process_Id = 'process';
        System.assertEquals('prospect', request.Prospect_Id);
        System.assertEquals('process', request.Process_Id);
    }
}
