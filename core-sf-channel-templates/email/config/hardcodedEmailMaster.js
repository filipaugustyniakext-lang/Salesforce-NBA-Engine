import {
  MASTER_SLOT_ROLE_FIXED,
  MASTER_SLOT_ROLE_INJECTABLE,
} from "../utils/blockTypeRegistry.js";

/** Published SFMC Text Code Resource key for the email master shell. */
export const EMAIL_MASTER_SHELL_RESOURCE_KEY = "SFMC_CB_Email_Master_Commercial";

export const EMAIL_MASTER_BODY_SLOT_KEY = "49fwfqshzd9";
export const EMAIL_MASTER_BODY_SLOT_LABEL = "BODY";

export const EMAIL_MASTER_TEMPLATE_SLOTS = [
  {
    slotKey: "bxctk7dwic4",
    slotLabel: "AMPscript",
    role: MASTER_SLOT_ROLE_FIXED,
  },
  {
    slotKey: EMAIL_MASTER_BODY_SLOT_KEY,
    slotLabel: EMAIL_MASTER_BODY_SLOT_LABEL,
    role: MASTER_SLOT_ROLE_INJECTABLE,
  },
  {
    slotKey: "elffysyxus6",
    slotLabel: "FOOTER",
    role: MASTER_SLOT_ROLE_FIXED,
  },
];

/** Force email masters to use the static shell Code Resource (no MCE sync / admin editing). */
export function applyHardcodedEmailMasterDefaults(template = {}) {
  if (String(template.messageType ?? "Email").trim() !== "Email") {
    return template;
  }
  return {
    ...template,
    contentBuilderTemplateKey: EMAIL_MASTER_SHELL_RESOURCE_KEY,
    shellResourceKey: EMAIL_MASTER_SHELL_RESOURCE_KEY,
    publishedShellResourceKey: EMAIL_MASTER_SHELL_RESOURCE_KEY,
    bodySlotKey: EMAIL_MASTER_BODY_SLOT_KEY,
    bodySlotLabel: EMAIL_MASTER_BODY_SLOT_LABEL,
    masterTemplateSlots: EMAIL_MASTER_TEMPLATE_SLOTS.map((slot) => ({
      ...slot,
    })),
    htmlWrapper: "",
    mceLastSyncedAt: "",
    mceSourceModifiedAt: "",
    mceAssetId: "",
    referenceTemplateBasedEmailAssetId: "",
  };
}
