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

This repository is currently in initial setup phase with prepared directory structure but no implemented code yet. When working in this codebase:

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

## Documentation Language

- **CLAUDE.md**: English (for Claude Code compatibility)
- **patchouli_doc/**: Japanese (for project documentation)