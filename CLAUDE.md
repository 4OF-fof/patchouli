# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Architecture

This is a multi-component Patchouli project with a Rust-based core server architecture designed to operate as a knowledge base management system, treating file server contents as a unified knowledge base for management and operation:

- **core/**: Core Rust server using Axum framework providing API endpoints and main functionality for knowledge base management, content curation, and intelligent search capabilities. Uses SQLite as auxiliary database for metadata and indexing while primary content remains as files
- **discord/**: Discord bot integration using TypeScript and discord.js consuming the core server API
- **doc/**: Project documentation and user guides
- **mcp/**: Model Context Protocol (MCP) implementation using TypeScript SDK consuming the core server API

The architecture follows a microservices pattern where:
- The **core/** module provides a Rust server with HTTP/API endpoints for knowledge base management, content curation, and intelligent search operations
- Other modules act as clients consuming the core server's API
- Each module can be developed independently while maintaining API compatibility

## Development Status

This repository has implemented core authentication and MCP functionality. Current implementation status:

- **core/**: ✅ Google OAuth 2.0 authentication system with API endpoints
- **mcp/**: ✅ Browser-based authentication and protected content access tools
- **discord/**: ⏳ Not implemented yet
- **doc/**: ✅ Architecture and usage documentation

When working in this codebase:

1. Check each component directory for its specific tech stack and dependencies
2. Look for README files in each subdirectory for component-specific instructions
3. Each component may use different programming languages and frameworks
4. Build and test commands will be component-specific once implemented

## Project Structure

The modular architecture allows for:
- Independent development of Discord integration without affecting core functionality
- Separate documentation management and generation
- Isolated MCP protocol implementation
- Clear separation of concerns between different features

When adding new functionality, consider which component it belongs to and maintain the modular separation.

## Development Workflow

### Branch Creation Policy

Before starting any development work, ALWAYS follow this workflow:

1. **Ask for user confirmation** before creating any new branch
2. **Create a new branch** for each feature, refactoring, or bug fix
3. **Work exclusively on the new branch** until completion
4. **Never work directly on main/master branch**

**Examples of when to create branches:**
- New feature development
- Code refactoring
- Bug fixes
- Documentation updates
- Configuration changes

**Branch naming conventions:**
- Features: `feat/feature-name`
- Bug fixes: `fix/bug-description`
- Refactoring: `refactor/component-name`
- Documentation: `docs/update-description`

**Workflow steps:**
1. Explain what you plan to do
2. Ask user: "Should I create a new branch for this work?"
3. Wait for user confirmation
4. Create branch with appropriate name
5. Perform the work on the new branch
6. Test and verify the implementation works correctly
7. **Create a commit** with appropriate commit message after successful testing
8. Complete the task before switching branches

### Commit Message Guidelines

After completing development work and verifying functionality:

1. **Update documentation before committing** - Always update doc/ files to reflect new features or changes
2. **Summarize the work performed** in the commit message
3. **Use conventional commit format** when applicable:
   - `feat: add new feature description`
   - `fix: resolve bug description`
   - `refactor: improve code structure`
   - `docs: update documentation`
   - `test: add or update tests`

4. **Include key changes** in the commit body if needed
5. **Always commit after successful testing** - never commit broken or untested code

**Example commit messages:**
- `feat: implement MCP server with protected content retrieval`
- `fix: resolve authentication timeout in core server`
- `refactor: restructure client error handling for better UX`
- `docs: add Japanese README for MCP component`

### Documentation Update Policy

Before creating any commit, ALWAYS:

1. **Update relevant documentation** in doc/ directory
2. **Reflect architectural changes** in doc/architecture.md
3. **Update usage instructions** in doc/usage.md  
4. **Add new setup guides** when introducing new components
5. **Ensure documentation accuracy** matches the actual implementation

Documentation updates should be included in the same commit as the feature implementation.

## Package Manager

This project uses **pnpm** as the package manager for all TypeScript/JavaScript components (discord/, mcp/). When working with these components:

- Use `pnpm install` instead of `npm install`
- Use `pnpm run <script>` instead of `npm run <script>`
- All package.json files specify `"packageManager": "pnpm@10.12.3"`

## Documentation Language

- **CLAUDE.md**: English (for Claude Code compatibility)
- **patchouli_doc/**: Japanese (for project documentation)