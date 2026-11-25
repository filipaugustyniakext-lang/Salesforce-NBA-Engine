/**
 * Behind the "Clone Campaign" button of the Campaign list view: exactly one selected campaign is opened in the
 * Campaign Creation Wizard in clone mode (c:campaignCloneApp). Anything else gets a short explanation.
 */
public with sharing class CloneCampaignController {
    private final ApexPages.StandardSetController setController;

    public CloneCampaignController(ApexPages.StandardSetController controller) {
        this.setController = controller;
    }

    public Integer getSelectedCount() {
        return setController.getSelected().size();
    }

    /** Id of the selected campaign, only when exactly one campaign is selected. */
    public String getSelectedId() {
        List<SObject> selected = setController.getSelected();
        return selected.size() == 1 ? String.valueOf(selected[0].get('Id')) : '';
    }
}
