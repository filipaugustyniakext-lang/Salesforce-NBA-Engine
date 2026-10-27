/**
 * Channel dictionary helpers after Channel_Type__c removal — message routing uses Name.
 */
public with sharing class MarketingDictionaryChannelUtil {
    public static String messageTypeKey(Marketing_Dictionary__c channel) {
        if (channel == null || String.isBlank(channel.Name)) {
            return '';
        }
        return channel.Name.trim();
    }

    public static String messageTypeKey(String channelName) {
        return String.isBlank(channelName) ? '' : channelName.trim();
    }

    public static Boolean isBannerChannel(Marketing_Dictionary__c channel) {
        return 'Banner'.equalsIgnoreCase(messageTypeKey(channel));
    }
}
