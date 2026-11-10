import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createTextInjectionHandler } from '../content-scripts/text-injection-handler.js';

const script = name => readFileSync(`content-scripts/${name}.js`, 'utf8');
const extensionOrigin = 'chrome-extension://test-extension';

beforeEach(() => {
  document.body.replaceChildren();
  chrome.runtime.getURL = vi.fn(() => `${extensionOrigin}/`);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe.each(['standalone', 'module'])('%s text injection boundary', (variant) => {
  function setup() {
    const textarea = document.createElement('textarea');
    textarea.id = 'prompt-textarea';
    document.body.append(textarea);
    let handler;
    const parent = {};
    if (variant === 'standalone') {
      runInNewContext(script('text-injection-all-providers'), {
        window: {
          parent,
          location: { hostname: 'chatgpt.com', origin: 'https://chatgpt.com' },
          HTMLTextAreaElement,
          addEventListener: (_, listener) => { handler = listener; },
        },
        chrome, document, Event, console, setTimeout,
      });
    } else {
      vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
      handler = createTextInjectionHandler('#prompt-textarea', 'chatgpt');
    }
    return { textarea, handler, parent };
  }

  it.each(['parent', 'hidden'])('accepts this extension with %s source', (source) => {
    const { textarea, handler, parent } = setup();
    handler({ isTrusted: true, origin: extensionOrigin, source: source === 'parent' ? parent : null,
      data: { type: 'INJECT_TEXT', text: '<b>literal prompt</b>' } });
    expect(textarea.value).toBe('<b>literal prompt</b>');
  });

  it.each(['https://chatgpt.com', 'https://attacker.invalid',
    'chrome-extension://other-extension', '', 'null'])('rejects origin %j', (origin) => {
    const { textarea, handler } = setup();
    handler({ isTrusted: true, origin, source: null, data: { type: 'INJECT_TEXT', text: 'untrusted' } });
    expect(textarea.value).toBe('');
  });

  it('rejects an unrelated window even with the expected origin', () => {
    const { textarea, handler } = setup();
    handler({ isTrusted: true, origin: extensionOrigin, source: {}, data: { type: 'INJECT_TEXT', text: 'untrusted' } });
    expect(textarea.value).toBe('');
  });

  it.each([null, {}, 123, 'x'.repeat(1048577)])('rejects invalid text payload %#', (text) => {
    const { textarea, handler, parent } = setup();
    handler({ isTrusted: true, origin: extensionOrigin, source: parent, data: { type: 'INJECT_TEXT', text } });
    expect(textarea.value).toBe('');
  });

  it('rejects synthetic messages with a forged extension origin', () => {
    const { textarea, handler } = setup();
    handler(new MessageEvent('message', { origin: extensionOrigin,
      data: { type: 'INJECT_TEXT', text: 'forged' } }));
    expect(textarea.value).toBe('');
  });
});

it('renders untrusted duplicate titles as text and preserves the cancel action', async () => {
  const sandbox = { window: {}, document, chrome: { i18n: { getMessage: key => key } } };
  runInNewContext(script('conversation-extractor-utils'), sandbox);
  const title = '<img src="https://attacker.invalid/pixel" onerror="alert(1)"> & "quoted"';
  const choice = sandbox.window.ConversationExtractorUtils.showDuplicateWarning(title, {});
  const modal = document.getElementById('insidebar-duplicate-modal');
  expect(modal.querySelector('img, [onerror]')).toBeNull();
  expect(modal.textContent).toContain(title);
  modal.querySelector('#insidebar-dup-cancel').click();
  await expect(choice).resolves.toBe('cancel');
  expect(modal.isConnected).toBe(false);
});
