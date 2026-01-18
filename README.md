# Shakespeare

MCP server for Playwright browser automation and CSSOM inspection. Combines text-based CSS analysis with runtime browser inspection for comprehensive style debugging.

## Features

- **Navigate**: Open URLs in a headless Chromium browser
- **Screenshot**: Capture full or viewport screenshots
- **Evaluate**: Execute arbitrary JavaScript in the page context
- **Get Computed Styles**: Retrieve computed CSS for specific elements
- **Query Elements**: Find all matching elements and get their computed styles
- **HTTPS Support**: Automatically accepts self-signed certificates for local development

## Installation

```bash
npm install
npx playwright install chromium
```

## Usage

### Add to Claude Code

```bash
claude mcp add --transport stdio shakespeare -- node /Users/home/Documents/Code/MCP/shakespeare/index.js
```

### Available Tools

#### navigate
Navigate to a URL in the browser.

```json
{
  "url": "https://localhost:5173"
}
```

#### screenshot
Take a screenshot of the current page.

```json
{
  "fullPage": true
}
```

#### evaluate
Execute JavaScript in the page context.

**Basic usage:**
```json
{
  "script": "document.querySelectorAll('.card').length"
}
```

**Advanced usage with output modes:**
```json
{
  "script": "document.documentElement.outerHTML",
  "output_mode": "file",
  "output_path": "/path/to/output.html"
}
```

**Parameters:**
- `script` (required): JavaScript code to execute
- `output_mode` (optional): How to handle output
  - `"direct"` (default): Return immediately to Claude's context
  - `"file"`: Write to disk and return file path
- `output_path` (optional): Custom file path when using `output_mode: "file"`
- `size_limit` (optional): Character threshold for auto-file mode (default: 200,000 ≈ 25% context)

#### get_computed_styles
Get computed CSS styles for a specific element.

```json
{
  "selector": ".user-card .btn",
  "properties": ["width", "max-width", "color"]
}
```

If `properties` is omitted, returns all computed styles.

#### query_elements
Query all matching elements and get their computed styles.

```json
{
  "selector": ".card",
  "properties": ["gap", "padding", "margin"]
}
```

Returns an array with computed styles for each matching element.

#### close_browser
Close the browser instance to free resources.

```json
{}
```

## Workflows

### Workflow 1: Local Development Projects

For projects in development where output is small and controlled:

```javascript
// Navigate to local dev server
navigate({ url: "https://localhost:5173" })

// Extract small sections directly
evaluate({
  script: "document.querySelector('.main-content').innerHTML"
})

// Get specific data
evaluate({
  script: `
    Array.from(document.querySelectorAll('.card')).map(el => ({
      class: el.className,
      offsetTop: el.offsetTop,
      offsetHeight: el.offsetHeight
    }))
  `
})
```

### Workflow 2: JavaScript-Rendered Documentation Sites

For fetching large documentation from JS-rendered sites - use Shakespeare to extract, then specialized tools to clean:

```javascript
// Step 1: Navigate to docs site
navigate({ url: "https://docs.framework.dev" })

// Step 2: Extract HTML to file (auto-triggers if >200k chars)
evaluate({
  script: "document.documentElement.outerHTML",
  output_mode: "file",
  output_path: "/tmp/raw-docs.html"
})

// Step 3: Use specialized cleaning tools
// Option A: Use webfetch-clean MCP tool directly on the URL
// (webfetch-clean handles fetching + cleaning in one step)

// Option B: Use other HTML processing tools on the saved file
// Read tool with processing, pandoc, etc.

// For smaller pages, extract specific sections:
evaluate({
  script: "document.querySelector('main').innerHTML"
})
```

### Workflow 3: Style Debugging

```javascript
// Navigate to page
navigate({ url: "https://localhost:5173" })

// Take screenshot to see current state
screenshot({ fullPage: true })

// Query all cards to see their gaps
query_elements({
  selector: ".card",
  properties: ["margin-top", "margin-bottom", "gap"]
})

// Get specific element's computed styles
get_computed_styles({
  selector: "#logged-in-state",
  properties: ["gap", "display", "flex-direction"]
})
```

## Context Safeguards

Shakespeare automatically protects against context overflow when extracting large HTML:

**Automatic Behavior:**
- **Under 200k chars**: Returns directly to Claude (safe, ~25% of context)
- **Over 200k chars**: Automatically switches to file mode with warning
- **Custom limits**: Adjust with `size_limit` parameter

**Size Warnings:**
- Direct mode: Shows character count and estimated token usage
- File mode: Confirms file write location

**Example:**
```javascript
// This will auto-write to file if HTML is huge
evaluate({
  script: "document.documentElement.outerHTML"
})

// This allows larger direct output (use cautiously)
evaluate({
  script: "document.documentElement.outerHTML",
  size_limit: 500000  // ~62% of context
})

// Force file output regardless of size
evaluate({
  script: "document.documentElement.outerHTML",
  output_mode: "file",
  output_path: "/path/to/output.html"
})
```

## Tool Separation

Shakespeare focuses on **extraction** - other tools handle **processing**:

- **Shakespeare**: Browser automation, JS execution, HTML extraction, size management
- **webfetch-clean**: HTML cleaning (remove scripts/styles/ads), markdown conversion
- **Read tool**: View saved files with line numbers, partial reading
- **Other tools**: pandoc, html-to-markdown, custom processors

This separation allows each tool to excel at its specific task.

## Combining Approaches

**Text-based analysis (Read tool):**
- See all CSS rules at once
- Understand developer intent
- Find patterns and potential conflicts

**Runtime inspection (Shakespeare):**
- See what actually rendered
- Debug specificity and cascade issues
- Verify changes worked
- Extract JS-rendered content for analysis

Together, these provide complete visibility into both the architectural design and the runtime behavior of your styles.

## Development

The server runs on stdio transport and maintains a single browser instance across all tool calls. The browser is automatically launched on first use and can be explicitly closed with `close_browser`.

## License

MIT
