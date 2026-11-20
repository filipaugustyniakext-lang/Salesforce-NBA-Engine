#!/usr/bin/env python3
"""Generates the additive Copy Center schema v1 metadata (Phase 1).

Re-runnable: existing files are overwritten with the same content and
permission set entries are only added once.
"""
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'force-app', 'main', 'default')
OBJ = os.path.join(ROOT, 'objects')
PERMSET = os.path.join(ROOT, 'permissionsets', 'ClientActivationCenter.permissionset-meta.xml')
HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n'


def esc(value):
    return value.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def text(name, label, length=255, desc='', external=False, unique=False):
    return name, f"""    <externalId>{'true' if external else 'false'}</externalId>
    <label>{label}</label>
    <length>{length}</length>
    <required>false</required>
    <type>Text</type>
    <unique>{'true' if unique else 'false'}</unique>""", desc


def number(name, label, desc=''):
    return name, f"""    <externalId>false</externalId>
    <label>{label}</label>
    <precision>18</precision>
    <required>false</required>
    <scale>0</scale>
    <type>Number</type>
    <unique>false</unique>""", desc


def longtext(name, label, length=131072, desc=''):
    return name, f"""    <label>{label}</label>
    <length>{length}</length>
    <type>LongTextArea</type>
    <visibleLines>10</visibleLines>""", desc


def datetime(name, label, desc=''):
    return name, f"""    <label>{label}</label>
    <required>false</required>
    <type>DateTime</type>""", desc


def checkbox(name, label, default=False, desc=''):
    return name, f"""    <defaultValue>{'true' if default else 'false'}</defaultValue>
    <label>{label}</label>
    <type>Checkbox</type>""", desc


def lookup(name, label, target, rel_name, rel_label, desc=''):
    return name, f"""    <deleteConstraint>SetNull</deleteConstraint>
    <label>{label}</label>
    <referenceTo>{target}</referenceTo>
    <relationshipLabel>{rel_label}</relationshipLabel>
    <relationshipName>{rel_name}</relationshipName>
    <required>false</required>
    <type>Lookup</type>""", desc


def master(name, label, target, rel_name, rel_label, desc=''):
    return name, f"""    <label>{label}</label>
    <referenceTo>{target}</referenceTo>
    <relationshipLabel>{rel_label}</relationshipLabel>
    <relationshipName>{rel_name}</relationshipName>
    <relationshipOrder>0</relationshipOrder>
    <reparentableMasterDetail>false</reparentableMasterDetail>
    <type>MasterDetail</type>
    <writeRequiresMasterRead>false</writeRequiresMasterRead>""", desc


def picklist(name, label, values, default=None, multi=False, desc=''):
    items = ''.join(
        f"""
            <value>
                <fullName>{esc(v)}</fullName>
                <default>{'true' if v == default else 'false'}</default>
                <label>{esc(v)}</label>
            </value>""" for v in values)
    kind = 'MultiselectPicklist' if multi else 'Picklist'
    extra = '\n    <visibleLines>5</visibleLines>' if multi else ''
    return name, f"""    <label>{label}</label>
    <required>false</required>
    <type>{kind}</type>{extra}
    <valueSet>
        <restricted>true</restricted>
        <valueSetDefinition>
            <sorted>false</sorted>{items}
        </valueSetDefinition>
    </valueSet>""", desc


def write_field(obj, spec):
    name, body, desc = spec
    folder = os.path.join(OBJ, obj, 'fields')
    os.makedirs(folder, exist_ok=True)
    description = f'    <description>{esc(desc)}</description>\n' if desc else ''
    xml = (f'{HEADER}<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n'
           f'    <fullName>{name}</fullName>\n{description}{body}\n</CustomField>\n')
    with open(os.path.join(folder, f'{name}.field-meta.xml'), 'w') as handle:
        handle.write(xml)


