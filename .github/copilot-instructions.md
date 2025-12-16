# GitHub Copilot Instructions for autotask-mcp

## Build Guidelines

**IMPORTANT:** Use `npm run build` for testing builds. Only use `npm run build:link` when explicitly requested by the user.

- `npm run build` - Compile TypeScript to test changes (default for development)
- `npm run build:link` - Compile and link globally (use only when explicitly requested)
- `npm run build:all` - Full build including Smithery deployment

## Development Workflow

1. Make code changes
2. Test with `npm run build`
3. Verify compilation succeeds
4. Only run `npm run build:link` when user explicitly asks to link the package

## Rationale

The `npm link` step connects the local development version globally, which should only happen when intentionally deploying for testing in Claude Desktop or other MCP clients. During normal development, standard builds are sufficient.
