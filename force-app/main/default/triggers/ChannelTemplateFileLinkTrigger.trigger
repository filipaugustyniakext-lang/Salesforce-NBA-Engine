trigger ChannelTemplateFileLinkTrigger on ContentDocumentLink (
    before insert,
    before delete
) {
    if (Trigger.isInsert) {
        ChannelTemplateFileLinkGuard.protectActiveTemplateLinks(Trigger.new);
    } else if (Trigger.isDelete) {
        ChannelTemplateFileLinkGuard.protectActiveTemplateLinks(Trigger.old);
    }
}
