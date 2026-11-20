#!/usr/bin/env python3
"""Adds Apex class access entries to the ClientActivationCenter permission set (idempotent).

Usage: python3 scripts/copy-center/add_class_access.py ClassA ClassB
"""
import os
import sys

PERMSET = os.path.join(os.path.dirname(__file__), '..', '..', 'force-app', 'main', 'default',
                       'permissionsets', 'ClientActivationCenter.permissionset-meta.xml')


def main(classes):
    with open(PERMSET) as handle:
        xml = handle.read()
    entries = ''.join(
        f"""    <classAccesses>
        <apexClass>{name}</apexClass>
        <enabled>true</enabled>
    </classAccesses>
""" for name in classes if f'<apexClass>{name}</apexClass>' not in xml)
    if entries:
        index = xml.index('    <classAccesses>')
        xml = xml[:index] + entries + xml[index:]
        with open(PERMSET, 'w') as handle:
            handle.write(xml)


if __name__ == '__main__':
    main(sys.argv[1:])
