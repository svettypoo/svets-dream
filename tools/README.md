# Svet's Dream — Agent Tools Repository

Pre-built tools available to all agents in Svet's Dream.
These are NOT things agents need to code themselves — they are ready to use.

| Tool | File | What It Does |
|------|------|--------------|
| **Agent Screenshot Tool** | [agent-screenshot-tool.md](./agent-screenshot-tool.md) | Browser automation: navigate, click, fill, read, screenshot |

---

## How Tools Work

Tools are defined in `app/api/agent-chat/route.js` and handled server-side.
Agents call them like any other tool — they don't need to know the implementation.

The execution is routed through the Railway server at `EXECUTION_SERVER_URL`.

---

## Adding a New Tool

1. Add the tool definition to `implementerTools` (or `managerTools`) in `route.js`
2. Add the handler in the `handleTool` function
3. Add a markdown file in this `tools/` folder documenting it
4. Update MEMORY.md so future Claude sessions know it exists
