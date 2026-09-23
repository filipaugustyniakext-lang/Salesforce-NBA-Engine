({
    doInit: function(component) {
        component.set("v.showModal", true);
    },
    handleClose: function(component) {
        var navEvt = $A.get("e.force:navigateToObjectHome");
        if (navEvt) {
            navEvt.setParams({ "scope": "Product2" });
            navEvt.fire();
        }
    },
    handleSaved: function(component, event) {
        var savedId = event.getParam("id");
        if (savedId) {
            var navEvt = $A.get("e.force:navigateToSObject");
            if (navEvt) {
                navEvt.setParams({ "recordId": savedId });
                navEvt.fire();
            }
        }
    }
})
