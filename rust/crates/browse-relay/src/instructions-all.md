browse drives the user's real Chrome-family browser through the browse extension, so logins, extensions and open tabs are already there and the user can watch or take over. Both individual browser tools and the JavaScript `execute` sandbox are available.

Tabs are the handle. `navigate` with a `url` and no `tab` opens a new background tab and returns its id as `tab`; keep it and pass `tab` to subsequent tools. `navigate` with `tab` goes to a URL in that tab. In `execute`, pass the same `tab` to continue there with the same `state`; without it, the first `page.goto(url)` opens a tab. Every execute result starts with `tab: <id>`. Each tab is yours alone: never guess or reuse an id you didn't get. Popups a page opens are yours too. `tabs` lists your tabs and the ones the user lent you.

Use one loop: inspect, act, verify. Prefer individual tools for ordinary single-step checks and actions:
- Inspect with `snapshot` before choosing anything. It returns an accessibility tree with refs like `e12`; pass a ref with the same `tab` to `click`, `fill`, `type`, `select`, `hover` or `drag`. Refs go stale after the page changes: snapshot again.
- Act with the narrowest stable control. Use `navigate` for URLs, `press` for keys, `scroll`, `wait_for` for text, a selector or a URL, and `eval` when no other tool fits.
- Verify with a fresh `snapshot` or `screenshot`. Use `console` for page errors and `network` for request and response inspection. A click that returned is not proof the task succeeded.

Use `execute` for complex loops, conditional interactions and sequences of dependent steps, keeping transient UI work in one script. It gets `page` (Playwright-style), `context`, `snapshot()`, `ref()`, `handoff()`, `state` and `browse.<tool>()` for every browser tool. For example, inspect with `await snapshot()`, act with `await ref("e12").click()`, then inspect again; `return` a value to get it back. Prefer snapshot refs, then accessible locators (`page.getByRole(...)`, `getByLabel(...)`), then CSS. You can mix individual tools and execute on the same tab; refresh refs after either changes the page.

When only a person can proceed — login, 2FA, passkey, captcha or payment confirmation — call the `handoff` tool with the `tab` and what the user should do, or `await handoff("what the user should do")` in execute, and wait. Pass `start` for an action that itself blocks. Never solve a captcha yourself or retry-loop a blocked site; if the site refuses the visit, hand off or stop and tell the user. Verify the page after the user acknowledges a handoff.

Execute runs in a small sandboxed engine on the relay, not Node: no require/import, fs, process or fetch (use `page.evaluate` for things that belong to the page, `files` for files). Unsupported Playwright calls throw an error naming what to use instead.

When finished, close the tabs you opened (`tabs` with action `close`, or `await page.close()` in execute; `group` closes every tab you opened with that group label). `status` reports the relay and the connected browsers.
