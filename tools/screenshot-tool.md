# Screenshot Tool
**Tool name:** `screenshot_url`
**Type:** Built-in — single-call URL screenshot
**Available to:** All implementer agents
**Powered by:** Chromium on Railway execution server

---

## What It Does

Takes a screenshot of any URL in one tool call. No setup, no session management, no separate navigate + screenshot steps.
Returns the screenshot inline in chat so the user can see it immediately.

Use this to:
- Verify a deployed site after building it
- Check what a competitor looks like before designing
- Confirm a UI change looks correct
- QA a live page at any point in the workflow

---

## Tool

### `screenshot_url`
```
url: "https://myapp.vercel.app"          (required)
fullPage: true | false                    (optional, default false = viewport only)
```

Returns: inline screenshot image rendered in chat + page title and URL.

---

## Example Usage

```
1. Build the site and deploy with `vercel --prod --yes`
2. screenshot_url → url: "https://myapp.vercel.app"
3. User sees the live site inline — no need to open a browser
```

```
1. screenshot_url → url: "https://competitor.com"
2. Use the screenshot as design reference when briefing Backend Programmer
```

---

## Notes

- Opens a fresh browser session per call, closes it automatically when done
- Does NOT persist a session — use `browser_navigate` + `browser_screenshot` if you need to interact (click, fill) after navigating
- Runs headless Chromium on Railway — same infrastructure as all other browser tools
- Requires `EXECUTION_SERVER_URL` in Vercel env vars
