({
    doInit : function(component, event, helper) {
        // Retrieve the injected pageReference object
        var pageRef = component.get("v.pageReference");
        if (pageRef && pageRef.state) {
            // Extract the selected Record Type ID from the standard dialog window
            var rtId = pageRef.state.recordTypeId;
            console.log('Aura successfully parsed Record Type ID:', rtId);
            
            if (rtId) {
                component.set("v.selectedRecordTypeId", rtId);
            }
        }
    },

    handleClose : function(component, event, helper) {
        var homeEvent = $A.get("e.force:navigateToObjectHome");
        homeEvent.setParams({
            "scope": "Marketing_Dictionary__c"
        });
        homeEvent.fire();
    }
})