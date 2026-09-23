public with sharing class TopicManagerController {
    
    // Fetches all Topics and their Parent Campaign info
    @AuraEnabled(cacheable=true)
    public static List<Campaign> getTopics() {
        return [
            SELECT Id, Name, ParentId, Parent.Name, Description, IsActive,
                   Topic_Overall_Score__c, Topic_Loyalization_Score__c, Topic_Ease_Score__c,
                   Topic_Maximum_Duration_Days__c, Topic_Start_Window_Day__c, Topic_End_Window_Day__c
            FROM Campaign 
            WHERE RecordType.Name = 'Topic'
            ORDER BY Parent.Name, Name ASC
        ];
    }

    // Deletes a specific topic
    @AuraEnabled
    public static void deleteTopic(Id topicId) {
        try {
            delete new Campaign(Id = topicId);
        } catch (Exception e) {
            throw new AuraHandledException('Error deleting topic: ' + e.getMessage());
        }
    }

    // Toggles the IsActive status of a topic
    @AuraEnabled
    public static void toggleTopicStatus(Id topicId, Boolean isActive) {
        try {
            update new Campaign(Id = topicId, IsActive = isActive);
        } catch (Exception e) {
            throw new AuraHandledException('Error updating topic status: ' + e.getMessage());
        }
    }
}