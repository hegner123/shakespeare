# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Shakespeare is an MCP (Model Context Protocol) server that provides Playwright-based browser automation and CSSOM (CSS Object Model) inspection capabilities. It runs as a stdio transport server and maintains a persistent browser instance across tool calls for efficiency.

## Commands

### Development
```bash
# Install dependencies
npm install

# Install Playwright browsers (required first time)
npx playwright install chromium

# Start the server (stdio transport)
node index.js

# Test the server
npm start
```

### MCP Installation
```bash
# Add to Claude Code (adjust path to your local installation)
claude mcp add --transport stdio shakespeare -- node /path/to/shakespeare/index.js
```

## Architecture

### Single-File Server Design
The entire server is implemented in `index.js` as a single class (`ShakespeareServer`) that:
- Extends MCP SDK's `Server` class
- Maintains a persistent browser instance across tool calls
- Implements 7 tools via request handlers
- Handles cleanup on SIGINT

### Browser Lifecycle
- **Lazy initialization**: Browser only launches on first tool call via `ensureBrowser()`
- **Persistent instance**: Single browser/context/page reused across all tool calls
- **Explicit cleanup**: Must call `close_browser` tool or SIGINT to release resources
- **HTTPS support**: Context created with `ignoreHTTPSErrors: true` for local dev

### Key Architectural Patterns

**State Management**
The server maintains three instance variables:
- `this.browser` - Chromium browser instance
- `this.context` - Browser context with HTTPS error ignoring
- `this.page` - Single page instance

All are initialized to `null` and lazy-loaded on first use.

**Tool Handler Pattern**
All tools follow this pattern:
1. `ensureBrowser()` to guarantee page instance
2. Perform Playwright operation
3. Return MCP-formatted response with `content` array

**Output Size Management**
The `evaluate` tool implements sophisticated size management:
- Default 200k character threshold (~25% of Claude's context)
- Auto-switches from direct mode to file mode when exceeded
- Supports explicit `output_mode` override
- Provides size warnings and token estimates

## Tool Categories

### Navigation & Capture
- `navigate` - Load URLs with `networkidle` wait
- `screenshot` - PNG screenshots (viewport or full page)
- `set_viewport` - Responsive testing

### JavaScript Execution
- `evaluate` - Execute arbitrary JS in page context
  - Returns JSON-serialized results
  - Handles size overflow to temp files
  - Estimates token usage for warnings

### Style Inspection (CSSOM)
- `get_computed_styles` - Single element's computed CSS
- `query_elements` - All matching elements with computed CSS

Both tools:
- Use `getComputedStyle()` in page context
- Support optional property filtering
- Return JSON-formatted results

### Resource Management
- `close_browser` - Explicit cleanup (page → context → browser)

## Important Implementation Details

### Error Handling
All tool handlers wrap operations in try/catch and return errors as MCP text content rather than throwing.

### JSON Serialization
Results are serialized with `JSON.stringify(result, null, 2)` for readability. The `evaluate` tool handles undefined values specially since they don't JSON-serialize.

### Element Selectors in query_elements
Reconstructs descriptive selectors from queried elements:
```javascript
element.tagName.toLowerCase() +
  (element.id ? `#${element.id}` : '') +
  (element.className ? `.${element.className.split(' ').join('.')}` : '')
```

### File Output Paths
When `evaluate` writes to file:
- Default: `${tmpdir()}/shakespeare-output-${Date.now()}.html`
- Custom: User-provided `output_path`
- Always UTF-8 encoding

## Integration Patterns

### Text-based Analysis + Runtime Inspection
Shakespeare complements text-based CSS analysis by providing runtime computed styles. Together:
- Read tool: See authored CSS rules and intent
- Shakespeare: See what actually rendered in browser

### Multi-Tool Workflows
1. Extract large HTML: `evaluate` → file output
2. Clean HTML: Pass to `webfetch-clean` MCP tool or other processors
3. Analyze: Use Read tool to view cleaned content

### Common Sequences
```javascript
// Style debugging workflow
navigate({ url }) → screenshot() → query_elements() → get_computed_styles()

// HTML extraction workflow
navigate({ url }) → evaluate({ script: "document.documentElement.outerHTML", output_mode: "file" })

// Responsive testing workflow
set_viewport({ width, height }) → screenshot() → query_elements()
```

## Dependencies

- `@modelcontextprotocol/sdk` - MCP server framework
- `playwright` - Browser automation (Chromium only)

Uses ES modules (`"type": "module"` in package.json).

## Context Budget Awareness

The 200k character default threshold is calibrated to ~25% of Claude's context window:
- 200k chars ≈ 25k tokens (using 1 char ≈ 0.8 tokens estimate)
- Claude Sonnet context: ~800k characters
- Leaves 75% for conversation, tool calls, and other context

When extracting large HTML, the server prefers file output to avoid context overflow.
