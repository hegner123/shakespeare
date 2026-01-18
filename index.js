#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { chromium } from 'playwright';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

class ShakespeareServer {
  constructor() {
    this.server = new Server(
      {
        name: 'shakespeare',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.browser = null;
    this.context = null;
    this.page = null;

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'navigate',
          description: 'Navigate to a URL in the browser',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The URL to navigate to',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'screenshot',
          description: 'Take a screenshot of the current page',
          inputSchema: {
            type: 'object',
            properties: {
              fullPage: {
                type: 'boolean',
                description: 'Capture full scrollable page',
                default: false,
              },
            },
          },
        },
        {
          name: 'evaluate',
          description: 'Execute JavaScript in the page context and return the result',
          inputSchema: {
            type: 'object',
            properties: {
              script: {
                type: 'string',
                description: 'JavaScript code to execute',
              },
              output_mode: {
                type: 'string',
                enum: ['direct', 'file'],
                description: 'Output handling mode: direct (return immediately), file (write to disk)',
                default: 'direct',
              },
              output_path: {
                type: 'string',
                description: 'File path for output when using file mode. Defaults to temp directory if not specified.',
              },
              size_limit: {
                type: 'number',
                description: 'Character limit before warning/forcing file output (default: 200000, ~25% of context)',
                default: 200000,
              },
            },
            required: ['script'],
          },
        },
        {
          name: 'get_computed_styles',
          description: 'Get computed CSS styles for an element',
          inputSchema: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector for the element',
              },
              properties: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional array of specific CSS properties to retrieve. If not provided, returns all computed styles.',
              },
            },
            required: ['selector'],
          },
        },
        {
          name: 'query_elements',
          description: 'Query elements and get their computed styles',
          inputSchema: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector to query',
              },
              properties: {
                type: 'array',
                items: { type: 'string' },
                description: 'CSS properties to retrieve for each element',
              },
            },
            required: ['selector', 'properties'],
          },
        },
        {
          name: 'set_viewport',
          description: 'Set the viewport size for responsive testing',
          inputSchema: {
            type: 'object',
            properties: {
              width: {
                type: 'number',
                description: 'Viewport width in pixels',
              },
              height: {
                type: 'number',
                description: 'Viewport height in pixels',
              },
            },
            required: ['width', 'height'],
          },
        },
        {
          name: 'close_browser',
          description: 'Close the browser instance',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          case 'navigate':
            return await this.handleNavigate(args);
          case 'screenshot':
            return await this.handleScreenshot(args);
          case 'evaluate':
            return await this.handleEvaluate(args);
          case 'get_computed_styles':
            return await this.handleGetComputedStyles(args);
          case 'query_elements':
            return await this.handleQueryElements(args);
          case 'set_viewport':
            return await this.handleSetViewport(args);
          case 'close_browser':
            return await this.handleCloseBrowser();
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
        };
      }
    });
  }

  async ensureBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext({
        ignoreHTTPSErrors: true, // Allow self-signed certificates
      });
      this.page = await this.context.newPage();
    }
    return this.page;
  }

  async handleNavigate(args) {
    const page = await this.ensureBrowser();
    await page.goto(args.url, { waitUntil: 'networkidle' });

    return {
      content: [
        {
          type: 'text',
          text: `Navigated to ${args.url}`,
        },
      ],
    };
  }

  async handleScreenshot(args) {
    const page = await this.ensureBrowser();
    const screenshot = await page.screenshot({
      fullPage: args.fullPage || false,
      type: 'png',
    });

    return {
      content: [
        {
          type: 'image',
          data: screenshot.toString('base64'),
          mimeType: 'image/png',
        },
      ],
    };
  }

  async handleEvaluate(args) {
    const page = await this.ensureBrowser();
    let result = await page.evaluate(args.script);

    // Convert result to string for size checking
    const resultString = result === undefined ? 'undefined' :
                        (typeof result === 'string' ? result : JSON.stringify(result, null, 2));

    const sizeLimit = args.size_limit || 200000; // Default ~25% of context
    const outputMode = args.output_mode || 'direct';

    // Check size and determine output strategy
    const exceedsLimit = resultString.length > sizeLimit;
    const finalMode = exceedsLimit && outputMode === 'direct' ? 'file' : outputMode;

    // Handle different output modes
    if (finalMode === 'file') {
      const outputPath = args.output_path || join(tmpdir(), `shakespeare-output-${Date.now()}.html`);
      await writeFile(outputPath, resultString, 'utf-8');

      const sizeWarning = exceedsLimit ?
        `\n\n⚠️  Output size (${resultString.length.toLocaleString()} chars) exceeds ${(sizeLimit/1000).toFixed(0)}k limit. Written to file instead.` :
        '';

      return {
        content: [
          {
            type: 'text',
            text: `Output written to file: ${outputPath}${sizeWarning}\n\nUse Read tool to view contents, or pipe to webfetch-clean for HTML cleaning.`,
          },
        ],
      };
    }

    // Direct mode
    const sizeWarning = resultString.length > sizeLimit ?
      `⚠️  Large output (${resultString.length.toLocaleString()} chars, ~${(resultString.length/800).toFixed(0)}k tokens). Consider using output_mode: "file".\n\n` :
      '';

    return {
      content: [
        {
          type: 'text',
          text: sizeWarning + resultString,
        },
      ],
    };
  }

  async handleGetComputedStyles(args) {
    const page = await this.ensureBrowser();

    const result = await page.evaluate(({ selector, properties }) => {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }

      const computed = getComputedStyle(element);

      if (properties && properties.length > 0) {
        const styles = {};
        properties.forEach(prop => {
          styles[prop] = computed[prop];
        });
        return styles;
      }

      return Object.fromEntries(
        Array.from(computed).map(key => [key, computed[key]])
      );
    }, { selector: args.selector, properties: args.properties });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  async handleQueryElements(args) {
    const page = await this.ensureBrowser();

    const result = await page.evaluate(({ selector, properties }) => {
      const elements = document.querySelectorAll(selector);

      return Array.from(elements).map((element, index) => {
        const computed = getComputedStyle(element);
        const styles = {};

        properties.forEach(prop => {
          styles[prop] = computed[prop];
        });

        return {
          index,
          selector: element.tagName.toLowerCase() +
                   (element.id ? `#${element.id}` : '') +
                   (element.className ? `.${element.className.split(' ').join('.')}` : ''),
          styles,
        };
      });
    }, { selector: args.selector, properties: args.properties });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  async handleSetViewport(args) {
    const page = await this.ensureBrowser();
    await page.setViewportSize({ width: args.width, height: args.height });

    return {
      content: [
        {
          type: 'text',
          text: `Viewport set to ${args.width}x${args.height}`,
        },
      ],
    };
  }

  async handleCloseBrowser() {
    await this.cleanup();

    return {
      content: [
        {
          type: 'text',
          text: 'Browser closed',
        },
      ],
    };
  }

  async cleanup() {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Shakespeare MCP server running on stdio');
  }
}

const server = new ShakespeareServer();
server.run().catch(console.error);
