({
    doInit : function(component, event, helper) {
        var reference = component.get("v.pageReference");
        var sourceId = reference && reference.state ? reference.state.c__sourceId : null;
        component.set("v.sourceId", sourceId || null);
    },

    handleNavigateToHome : function(component, event, helper) {
        var homeEvent = $A.get("e.force:navigateToObjectHome");
        homeEvent.setParams({
            "scope": "Campaign"
        });
        homeEvent.fire();
    }
})
