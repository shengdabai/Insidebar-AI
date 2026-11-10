// Session rules support tabIds; static rules do not. Install before loading
// provider frames so ordinary web tabs never lose their framing protections.
export async function installHeaderRules(api = chrome, fetchRules = fetch) {
  if (!api.declarativeNetRequest?.updateSessionRules) return;

  const response = await fetchRules(api.runtime.getURL('rules/bypass-headers.json'));
  if (!response.ok) throw new Error('Unable to load header rules');
  const templates = await response.json();
  // Firefox's runtime URL uses a generated UUID, not its manifest add-on ID.
  const initiator = new URL(api.runtime.getURL('')).hostname;
  const rules = templates.map((rule) => ({
    ...rule,
    condition: { ...rule.condition, initiatorDomains: [initiator] },
  }));
  await api.declarativeNetRequest.updateSessionRules({
    removeRuleIds: rules.map(({ id }) => id),
    addRules: rules,
  });
}
