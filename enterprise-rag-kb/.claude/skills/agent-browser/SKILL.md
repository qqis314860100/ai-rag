---
name: agent-browser
description: Browser automation testing for the Enterprise RAG Knowledge Base web app. Use Playwright MCP tools to navigate, interact, screenshot, and verify UI behavior. Use when user wants to test the frontend, run browser tests, verify UI features, take screenshots, or debug frontend issues at http://localhost:5174.
---

# Agent Browser Testing

Test the battery production line RAG knowledge base at `http://localhost:5174` using Playwright MCP tools.

## MCP Tools

The Playwright MCP server provides:

- `browser_navigate` — Navigate to a URL
- `browser_click` — Click element by description or CSS selector
- `browser_type` — Type text into input field
- `browser_snapshot` — Get accessibility snapshot of current page
- `browser_take_screenshot` — Take a screenshot (returns base64 PNG)
- `browser_press_key` — Press keyboard keys
- `browser_evaluate` — Execute JavaScript in page
- `browser_wait_for` — Wait for text or selector

Tool naming: Use `mcp__playwright__<tool_name>` format. First fetch schemas via ToolSearch if needed.

## Standard Test Flow

### 1. Chat Page

```
1. browser_navigate to http://localhost:5174/chat
2. browser_snapshot — check for empty state elements
3. browser_take_screenshot — capture initial state
4. browser_type into textarea — enter test question like "激光焊接安全要求"
5. browser_click Send button
6. browser_wait_for tokens to appear — verify streaming works
7. browser_take_screenshot — capture streaming state
8. browser_wait_for "查看" reference button to appear
9. browser_click "查看 N 条引用" to open source panel
10. browser_take_screenshot — capture chat with sources
11. browser_click a follow-up suggestion chip
12. Verify follow-up triggers new streaming response
13. browser_click a source card — verify triggers new query
```

### 2. Session Management

```
1. browser_snapshot — check session sidebar
2. browser_click + button for new session
3. Verify messages cleared
4. browser_click previous session
5. Verify messages reloaded
```

### 3. Document Upload

```
1. browser_navigate to http://localhost:5174/documents
2. browser_take_screenshot — capture document list
3. browser_snapshot — check document count and status
```

### 4. Dashboard

```
1. browser_navigate to http://localhost:5174/
2. browser_snapshot — check metric cards
3. browser_take_screenshot — capture dashboard
```

### 5. Debugger

```
1. browser_navigate to http://localhost:5174/debugger
2. browser_type query and browser_click search
3. Verify results appear
4. browser_take_screenshot
```

## Reporting Format

After tests, report a table:

| Flow | Status | Issues |
|------|--------|--------|
| Chat | PASS/FAIL | details |
| Sessions | PASS/FAIL | details |
| Documents | PASS/FAIL | details |
| Dashboard | PASS/FAIL | details |
| Debugger | PASS/FAIL | details |

Include key screenshots inline (base64 PNG from browser_take_screenshot).

## Debugging

If MCP tools unavailable, Playwright MCP server needs restart. The session must have `.mcp.json` with Playwright server configured and approved.
