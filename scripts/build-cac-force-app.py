#!/usr/bin/env python3
"""
Build a CAC-only force-app tree from the org snapshot on main.

Uses the pre-org-dump file inventory (4339db5) plus full object folders from HEAD
for Client Activation Center custom objects and standard Campaign / Product2.
"""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORCE = ROOT / "force-app"
BASELINE_REF = "4339db5"
HEAD = "HEAD"

CAC_OBJECTS = {
    "Blackout_Day_Rule__c",
    "Blackout_Window__c",
    "Campaign",
    "Campaign_Offer__c",
    "Campaign_Tier__c",
    "CC_Message_Blocks_All__c",
    "CC_Message_Metadata__c",
    "Channel_Banner_Intent__c",
    "Channel_Banner_Intent_Target__c",
    "Channel_Banner_Placement__c",
    "Channel_Banner_Type__c",
    "Channel_Cooldown__c",
    "Channel_Template__c",
    "FamilyOfNeeds_CustomerType__c",
    "Marketing_Dictionary__c",
    "MCE_Settings__mdt",
    "Offer_Attribute_Rule__c",
    "Offer__c",
    "Offer_Reference_Value__c",
    "Offer_Version__c",
    "Offer_Version_Customer_Type__c",
    "Product2",
    "Product_Customer_Type__c",
    "Scoring_Model_Setting__c",
}

CAC_LWC_BUNDLES = {
    "agentforceCampaignWizard",
    "attractivenessRing",
    "campaignPathManager",
    "channelTemplateManager",
    "contentBindingModel",
    "copyCockpit",
    "copyCockpitAddModal",
    "copyCockpitEditor",
    "copyMessageNaming",
    "createMarketingDictionaryModal",
    "deactivateOfferAction",
    "decommissionOfferAction",
    "marketingDictionaryApp",
    "marketingDictionaryBlackoutTab",
    "marketingDictionaryCampaignTab",
    "marketingDictionaryChannelTab",
    "marketingDictionaryManager",
    "marketingDictionaryOfferTab",
    "marketingDictionaryPersonTab",
    "marketingDictionaryProductTab",
    "marketingDictionaryScoringTab",
    "nbaTierConfig",
    "offerAttractivenessHeader",
    "offerManager",
    "offerStatusActions",
    "offerVersionPanel",
    "productManager",
    "topicManager",
}

CAC_FLEXIPAGES = {
    "Activation_Paths.flexipage-meta.xml",
    "Channel_Cooldown_Period_Record_Page.flexipage-meta.xml",
    "Client_Activation_Cockpit.flexipage-meta.xml",
    "Copy_Center_Editor.flexipage-meta.xml",
    "Copy_Cockpit_Editor.flexipage-meta.xml",
    "Marketing_Dictionaries.flexipage-meta.xml",
    "Marketing_Dictionary.flexipage-meta.xml",
    "Offer_Record_Page.flexipage-meta.xml",
    "Product_Record_Page.flexipage-meta.xml",
}

CAC_AURA = {"agentforceCampaignWizardAction", "deactivateOfferAction", "decommissionOfferAction"}

PATH_ALIASES = {
    "force-app/main/default/ClientActivationCenter.permissionset-meta.xml": (
        "force-app/main/default/permissionsets/ClientActivationCenter.permissionset-meta.xml"
    ),
    "force-app/main/default/MCE_Settings__mdt.Default.md-meta.xml": (
        "force-app/main/default/customMetadata/MCE_Settings.Default.md-meta.xml"
    ),
}


def git_lines(*args: str) -> list[str]:
    out = subprocess.check_output(["git", *args], cwd=ROOT, text=True)
    return [ln.strip() for ln in out.splitlines() if ln.strip()]


def git_has(ref: str, path: str) -> bool:
    return subprocess.call(["git", "cat-file", "-e", f"{ref}:{path}"], cwd=ROOT) == 0


def resolve_baseline_path(path: str) -> str | None:
    if git_has(HEAD, path):
        return path
    if path in PATH_ALIASES and git_has(HEAD, PATH_ALIASES[path]):
        return PATH_ALIASES[path]
    m = re.match(r"force-app/main/default/classes/([^/]+__c)/(.+)", path)
    if m:
        obj, rest = m.group(1), m.group(2)
        candidate = f"force-app/main/default/objects/{obj}/{rest}"
        if git_has(HEAD, candidate):
            return candidate
    return None


