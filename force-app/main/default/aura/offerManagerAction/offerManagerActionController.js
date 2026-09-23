({
    doInit: function(component) {
        var sObjectName = component.get("v.sObjectName");
        var isVersionContext = (sObjectName === 'Offer_Version__c');
        component.set("v.isVersionContext", isVersionContext);
        component.set("v.showWizard", true);
    }
})
