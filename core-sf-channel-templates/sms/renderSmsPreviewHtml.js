/**
 * Extracted from src/App.vue — SMS editor preview markup.
 * No dedicated SMS HTML master shell exists; preview is a simple bubble UI.
 */
function renderSmsPreviewHtml() {
  const fromName = escapeHtml(workingMessage.fromName || "SMS");
  const body = escapeHtml(workingSmsBody.value || "SMS content")
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, "<br>");
  return `
    <div class="sms-preview">
      <div class="sms-preview__header">${fromName}</div>
      <div class="sms-preview__bubble">${body}</div>
    </div>
  `;
}
