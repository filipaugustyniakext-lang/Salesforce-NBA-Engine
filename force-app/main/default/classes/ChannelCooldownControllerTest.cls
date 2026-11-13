@IsTest
private class ChannelCooldownControllerTest {
    @IsTest
    static void upsertsAndReadsSettings() {
        System.assertEquals(null, ChannelCooldownController.getChannelSettings('Email', 'Prospect'));

        String firstId = ChannelCooldownController.upsertChannelSettings(null, 'Email', 'Prospect', 7, true);
        String secondId = ChannelCooldownController.upsertChannelSettings(firstId, 'Email', 'Prospect', 14, false);
        System.assertEquals(firstId, secondId);

        Channel_Cooldown_Period__c saved = ChannelCooldownController.getChannelSettings('Email', 'Prospect');
        System.assertEquals(14, saved.Cooldown_Days__c);
        System.assertEquals(false, saved.IsActive__c);
        System.assertEquals(1, ChannelCooldownController.getAllCooldownRecords().size());
        System.assertEquals(0, ChannelCooldownController.getCooldownHistory('Missing', 'Prospect').size());
        ChannelCooldownController.getCooldownHistory('Email', 'Prospect');
    }
}
