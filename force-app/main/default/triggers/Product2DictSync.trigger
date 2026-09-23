trigger Product2DictSync on Product2 (before insert, before update) {
    // Sync the Product Type dictionary lookup to the record type. Family and Family of
    // Needs are read directly from their dictionary lookups (Product_Family_Dict__c /
    // Family_of_Needs_Dict__c), so no copy-by-value picklist sync is needed.
    Set<Id> dictIds = new Set<Id>();
    for (Product2 p : Trigger.new) {
        if (p.Product_Type_Dict__c != null) dictIds.add(p.Product_Type_Dict__c);
    }
    if (dictIds.isEmpty()) return;

    Map<Id, String> dictNames = new Map<Id, String>();
    for (Marketing_Dictionary__c d : [SELECT Id, Name FROM Marketing_Dictionary__c WHERE Id IN :dictIds]) {
        dictNames.put(d.Id, d.Name);
    }

    // Build Product2 record type name -> Id map for Product Type sync
    Map<String, Id> rtNameToId = new Map<String, Id>();
    for (RecordTypeInfo rti : Schema.SObjectType.Product2.getRecordTypeInfos()) {
        if (!rti.isMaster()) rtNameToId.put(rti.getName(), rti.getRecordTypeId());
    }

    for (Product2 p : Trigger.new) {
        Product2 old = Trigger.isUpdate ? Trigger.oldMap.get(p.Id) : null;
        Boolean ptChanged = old == null ? p.Product_Type_Dict__c != null : p.Product_Type_Dict__c != old.Product_Type_Dict__c;
        if (ptChanged && p.Product_Type_Dict__c != null) {
            String typeName = dictNames.get(p.Product_Type_Dict__c);
            Id rtId = rtNameToId.get(typeName);
            if (rtId != null) p.RecordTypeId = rtId;
        }
    }
}