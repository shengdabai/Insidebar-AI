import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { installHeaderRules } from '../modules/header-rules.js';
import { PROVIDERS } from '../modules/providers.js';

const read = (name) => readFileSync(fileURLToPath(new NodeURL(`../${name}`, import.meta.url)), 'utf8');
const rules = JSON.parse(read('rules/bypass-headers.json'));
const manifest = JSON.parse(read('manifest.json'));

function createApi(scheme = 'chrome-extension', host = 'abcdefghijklmnopabcdefghijklmnop') {
  return {
    runtime: { getURL: (path) => `${scheme}://${host}/${path}` },
    declarativeNetRequest: { updateSessionRules: vi.fn().mockResolvedValue(undefined) },
  };
}

describe('sidebar header bypass isolation', () => {
  it('has no globally enabled static rules and restricts all templates to non-tab subframes', () => {
    expect(manifest.declarative_net_request).toBeUndefined();
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.condition.tabIds).toEqual([-1]);
      expect(rule.condition.resourceTypes).toEqual(['sub_frame']);
      expect(rule.condition.urlFilter).toMatch(/^\|https?:\/\//);
    }
  });

  it.each([
    ['chrome-extension', 'abcdefghijklmnopabcdefghijklmnop'],
    ['moz-extension', '7f082d64-1aea-4ad5-8fb8-2578b41c789a'],
  ])('installs rules for this %s origin only', async (scheme, host) => {
    const api = createApi(scheme, host);
    const fetchRules = vi.fn().mockResolvedValue({ ok: true, json: async () => rules });
    await installHeaderRules(api, fetchRules);
    expect(fetchRules).toHaveBeenCalledWith(api.runtime.getURL('rules/bypass-headers.json'));
    expect(api.declarativeNetRequest.updateSessionRules).toHaveBeenCalledExactlyOnceWith({
      removeRuleIds: rules.map(({ id }) => id),
      addRules: rules.map((rule) => ({
        ...rule,
        condition: { ...rule.condition, initiatorDomains: [host] },
      })),
    });
  });

  it('waits for rule registration before the sidebar loads its default iframe', () => {
    const source = read('sidebar/sidebar.js');
    expect(source.indexOf('await installHeaderRules()')).toBeGreaterThan(0);
    expect(source.indexOf('await installHeaderRules()')).toBeLessThan(source.indexOf('await loadDefaultProvider()'));
  });

  it('handles browsers without the session-rule API without fetching templates', async () => {
    const fetchRules = vi.fn();
    await expect(installHeaderRules({}, fetchRules)).resolves.toBeUndefined();
    expect(fetchRules).not.toHaveBeenCalled();
  });

  it('does not install rules when loading templates fails', async () => {
    const api = createApi();
    await expect(installHeaderRules(api, vi.fn().mockResolvedValue({ ok: false })))
      .rejects.toThrow('Unable to load header rules');
    expect(api.declarativeNetRequest.updateSessionRules).not.toHaveBeenCalled();
  });

  it('propagates registration errors so the sidebar can report the failure', async () => {
    const api = createApi();
    api.declarativeNetRequest.updateSessionRules.mockRejectedValue(new Error('Rejected rule'));
    await expect(installHeaderRules(api, async () => ({ ok: true, json: async () => rules })))
      .rejects.toThrow('Rejected rule');
    expect(api.declarativeNetRequest.updateSessionRules).toHaveBeenCalledTimes(1);
  });

  it('replaces existing rules atomically when a second sidebar opens', async () => {
    const api = createApi();
    const fetchRules = async () => ({ ok: true, json: async () => rules });
    await installHeaderRules(api, fetchRules);
    await installHeaderRules(api, fetchRules);
    const [first, second] = api.declarativeNetRequest.updateSessionRules.mock.calls;
    expect(first).toEqual(second);
    expect(new Set(first[0].removeRuleIds).size).toBe(rules.length);
  });
});

describe('host permission minimization', () => {
  it('does not offer unused arbitrary or local optional host access', () => {
    expect(manifest.optional_host_permissions ?? []).toEqual([]);
    expect(manifest.host_permissions).not.toContain('*://*/*');
    expect(manifest.host_permissions).not.toContain('<all_urls>');
  });

  it('retains host access for every supported provider and version checks', () => {
    for (const provider of PROVIDERS) {
      expect(manifest.host_permissions).toContain(`*://${new NodeURL(provider.url).hostname}/*`);
    }
    expect(manifest.host_permissions).toContain('*://api.github.com/*');
  });
});
