@IsTest
private class CloneCampaignControllerTest {
    private static ApexPages.StandardSetController controllerFor(List<Campaign> all, List<Campaign> selected) {
        ApexPages.StandardSetController setController = new ApexPages.StandardSetController(all);
        setController.setSelected(selected);
        return setController;
    }

    @IsTest
    static void exactlyOneSelectedCampaignCanBeCloned() {
        List<Campaign> campaigns = new List<Campaign>{ new Campaign(Name = 'One'), new Campaign(Name = 'Two') };
        insert campaigns;
        CloneCampaignController controller = new CloneCampaignController(controllerFor(campaigns, new List<Campaign>{ campaigns[1] }));
        System.assertEquals(1, controller.getSelectedCount());
        System.assertEquals(String.valueOf(campaigns[1].Id), controller.getSelectedId());
    }

    @IsTest
    static void nothingOrSeveralSelectedGivesNoCampaignToClone() {
        List<Campaign> campaigns = new List<Campaign>{ new Campaign(Name = 'One'), new Campaign(Name = 'Two') };
        insert campaigns;
        CloneCampaignController none = new CloneCampaignController(controllerFor(campaigns, new List<Campaign>()));
        System.assertEquals(0, none.getSelectedCount());
        System.assertEquals('', none.getSelectedId());
        CloneCampaignController several = new CloneCampaignController(controllerFor(campaigns, campaigns));
        System.assertEquals(2, several.getSelectedCount());
        System.assertEquals('', several.getSelectedId());
    }
}
