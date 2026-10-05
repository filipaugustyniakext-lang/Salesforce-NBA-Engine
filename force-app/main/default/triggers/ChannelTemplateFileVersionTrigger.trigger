trigger ChannelTemplateFileVersionTrigger on ContentVersion (before insert) {
    ChannelTemplateFileVersionGuard.beforeInsert(Trigger.new);
}
