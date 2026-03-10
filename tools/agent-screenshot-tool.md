# Agent Screenshot Tool
**Type:** Built-in browser automation
**Available to:** All implementer agents (UI Agent, Backend Programmer, CTO, etc.)
**Powered by:** Playwright + Chromium on Railway execution server

---

## What It Does

Gives agents a persistent, real browser they can control step-by-step without writing any code.
The browser stays open across multiple tool calls in the same conversation — navigate, click, fill forms,
read content, and take screenshots all in sequence.

---

## Tools

### `browser_navigate`
Open a URL. Returns a screenshot of the loaded page.
```
url: "https://example.com"
```

### `browser_screenshot`
Capture the current page visually.
```
fullPage: true | false   (default false = viewport only)
```

### `browser_click`
Click a button, link, or any element.
```
selector: "#submit-btn"         (CSS selector)
selector: "Sign in"             (visible text — finds by text content)
```

### `browser_fill`
Type into an input field.
```
selector: "input[name=email]"
value: "user@example.com"
```

### `browser_read`
Extract visible text from the page or a specific element.
```
selector: ".pricing-table"      (optional — defaults to entire body)
```

### `browser_close`
Close the browser session and free memory when done.

---

## Example Agent Workflow

```
1. browser_navigate  →  url: "https://competitor.com/pricing"
2. browser_screenshot  →  (verify it loaded correctly)
3. browser_read  →  selector: ".pricing-table"
4. browser_navigate  →  url: "https://our-deployed-site.vercel.app"
5. browser_screenshot  →  fullPage: true
6. browser_close
```

---

## Notes

- Sessions are per-agent (one browser per agent role in a conversation)
- Screenshots render inline in the chat as images
- The browser runs headless Chromium on the Railway execution server
- Requires `EXECUTION_SERVER_URL` to be set in Vercel env vars
- Falls back gracefully with an error message if the server is unavailable
