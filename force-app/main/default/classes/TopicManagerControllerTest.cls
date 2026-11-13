@IsTest
private class TopicManagerControllerTest {
    @IsTest
    static void listsAndUpdatesTopics() {
        Id topicTypeId = Schema.SObjectType.Campaign.getRecordTypeInfosByDeveloperName()
            .get('Topic').getRecordTypeId();
        Campaign topic = new Campaign(Name = 'Welcome Topic', RecordTypeId = topicTypeId, IsActive = true);
        insert topic;

        System.assertEquals(true, containsId(TopicManagerController.getTopics(), topic.Id));
        TopicManagerController.toggleTopicStatus(topic.Id, false);
        System.assertEquals(false, [SELECT IsActive FROM Campaign WHERE Id = :topic.Id].IsActive);
        TopicManagerController.deleteTopic(topic.Id);
        System.assertEquals(0, [SELECT COUNT() FROM Campaign WHERE Id = :topic.Id]);
    }

    @IsTest
    static void reportsAMissingTopic() {
        try {
            TopicManagerController.toggleTopicStatus(null, true);
            System.assert(false, 'Expected an update failure');
        } catch (AuraHandledException error) {
            System.assertNotEquals(null, error);
        }
    }

    private static Boolean containsId(List<Campaign> topics, Id topicId) {
        for (Campaign topic : topics) {
            if (topic.Id == topicId) return true;
        }
        return false;
    }
}