def write_object(obj, label, plural, name_label, desc, controlled_by_parent, auto_number=None):
    folder = os.path.join(OBJ, obj)
    os.makedirs(folder, exist_ok=True)
    sharing = 'ControlledByParent' if controlled_by_parent else 'ReadWrite'
    if auto_number:
        name_field = f"""    <nameField>
        <displayFormat>{auto_number}</displayFormat>
        <label>{name_label}</label>
        <type>AutoNumber</type>
    </nameField>"""
    else:
        name_field = f"""    <nameField>
        <label>{name_label}</label>
        <type>Text</type>
    </nameField>"""
    xml = f"""{HEADER}<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <allowInChatterGroups>false</allowInChatterGroups>
    <compactLayoutAssignment>SYSTEM</compactLayoutAssignment>
    <deploymentStatus>Deployed</deploymentStatus>
    <description>{esc(desc)}</description>
    <enableActivities>false</enableActivities>
    <enableBulkApi>true</enableBulkApi>
    <enableFeeds>false</enableFeeds>
    <enableHistory>false</enableHistory>
    <enableLicensing>false</enableLicensing>
    <enableReports>true</enableReports>
    <enableSearch>true</enableSearch>
    <enableSharing>true</enableSharing>
    <enableStreamingApi>true</enableStreamingApi>
    <externalSharingModel>{sharing}</externalSharingModel>
    <label>{label}</label>
{name_field}
    <pluralLabel>{plural}</pluralLabel>
    <searchLayouts></searchLayouts>
    <sharingModel>{sharing}</sharingModel>
    <visibility>Public</visibility>
</CustomObject>
"""
    with open(os.path.join(folder, f'{obj}.object-meta.xml'), 'w') as handle:
        handle.write(xml)


CONTENT_TYPES = ['richText', 'image', 'bulletList', 'divider', 'button']
TEMPLATE_STATUSES = ['Draft', 'Ready', 'Active', 'Archived']
VALIDATION = ['Not Validated', 'Valid', 'Invalid']

