# RAG Documentation MCP Server
[![smithery badge](https://smithery.ai/badge/@rahulretnan/mcp-ragdocs)](https://smithery.ai/server/@rahulretnan/mcp-ragdocs)

An MCP server implementation that provides tools for retrieving and processing documentation through vector search, enabling AI assistants to augment their responses with relevant documentation context.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Docker Compose Setup](#docker-compose-setup)
- [Web Interface](#web-interface)
- [Configuration](#configuration)
  - [Cline Configuration](#cline-configuration)
  - [Claude Desktop Configuration](#claude-desktop-configuration)
- [Acknowledgments](#acknowledgments)
- [Troubleshooting](#troubleshooting)

## Features

### Tools

1. **search_documentation**

   - Search through the documentation using vector search
   - Returns relevant chunks of documentation with source information

2. **list_sources**

   - List all available documentation sources
   - Provides metadata about each source

3. **extract_urls**

   - Extract URLs from text and check if they're already in the documentation
   - Useful for preventing duplicate documentation

4. **remove_documentation**

   - Remove documentation from a specific source
   - Cleans up outdated or irrelevant documentation

5. **list_queue**

   - List all items in the processing queue
   - Shows status of pending documentation processing

6. **run_queue**

   - Process all items in the queue
   - Automatically adds new documentation to the vector store

7. **clear_queue**

   - Clear all items from the processing queue
   - Useful for resetting the system

8. **add_documentation**
   - Add new documentation to the processing queue
   - Supports various formats and sources

## Quick Start

The RAG Documentation tool is designed for:

- Enhancing AI responses with relevant documentation
- Building documentation-aware AI assistants
- Creating context-aware tooling for developers
- Implementing semantic documentation search
- Augmenting existing knowledge bases



## Running evals

The evals package loads an mcp client that then runs the index.ts file, so there is no need to rebuild between tests. You can load environment variables by prefixing the npx command. Full documentation can be found [here](https://www.mcpevals.io/docs).

```bash
OPENAI_API_KEY=your-key  npx mcp-eval src/evals/evals.ts src/handler-registry.ts
```
## Docker Compose Setup

The project includes a `docker-compose.yml` file for easy containerized deployment. To start the services:

```bash
docker-compose up -d
```

To stop the services:

```bash
docker-compose down
```

## Web Interface

The system includes a web interface that can be accessed after starting the Docker Compose services:

1. Open your browser and navigate to: `http://localhost:3030`
2. The interface provides:
   - Real-time queue monitoring
   - Documentation source management
   - Search interface for testing queries
   - System status and health checks

## Configuration

### Embeddings Configuration

The system uses Ollama as the default embedding provider for local embeddings generation, with OpenAI available as a fallback option. This setup prioritizes local processing while maintaining reliability through cloud-based fallback.

#### Environment Variables

- `EMBEDDING_PROVIDER`: Choose the primary embedding provider ('ollama' or 'openai', default: 'ollama')
- `EMBEDDING_MODEL`: Specify the model to use (optional)
  - For OpenAI: defaults to 'text-embedding-3-small'
  - For Ollama: defaults to 'nomic-embed-text'
- `OPENAI_API_KEY`: Required when using OpenAI as provider
- `FALLBACK_PROVIDER`: Optional backup provider ('ollama' or 'openai')
- `FALLBACK_MODEL`: Optional model for fallback provider

### Cline Configuration

Add this to your `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "rag-docs": {
      "command": "node",
      "args": ["/path/to/your/mcp-ragdocs/build/index.js"],
      "env": {
        "EMBEDDING_PROVIDER": "ollama", // default
        "EMBEDDING_MODEL": "nomic-embed-text", // optional
        "OPENAI_API_KEY": "your-api-key-here", // required for fallback
        "FALLBACK_PROVIDER": "openai", // recommended for reliability
        "FALLBACK_MODEL": "nomic-embed-text", // optional
        "QDRANT_URL": "http://localhost:6333"
      },
      "disabled": false,
      "autoApprove": [
        "search_documentation",
        "list_sources",
        "extract_urls",
        "remove_documentation",
        "list_queue",
        "run_queue",
        "clear_queue",
        "add_documentation"
      ]
    }
  }
}
```

### Claude Desktop Configuration

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rag-docs": {
      "command": "node",
      "args": ["/path/to/your/mcp-ragdocs/build/index.js"],
      "env": {
        "EMBEDDING_PROVIDER": "ollama", // default
        "EMBEDDING_MODEL": "nomic-embed-text", // optional
        "OPENAI_API_KEY": "your-api-key-here", // required for fallback
        "FALLBACK_PROVIDER": "openai", // recommended for reliability
        "FALLBACK_MODEL": "nomic-embed-text", // optional
        "QDRANT_URL": "http://localhost:6333"
      }
    }
  }
}
```

### Default Configuration

The system uses Ollama by default for efficient local embedding generation. For optimal reliability:

1. Install and run Ollama locally
2. Configure OpenAI as fallback (recommended):
   ```json
   {
     // Ollama is used by default, no need to specify EMBEDDING_PROVIDER
     "EMBEDDING_MODEL": "nomic-embed-text", // optional
     "FALLBACK_PROVIDER": "openai",
     "FALLBACK_MODEL": "text-embedding-3-small",
     "OPENAI_API_KEY": "your-api-key-here"
   }
   ```

This configuration ensures:
- Fast, local embedding generation with Ollama
- Automatic fallback to OpenAI if Ollama fails
- No external API calls unless necessary

Note: The system will automatically use the appropriate vector dimensions based on the provider:
- Ollama (nomic-embed-text): 768 dimensions
- OpenAI (text-embedding-3-small): 1536 dimensions

## Acknowledgments

This project is a fork of [qpd-v/mcp-ragdocs](https://github.com/qpd-v/mcp-ragdocs), originally developed by qpd-v. The original project provided the foundation for this implementation.

Special thanks to the original creator, qpd-v, for their innovative work on the initial version of this MCP server. This fork has been enhanced with additional features and improvements by Rahul Retnan.

## Troubleshooting

### Server Not Starting (Port Conflict)

If the MCP server fails to start due to a port conflict, follow these steps:

1. Identify and kill the process using port 3030:

```bash
npx kill-port 3030
```

2. Restart the MCP server

3. If the issue persists, check for other processes using the port:

```bash
lsof -i :3030
```

4. You can also change the default port in the configuration if needed
