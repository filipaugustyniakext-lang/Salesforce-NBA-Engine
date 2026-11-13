@IsTest
private class MarketingDictionaryChannelUtilTest {
    @IsTest
    static void derivesTheMessageTypeFromTheChannelName() {
        System.assertEquals('', MarketingDictionaryChannelUtil.messageTypeKey((Marketing_Dictionary__c) null));
        System.assertEquals('', MarketingDictionaryChannelUtil.messageTypeKey(new Marketing_Dictionary__c()));
        System.assertEquals('', MarketingDictionaryChannelUtil.messageTypeKey('  '));
        System.assertEquals('Email', MarketingDictionaryChannelUtil.messageTypeKey(' Email '));
        System.assertEquals(false, MarketingDictionaryChannelUtil.isBannerChannel(new Marketing_Dictionary__c(Name = 'Email')));
        System.assertEquals(true, MarketingDictionaryChannelUtil.isBannerChannel(new Marketing_Dictionary__c(Name = ' banner ')));
    }
}