FIELDS = {
    'CC_Message_Metadata__c': [
        lookup('MasterTemplateDefinitionId__c', 'Master Template Definition', 'Channel_Template__c',
               'Copy_Center_Messages', 'Copy Center Messages',
               'Marketing Dictionary master template definition this message variant renders with.'),
        text('MCE_MasterTemplateAssetId__c', 'MCE Master Template Asset Id', 255,
             'MCE Content Builder template asset that renders the send.'),
        text('MCE_MasterTemplateAssetPath__c', 'MCE Master Template Path', 255,
             'MCE Content Builder folder path of the master template asset.'),
        text('MCN_MasterTemplateAssetId__c', 'MCN Master Template Asset Id', 255,
             'Marketing Cloud Next (Salesforce CMS) template asset id.'),
        text('MCN_MasterTemplateAssetPath__c', 'MCN Master Template Path', 255,
             'Marketing Cloud Next (Salesforce CMS) template path.'),
        number('CurrentMessageVariantVersionNumber__c', 'Current Variant Version Number',
               'Iteration number of the live content version of this variant.'),
        text('Draft_Version_Id__c', 'Draft Version Id', 255,
             'Version id of block rows saved by Create New Variant Version and not yet activated.'),
        longtext('Message_Settings_JSON__c', 'Message Settings JSON', 32768,
                 'Message-level channel settings (banner type, placements, target URL). Replaces MessagePropertiesJSON.'),
    ],
    'CC_Message_Blocks__c': [
        lookup('Message_Metadata__c', 'Message Variant', 'CC_Message_Metadata__c',
               'Content_Blocks', 'Content Blocks', 'Message variant this block belongs to.'),
        text('MessageBlockId__c', 'Message Block Id', 255, 'Unique id of this block configuration.', True, True),
        text('MessageVariantVersionId__c', 'Message Variant Version Id', 255,
             'Version of the variant this block row belongs to.'),
        number('MessageVariantVersionNumber__c', 'Message Variant Version Number'),
        number('MessageVariantNumber__c', 'Message Variant Number'),
        lookup('BlockTemplateDefinitionId__c', 'Block Template Definition', 'Channel_Template_Block__c',
               'Message_Blocks', 'Message Blocks', 'Block template definition this block is built from.'),
        text('BlockTemplateDefinitionName__c', 'Block Template Definition Name'),
        picklist('BlockTemplateDefinitionContentTypes__c', 'Block Content Types', CONTENT_TYPES, multi=True),
        text('MCN_BlockTemplateAssetId__c', 'MCN Block Template Asset Id'),
        text('MCN_BlockTemplateAssetPath__c', 'MCN Block Template Path', 255),
    ],
    'Channel_Template__c': [
        lookup('Locale__c', 'Locale', 'Marketing_Dictionary__c', 'Locale_Channel_Templates',
               'Locale Channel Templates', 'Marketing Dictionary locale of this template.'),
        picklist('Template_Mode__c', 'Template Mode', ['Single Block', 'Multi Block'], 'Multi Block'),
        longtext('Definition_JSON__c', 'Definition JSON', 131072, 'Schema v1 template definition. See docs/copy-center/binding-syntax.md.'),
        longtext('Shell_HTML__c', 'Shell HTML', 131072, 'Master shell HTML with inline CSS.'),
        longtext('Shell_HTML_Part2__c', 'Shell HTML Part 2', 131072, 'Overflow of Shell_HTML__c.'),
        text('MCE_Asset_Id__c', 'MCE Asset Id'),
        text('MCE_Asset_Path__c', 'MCE Asset Path', 255),
        text('MCN_Asset_Id__c', 'MCN Asset Id'),
        text('MCN_Asset_Path__c', 'MCN Asset Path', 255),
    ],
    'Channel_Template_Block__c': [
        master('Channel_Template__c', 'Channel Template', 'Channel_Template__c', 'Template_Blocks', 'Template Blocks'),
        picklist('Status__c', 'Status', TEMPLATE_STATUSES, 'Draft'),
        number('Block_Order__c', 'Block Order'),
        text('Description__c', 'Description', 255),
        picklist('Content_Types__c', 'Content Types', CONTENT_TYPES, multi=True),
        longtext('Source_HTML__c', 'Source HTML', 131072, 'Block template HTML with v1 binding attributes.'),
        longtext('Definition_JSON__c', 'Definition JSON', 131072),
        picklist('Validation_Status__c', 'Validation Status', VALIDATION, 'Not Validated'),
        longtext('Validation_Message__c', 'Validation Message', 32768),
        datetime('Validated_At__c', 'Validated At'),
        text('MCE_Asset_Id__c', 'MCE Asset Id'),
        text('MCE_Asset_Path__c', 'MCE Asset Path', 255),
        text('MCN_Asset_Id__c', 'MCN Asset Id'),
        text('MCN_Asset_Path__c', 'MCN Asset Path', 255),
    ],
    'CC_Message_History__c': [
        lookup('Message_Metadata__c', 'Message Variant', 'CC_Message_Metadata__c', 'Message_History', 'Message History'),
        text('History_Key__c', 'History Key', 255,
             'MessageVariantId|MessageVariantVersionId|ContentBlockOrder.', True, True),
        text('MessageName__c', 'Message Name'),
        text('MessageType__c', 'Message Channel'),
        text('MessageVariantId__c', 'Message Variant Id'),
        number('MessageVariantNumber__c', 'Message Variant Number'),
        text('MessageVariantVersionId__c', 'Message Variant Version Id'),
        number('MessageVariantVersionNumber__c', 'Message Variant Version Number'),
        number('ContentBlockOrder__c', 'Block Order'),
        text('MessageBlockId__c', 'Message Block Id'),
        text('BlockTemplateDefinitionId__c', 'Block Template Definition Id', 18),
        text('BlockTemplateDefinitionName__c', 'Block Template Definition Name'),
        text('BlockType__c', 'Block Type'),
        longtext('ContentJson__c', 'ContentJson'),
        longtext('ContentJsonPart2__c', 'ContentJsonPart2'),
        picklist('Action__c', 'Action', ['Created', 'Activated', 'Restored', 'Migrated']),
        text('Commit_Comment__c', 'Comment', 255),
        datetime('Activated_At__c', 'Activated At'),
    ],
    'CC_Message_Scheduled__c': [
        lookup('Message_Metadata__c', 'Message Variant', 'CC_Message_Metadata__c', 'Scheduled_Changes', 'Scheduled Changes'),
        text('MessageVariantId__c', 'Message Variant Id'),
        picklist('Scheduled_Action__c', 'Scheduled Action', ['Publish', 'Unpublish', 'Publish Changes', 'Archive']),
        picklist('Status__c', 'Status', ['Pending', 'Done', 'Failed', 'Cancelled'], 'Pending'),
        datetime('Run_At__c', 'Run At'),
        text('From_Status__c', 'From Status', 40),
        text('To_Status__c', 'To Status', 40),
        text('Target_Version_Id__c', 'Target Version Id', 255, 'Version activated by Publish Changes.'),
        datetime('Executed_At__c', 'Executed At'),
        longtext('Error_Message__c', 'Error Message', 32768),
        text('Note__c', 'Note', 255),
    ],
}

