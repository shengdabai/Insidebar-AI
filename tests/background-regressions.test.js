import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../modules/history-manager.js', () => ({
  saveConversation: vi.fn(),
  findConversationByConversationId: vi.fn(),
}));
import { findConversationByConversationId } from '../modules/history-manager.js';

const slot = () => ({ addListener: vi.fn() });

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('chrome', {
    runtime: { onInstalled: slot(), onStartup: slot(), onMessage: slot(), lastError: null,
      sendMessage: vi.fn((message, callback) => callback?.({ hasFocus: true })) },
    storage: { sync: { get: vi.fn(async defaults => defaults) }, onChanged: slot() },
    sidePanel: { open: vi.fn(async () => {}), setPanelBehavior: vi.fn(async () => {}) },
    contextMenus: { onClicked: slot(), create: vi.fn(), removeAll: vi.fn(async () => {}) },
    action: { onClicked: slot() }, commands: { onCommand: slot() },
    windows: { onRemoved: slot() }, tabs: { sendMessage: vi.fn(async () => ({})) },
  });
  await import('../background/service-worker.js');
});

afterEach(() => vi.unstubAllGlobals());

it.each([true, false])('uses the sidebar focus reply (%s) to select the focus target', async hasFocus => {
  const command = chrome.commands.onCommand.addListener.mock.calls[0][0];
  const tab = { id: 7, windowId: 3 };
  chrome.runtime.sendMessage.mockImplementation((message, callback) => callback?.({ hasFocus }));
  await chrome.action.onClicked.addListener.mock.calls[0][0](tab);
  await command('toggle-focus', tab);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'checkFocus', payload: {} }, expect.any(Function));
  if (hasFocus) {
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { action: 'takeFocus' });
  } else {
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'takeFocus', payload: {} }, expect.any(Function));
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  }
});

it('responds to duplicate lookup failures without an unhandled rejection', async () => {
  findConversationByConversationId.mockRejectedValueOnce(new Error('Database unavailable'));
  const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
  const reply = vi.fn();
  expect(listener({ action: 'checkDuplicateConversation', payload: { conversationId: 'chat-1' } }, {}, reply)).toBe(true);
  await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ success: false, error: 'Database unavailable' }));
});

it.each([null, undefined, {}, { action: 'checkFocus' }])('ignores messages it does not handle: %j', message => {
  const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
  expect(listener(message, {}, vi.fn())).toBe(false);
});