def materialize(ref: str, repo_path: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = subprocess.check_output(["git", "show", f"{ref}:{repo_path}"], cwd=ROOT)
    dest.write_bytes(data)


def main() -> None:
    baseline = git_lines("ls-tree", "-r", "--name-only", BASELINE_REF, "force-app")
    head_files = set(git_lines("ls-tree", "-r", "--name-only", HEAD, "force-app"))

    keep: set[str] = set()

    for p in baseline:
        if "/lwc/jsconfig.json" in p:
            continue
        if p.startswith("force-app/main/default/classes/") and "/__c/" in p:
            continue
        if p.startswith("force-app/main/default/aiAuthoringBundles/"):
            continue
        if p in (
            "force-app/main/default/classes/CheckWeather.cls",
            "force-app/main/default/classes/CheckWeather.cls-meta.xml",
            "force-app/main/default/classes/CurrentDate.cls",
            "force-app/main/default/classes/CurrentDate.cls-meta.xml",
            "force-app/main/default/classes/CurrentDateTest.cls",
            "force-app/main/default/classes/CurrentDateTest.cls-meta.xml",
            "force-app/main/default/classes/WeatherService.cls",
            "force-app/main/default/classes/WeatherService.cls-meta.xml",
            "force-app/main/default/classes/WeatherServiceTest.cls",
            "force-app/main/default/classes/WeatherServiceTest.cls-meta.xml",
        ):
            continue
        resolved = resolve_baseline_path(p)
        if resolved:
            keep.add(resolved)

    for obj in CAC_OBJECTS:
        prefix = f"force-app/main/default/objects/{obj}/"
        keep.update(p for p in head_files if p.startswith(prefix))

    for bundle in CAC_LWC_BUNDLES:
        prefix = f"force-app/main/default/lwc/{bundle}/"
        keep.update(p for p in head_files if p.startswith(prefix))

    for name in CAC_FLEXIPAGES:
        p = f"force-app/main/default/flexipages/{name}"
        if p in head_files:
            keep.add(p)

    for aura in CAC_AURA:
        prefix = f"force-app/main/default/aura/{aura}/"
        keep.update(p for p in head_files if p.startswith(prefix))

    layout_prefixes = tuple(
        f"force-app/main/default/layouts/{obj.replace('__c', '')}"
        for obj in CAC_OBJECTS
    ) + (
        "force-app/main/default/layouts/CC_",
        "force-app/main/default/layouts/Marketing_Dictionary",
        "force-app/main/default/layouts/Offer",
        "force-app/main/default/layouts/Product2",
        "force-app/main/default/layouts/Campaign",
        "force-app/main/default/layouts/Channel_",
        "force-app/main/default/layouts/Blackout",
        "force-app/main/default/layouts/Scoring_Model",
    )
    for p in head_files:
        if p.startswith("force-app/main/default/layouts/") and p.endswith(".layout-meta.xml"):
            if any(p.startswith(pre) or pre in p for pre in layout_prefixes):
                keep.add(p)

    for p in head_files:
        if p.startswith("force-app/main/default/triggers/") and any(
            k in p
            for k in (
                "ChannelTemplate",
                "CC_Message",
                "Marketing_Dictionary",
                "Offer",
            )
        ):
            keep.add(p)

    for p in head_files:
        if p.startswith("force-app/main/default/remoteSiteSettings/MarketingCloud"):
            keep.add(p)

    for p in head_files:
        if not p.startswith("force-app/main/default/classes/"):
            continue
        if "/" in p.removeprefix("force-app/main/default/classes/"):
            continue
        name = Path(p).name
        if not (name.endswith(".cls") or name.endswith(".cls-meta.xml")):
            continue
        base = name.replace(".cls-meta.xml", "").replace(".cls", "")
        if re.match(
            r"^(Marketing|Copy|Channel|Campaign|Offer|Product|Scoring|Blackout|MCE|FlowInit|Agentforce|Deactivate|Decommission|MassUpdate|ProductMass)",
            base,
        ) or base.endswith("Test"):
            keep.add(p)

    staging = ROOT / ".cac-force-app-staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    for repo_path in sorted(keep):
        rel = repo_path.removeprefix("force-app/")
        materialize(HEAD, repo_path, staging / rel)

    if FORCE.exists():
        shutil.rmtree(FORCE)
    shutil.move(str(staging), str(FORCE))

    print(f"CAC force-app: {len(keep)} metadata files materialized from {HEAD}.")


if __name__ == "__main__":
    main()