OBJECTS = [
    ('Channel_Template_Block__c', 'Channel Template Block', 'Channel Template Blocks', 'Block Name',
     'Content block template definition of a multi-block channel template.', True, None),
    ('CC_Message_History__c', 'Copy Center Message History', 'Copy Center Message History', 'History Number',
     'Snapshot of one block of an activated message variant version. Used to restore earlier versions.', False, 'CCH-{000000}'),
    ('CC_Message_Scheduled__c', 'Copy Center Scheduled Change', 'Copy Center Scheduled Changes', 'Schedule Number',
     'Scheduled status change of a message variant, executed by the Copy Center scheduled publication flow.', False, 'CCS-{000000}'),
]


def add_permissions():
    with open(PERMSET) as handle:
        xml = handle.read()
    field_entries = []
    for obj, specs in FIELDS.items():
        for name, body, _ in specs:
            if '<type>MasterDetail</type>' in body:
                continue
            full = f'{obj}.{name}'
            if f'<field>{full}</field>' in xml:
                continue
            field_entries.append(f"""    <fieldPermissions>
        <editable>true</editable>
        <field>{full}</field>
        <readable>true</readable>
    </fieldPermissions>
""")
    object_entries = []
    for obj, *_ in OBJECTS:
        if f'<object>{obj}</object>' in xml:
            continue
        object_entries.append(f"""    <objectPermissions>
        <allowCreate>true</allowCreate>
        <allowDelete>true</allowDelete>
        <allowEdit>true</allowEdit>
        <allowRead>true</allowRead>
        <modifyAllRecords>false</modifyAllRecords>
        <object>{obj}</object>
        <viewAllFields>false</viewAllFields>
        <viewAllRecords>false</viewAllRecords>
    </objectPermissions>
""")
    if field_entries:
        index = xml.index('    <fieldPermissions>')
        xml = xml[:index] + ''.join(field_entries) + xml[index:]
    if object_entries:
        index = xml.index('    <objectPermissions>')
        xml = xml[:index] + ''.join(object_entries) + xml[index:]
    with open(PERMSET, 'w') as handle:
        handle.write(xml)


def add_picklist_value(path, value, after):
    with open(path) as handle:
        xml = handle.read()
    if f'<fullName>{value}</fullName>' in xml:
        return
    block = f"""            <value>
                <fullName>{value}</fullName>
                <default>false</default>
                <label>{value}</label>
            </value>
"""
    pattern = re.compile(r'(            <value>\s*<fullName>' + re.escape(after) + r'</fullName>[\s\S]*?</value>\n)')
    xml = pattern.sub(lambda m: m.group(1) + block, xml, count=1)
    with open(path, 'w') as handle:
        handle.write(xml)


def main():
    for obj, label, plural, name_label, desc, cbp, auto in OBJECTS:
        write_object(obj, label, plural, name_label, desc, cbp, auto)
    for obj, specs in FIELDS.items():
        for spec in specs:
            write_field(obj, spec)
    add_picklist_value(os.path.join(OBJ, 'CC_Message_Metadata__c', 'fields', 'Status__c.field-meta.xml'), 'Live', 'Ready')
    add_picklist_value(os.path.join(OBJ, 'Channel_Template__c', 'fields', 'Status__c.field-meta.xml'), 'Ready', 'Draft')
    add_permissions()


if __name__ == '__main__':
    main()
