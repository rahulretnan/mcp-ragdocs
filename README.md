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
   - Add new documentation directly to the system by providing a URL
   - Automatically fetches, processes, and indexes the content
   - Supports various web page formats and extracts relevant content
   - Chunks content intelligently for optimal retrieval
   - Required parameter: `url` (must include protocol, e.g., https://)

9. **add_repository**
   - Index a local code repository for documentation
   - Configure include/exclude patterns for files and directories
   - Supports different chunking strategies based on file types
   - Uses asynchronous processing to avoid MCP timeouts with large repositories
   - Provides detailed progress logging (heartbeat) to `stderr` during indexing
   - Required parameter: `path` (absolute path to repository)

10. **list_repositories**
    - List all indexed repositories with their configurations
    - Shows include/exclude patterns and watch status

11. **update_repository**
    - Re-index a repository with updated configuration
    - Can modify include/exclude patterns and other settings
    - Provides detailed progress logging (heartbeat) to `stderr` during re-indexing
    - Required parameter: `name` (repository name)

12. **remove_repository**
    - Remove a repository from the index
    - Deletes all associated documents from the vector database
    - Required parameter: `name` (repository name)

13. **watch_repository**
    - Start or stop watching a repository for changes
    - Automatically updates the index when files change
    - Required parameters: `name` (repository name) and `action` ("start" or "stop")

14. **get_indexing_status**
    - Get the current status of repository indexing operations
    - Provides detailed information about ongoing or completed indexing processes
    - Shows progress percentage, file counts, and timing information
    - Optional parameter: `name` (repository name) - if not provided, returns status for all repositories

## Quick Start

The RAG Documentation tool is designed for:

- Enhancing AI responses with relevant documentation
- Building documentation-aware AI assistants
- Creating context-aware tooling for developers
- Implementing semantic documentation search
- Augmenting existing knowledge bases

## Docker Compose Setup

The project includes a `docker-compose.yml` file for Qdrant and Ollama. Ollama is
pinned to version `0.5.11` to stay compatible with the Node Ollama client used by
the MCP. Both services use persistent named volumes.

Initialize the embedding environment with the helper for your shell:

```bash
./scripts/init-ollama.sh
```

```powershell
./scripts/init-ollama.ps1
```

The scripts start Qdrant and Ollama, wait for both services to become available,
and pull the model selected by `EMBEDDING_MODEL` (default: `nomic-embed-text`).
`OLLAMA_EMBEDDING_MODEL` is accepted as a compatibility fallback. The scripts
target the local Compose Ollama service, so they reject remote `OLLAMA_HOST`
values. They are safe to run again when the model is already present.

To start the services without the helper:

```bash
docker compose up -d
```

This starts Qdrant and Ollama and persists both databases in named volumes. The
one-shot `ollama-model` service downloads the configured embedding model. To use a
different Ollama model, set `EMBEDDING_MODEL` before starting the stack and pass
the same value to the MCP server:

```bash
EMBEDDING_MODEL=all-minilm docker compose up -d
EMBEDDING_MODEL=all-minilm OLLAMA_HOST=http://localhost:11434 QDRANT_URL=http://localhost:6333 npm start
```

When the MCP server runs on the host, set `OLLAMA_HOST` to the published Ollama API:

```text
OLLAMA_HOST=http://localhost:11434
```

If the MCP server is also running in Compose, use `http://ollama:11434` instead.

To stop the services:

```bash
docker-compose down
```

### Recent MCP Changes

- Docker Compose pins Ollama to `0.5.11`, persists its model volume, and initializes
  the configured embedding model after Ollama is healthy.
- Repository handlers now use the MCP SDK notification API for progress updates
  instead of the unavailable `server.sendProgress()` method.
- Progress notifications are sent only when the MCP client supplies a progress
  token; request IDs are not used as substitutes.
- `scripts/init-ollama.sh` and `scripts/init-ollama.ps1` provide repeatable Bash
  and PowerShell setup for the local embedding environment.

## Web Interface

The web interface is started by the MCP Node process; it is not a separate Docker
service. Run the infrastructure first, then start the MCP server through Claude
Desktop or Cline using the configuration above. Once the MCP server is running,
open your browser and navigate to `http://localhost:3030`.

To run the MCP server manually while testing the UI:

```bash
npm run build
OLLAMA_HOST=http://localhost:11434 QDRANT_URL=http://localhost:6333 npm start
```

Leave that process running while using the UI. The MCP server uses stdio for its
client connection, so a normal MCP client such as Claude Desktop or Cline should
launch it in normal use. The web server automatically uses the next available
port if `3030` is occupied.

The interface provides:
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
- `OLLAMA_EMBEDDING_MODEL`: Compatibility fallback for Compose and the setup
  scripts; prefer `EMBEDDING_MODEL` so initialization and runtime use one setting.
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
        "QDRANT_URL": "http://localhost:6333",
        "OLLAMA_HOST": "http://localhost:11434"
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
        "add_documentation",
        "add_repository",
        "list_repositories",
        "update_repository",
        "remove_repository",
        "watch_repository",
        "get_indexing_status"
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
        "QDRANT_URL": "http://localhost:6333",
        "OLLAMA_HOST": "http://localhost:11434"
      },
      "autoApprove": [
        "search_documentation",
        "list_sources",
        "extract_urls",
        "remove_documentation",
        "list_queue",
        "run_queue",
        "clear_queue",
        "add_documentation",
        "add_repository",
        "list_repositories",
        "update_repository",
        "remove_repository",
        "watch_repository",
        "get_indexing_status"
      ]
    }
  }
}
```

### Default Configuration

The system uses Ollama by default for efficient local embedding generation. For optimal reliability:

1. Start Ollama with the Docker Compose setup above
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
- Ollama custom models currently use the same 768-dimension assumption in
  `OllamaProvider`; use a compatible model or update the provider before using a
  model with a different vector size.
- OpenAI (text-embedding-3-small): 1536 dimensions

## Documentation Management

### Direct vs. Queue-Based Documentation Addition

The system provides two complementary approaches for adding documentation:

1. **Direct Addition (`add_documentation` tool)**
   - Immediately processes and indexes the documentation from a URL
   - Best for adding individual documentation sources
   - Provides immediate feedback on processing success/failure
   - Example usage: `add_documentation` with `url: "https://example.com/docs"`

2. **Queue-Based Processing**
   - Add URLs to a processing queue (`extract_urls` with `add_to_queue: true`)
   - Process multiple URLs in batch later (`run_queue`)
   - Better for large-scale documentation ingestion
   - Allows for scheduled processing of many documentation sources
   - Provides resilience through the queue system

Choose the approach that best fits your documentation management needs. For small numbers of important documents, direct addition provides immediate results. For large documentation sets or recursive crawling, the queue-based approach offers better scalability.

### Local Repository Indexing

The system supports indexing local code repositories, making their content searchable alongside web documentation:

1. **Repository Configuration**
   - Define which files to include/exclude using glob patterns
   - Configure chunking strategies per file type
   - Set up automatic change detection with watch mode

2. **File Processing**
   - Files are processed based on their type and language
   - Code is chunked intelligently to preserve context
   - Metadata like file path and language are preserved

3. **Asynchronous Processing**
   - Large repositories are processed asynchronously to avoid MCP timeouts
   - Indexing continues in the background after the initial response
   - Progress can be monitored using the `get_indexing_status` tool
   - Smaller batch sizes (50 chunks per batch) improve responsiveness

4. **Change Detection**
   - Repositories can be watched for changes
   - Modified files are automatically re-indexed
   - Deleted files are removed from the index

Example usage:
```
add_repository with {
  "path": "/path/to/your/repo",
  "name": "my-project",
  "include": ["**/*.js", "**/*.ts", "**/*.md"],
  "exclude": ["**/node_modules/**", "**/dist/**"],
  "watchMode": true
}
```

After starting the indexing process, you can check its status:
```
get_indexing_status with {
  "name": "my-project"
}
```

This will return detailed information about the indexing progress:
```
Repository: my-project
Status: 🔄 Processing
Progress: 45%
Started: 5/11/2025, 2:45:30 PM
Duration: 3m 15s
Files: 120 processed, 15 skipped (of 250)
Chunks: 1500 indexed (of 3300)
Batch: 15 of 33
```

### Repository Configuration File

The system supports a `repositories.json` configuration file that allows you to define repositories to be automatically indexed at startup:

```json
{
  "repositories": [
    {
      "path": "/path/to/your/repo",
```

The configuration file is automatically updated when repositories are added, updated, or removed using the repository management tools. You can also manually edit the file to configure repositories before starting the server. The paths within the configuration file, such as the `path` for each repository and the implicit location of `repositories.json` itself, are resolved relative to the project root directory where the server is executed.

**Configuration Options:**

- `repositories`: Array of repository configurations
  - `path`: Absolute path to the repository directory
      "name": "my-project",
      "include": ["**/*.js", "**/*.ts", "**/*.md"],
      "exclude": ["**/node_modules/**", "**/.git/**"],
      "watchMode": true,
      "watchInterval": 60000,
      "chunkSize": 1000,
      "fileTypeConfig": {
        ".js": { "include": true, "chunkStrategy": "semantic" },
        ".ts": { "include": true, "chunkStrategy": "semantic" },
        ".md": { "include": true, "chunkStrategy": "semantic" }
      }
    }
  ],
  "autoWatch": true
}
```

The configuration file is automatically updated when repositories are added, updated, or removed using the repository management tools. You can also manually edit the file to configure repositories before starting the server.

**Configuration Options:**

- `repositories`: Array of repository configurations
  - `path`: Absolute path to the repository directory
  - `name`: Unique name for the repository
  - `include`: Array of glob patterns to include
  - `exclude`: Array of glob patterns to exclude
  - `watchMode`: Whether to watch for changes
  - `watchInterval`: Polling interval in milliseconds
  - `chunkSize`: Default chunk size for files
  - `fileTypeConfig`: Configuration for specific file types
    - `include`: Whether to include this file type
    - `chunkStrategy`: Chunking strategy ("semantic", "line", or "character")
    - `chunkSize`: Optional override for chunk size

- `autoWatch`: Whether to automatically start watching repositories with `watchMode: true` at startup

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

### Missing Tools in Claude Desktop

If certain tools (like `add_documentation`) are not appearing in Claude Desktop:

1. Verify that the tool is properly registered in the server's `handler-registry.ts` file
2. Make sure the tool is included in the `ListToolsRequestSchema` handler response
3. Check that your Claude Desktop configuration includes the tool in the `autoApprove` array
4. Restart the Claude Desktop application and the MCP server
5. Check the server logs for any errors related to tool registration

The most common cause of missing tools is that they are registered as handlers but not included in the `tools` array returned by the `ListToolsRequestSchema` handler.

### Timeout Issues with Large Repositories

If you encounter timeout errors when indexing large repositories:

1. The system now uses asynchronous processing to avoid MCP timeouts
2. When adding a repository with `add_repository`, the indexing will continue in the background
3. Use the `get_indexing_status` tool to monitor progress
4. If you still experience issues, try these solutions:
   - Reduce the scope of indexing with more specific include/exclude patterns
   - Break up very large repositories into smaller logical units
   - Increase the batch size in the code if your system has more resources available
   - Check system resources (memory, CPU) during indexing to identify bottlenecks
