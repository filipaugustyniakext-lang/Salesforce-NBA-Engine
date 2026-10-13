#!/usr/bin/env python3
"""Build manifest/client-activation-center-retrieve.xml from force-app metadata."""
from pathlib import Path
import xml.etree.ElementTree as ET

root = Path('force-app/main/default')
members = {
    'ApexClass': [],
    'ApexPage': [],
    'LightningComponentBundle': [],
    'AuraDefinitionBundle': [],
    'CustomObject': [],
    'CustomMetadata': [],
    'PermissionSet': [],
    'CustomTab': [],
    'FlexiPage': [],
    'CustomApplication': [],
    'RemoteSiteSetting': [],
    'StaticResource': [],
    'CustomLabel': [],
}

for cls in (root / 'classes').glob('*.cls'):
    members['ApexClass'].append(cls.stem)

for page in (root / 'pages').glob('*.page'):
    members['ApexPage'].append(page.stem)

for lwc in (root / 'lwc').iterdir():
    if lwc.is_dir() and (lwc / f'{lwc.name}.js').exists():
        members['LightningComponentBundle'].append(lwc.name)

for aura in (root / 'aura').iterdir():
    if aura.is_dir():
        members['AuraDefinitionBundle'].append(aura.name)

for obj in (root / 'objects').iterdir():
    if obj.is_dir() and (obj / f'{obj.name}.object-meta.xml').exists():
        members['CustomObject'].append(obj.name)

for cmd in (root / 'customMetadata').glob('*.md-meta.xml'):
    members['CustomMetadata'].append(cmd.stem)

for ps in (root / 'permissionsets').glob('*.permissionset-meta.xml'):
    members['PermissionSet'].append(ps.name.replace('.permissionset-meta.xml', ''))

for tab in (root / 'tabs').glob('*.tab-meta.xml'):
    members['CustomTab'].append(tab.name.replace('.tab-meta.xml', ''))

for fp in (root / 'flexipages').glob('*.flexipage-meta.xml'):
    members['FlexiPage'].append(fp.name.replace('.flexipage-meta.xml', ''))

for app in (root / 'applications').glob('*.app-meta.xml'):
    members['CustomApplication'].append(app.name.replace('.app-meta.xml', ''))

for rss in (root / 'remoteSiteSettings').glob('*.remoteSite-meta.xml'):
    members['RemoteSiteSetting'].append(rss.name.replace('.remoteSite-meta.xml', ''))

for sr in (root / 'staticresources').glob('*.resource-meta.xml'):
    members['StaticResource'].append(sr.name.replace('.resource-meta.xml', ''))

for lbl in (root / 'labels').glob('*.labels-meta.xml'):
    members['CustomLabel'].append(lbl.name.replace('.labels-meta.xml', ''))

pkg = ET.Element('Package', xmlns='http://soap.sforce.com/2006/04/metadata')
for name in sorted(members.keys()):
    vals = sorted(set(members[name]))
    if not vals:
        continue
    t = ET.SubElement(pkg, 'types')
    for m in vals:
        ET.SubElement(t, 'members').text = m
    ET.SubElement(t, 'name').text = name
ET.SubElement(pkg, 'version').text = '66.0'

out = Path('manifest/client-activation-center-retrieve.xml')
out.parent.mkdir(exist_ok=True)
tree = ET.ElementTree(pkg)
ET.indent(tree, space='    ')
tree.write(out, encoding='UTF-8', xml_declaration=True)
print(f'Wrote {out}')
