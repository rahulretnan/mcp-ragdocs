import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler, ProgressState } from './base-handler.js';
import { DocumentChunk, McpToolResponse, RepositoryConfig, IndexingStatus } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { glob } from 'glob';
import { fileTypeFromFile } from 'file-type';
import { detectLanguage } from '../utils/language-detection.js';
import { RepositoryConfigLoader } from '../utils/repository-config-loader.js';
import { IndexingStatusManager } from '../utils/indexing-status-manager.js';

const COLLECTION_NAME = 'documentation';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_CONFIG_DIR = path.join(__dirname, '..', 'repo-configs');
const DEFAULT_CHUNK_SIZE = 1000;

export class LocalRepositoryHandler extends BaseHandler {
  private statusManager: IndexingStatusManager;
  // Track active indexing processes
  private static activeIndexingProcesses: Map<string, boolean> = new Map();
  // Smaller batch size to reduce processing time per batch
  private static BATCH_SIZE = 50;

  constructor(server: any, apiClient: any) {
    super(server, apiClient);
    this.statusManager = new IndexingStatusManager();
  }

  async handle(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    const progress: ProgressState = { token: callContext?.progressToken, last: -1 };

    // Validate required parameters
    if (!args.path || typeof args.path !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Repository path is required');
    }

    // Normalize the repository path
    const repoPath = path.resolve(args.path);

    // Check if the repository path exists
    try {
      const stats = await fs.stat(repoPath);
      if (!stats.isDirectory()) {
        throw new McpError(ErrorCode.InvalidParams, `Path is not a directory: ${repoPath}`);
      }
    } catch (error) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid repository path: ${repoPath}`);
    }

    // Create repository configuration
    const config: RepositoryConfig = {
      path: repoPath,
      name: args.name || path.basename(repoPath),
      include: args.include || ['**/*'],
      exclude: args.exclude || [
        '**/node_modules/**',
        '**/.git/**',
        '**/build/**',
        '**/dist/**',
        '**/*.min.js',
        '**/*.map',
        '**/package-lock.json',
        '**/yarn.lock'
      ],
      watchMode: args.watchMode || false,
      watchInterval: args.watchInterval || 60000, // Default: 1 minute
      chunkSize: args.chunkSize || DEFAULT_CHUNK_SIZE,
      fileTypeConfig: args.fileTypeConfig || {
        // Default file type configurations
        '.js': { include: true, chunkStrategy: 'semantic' },
        '.ts': { include: true, chunkStrategy: 'semantic' },
        '.jsx': { include: true, chunkStrategy: 'semantic' },
        '.tsx': { include: true, chunkStrategy: 'semantic' },
        '.py': { include: true, chunkStrategy: 'semantic' },
        '.java': { include: true, chunkStrategy: 'semantic' },
        '.md': { include: true, chunkStrategy: 'semantic' },
        '.txt': { include: true, chunkStrategy: 'line' },
        '.json': { include: true, chunkStrategy: 'semantic' },
        '.html': { include: true, chunkStrategy: 'semantic' },
        '.css': { include: true, chunkStrategy: 'semantic' },
        '.scss': { include: true, chunkStrategy: 'semantic' },
        '.xml': { include: true, chunkStrategy: 'semantic' },
        '.yaml': { include: true, chunkStrategy: 'semantic' },
        '.yml': { include: true, chunkStrategy: 'semantic' },
      }
    };

    try {
      // Check if indexing is already in progress for this repository
      if (LocalRepositoryHandler.activeIndexingProcesses.has(config.name)) {
        // Get current status
        const status = await this.statusManager.getStatus(config.name);
        if (status && status.status === 'processing') {
          return {
            content: [
              {
                type: 'text',
                text: `Repository indexing already in progress for ${config.name}.\n` +
                      `Current progress: ${status.percentageComplete || 0}%\n` +
                      `Files processed: ${status.processedFiles || 0} of ${status.totalFiles || 'unknown'}\n` +
                      `Chunks indexed: ${status.indexedChunks || 0} of ${status.totalChunks || 'unknown'}\n` +
                      `Started at: ${new Date(status.startTime).toLocaleString()}`
              },
            ],
          };
        }
      }

      // Save the repository configuration
      await this.saveRepositoryConfig(config);

      // Update the repositories.json configuration file
      const configLoader = new RepositoryConfigLoader(this.server, this.apiClient);
      await configLoader.addRepositoryToConfig(config);
      console.info(`[${config.name}] Repository configuration saved and loaded.`);
      this.sendMonotonicProgress(progress);

      // Create initial status
      await this.statusManager.createStatus(config.name);

      // Start the indexing process asynchronously
      this.processRepositoryAsync(config, progress);

      return {
        content: [
          {
            type: 'text',
            text: `Repository configuration saved for ${config.name} (${repoPath}).\n` +
                  `Indexing has started in the background and will continue after this response.\n` +
                  `You can check the status using the 'get_indexing_status' tool with parameter name="${config.name}".\n` +
                  `Watch mode: ${config.watchMode ? 'enabled' : 'disabled'}`
          },
        ],
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      return {
        content: [
          {
            type: 'text',
            text: `Failed to index repository: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async processRepository(config: RepositoryConfig, progress: ProgressState): Promise<{
    chunks: DocumentChunk[],
    processedFiles: number,
    skippedFiles: number
  }> {
    const chunks: DocumentChunk[] = [];
    let processedFiles = 0;
    let skippedFiles = 0;
    let fileCounter = 0;

    // Get all files matching the include/exclude patterns
    const files = await glob(config.include, {
      cwd: config.path,
      ignore: config.exclude,
      absolute: true,
      nodir: true,
    });
    const totalFiles = files.length;

    console.info(`[${config.name}] Found ${totalFiles} files to process based on include/exclude patterns.`);

    for (const file of files) {
      fileCounter++;
      try {
        const relativePath = path.relative(config.path, file);
        const extension = path.extname(file);
        const fileTypeConfig = config.fileTypeConfig[extension];

        // Skip files that should be excluded based on file type config
        if (fileTypeConfig && fileTypeConfig.include === false) {
          skippedFiles++;
          continue;
        }

        // Read file content
        const content = await fs.readFile(file, 'utf-8');

        // Skip empty files
        if (!content.trim()) {
          skippedFiles++;
          continue;
        }

        // Detect language for better processing
        const language = detectLanguage(file, content);

        // Process the file content into chunks
        const fileChunks = this.chunkFileContent(
          content,
          file,
          relativePath,
          config,
          language,
          fileTypeConfig?.chunkStrategy || 'line'
        );

        chunks.push(...fileChunks);
        processedFiles++;
      } catch (error) {
        console.error(`[${config.name}] Error processing file ${file}: ${error instanceof Error ? error.message : String(error)}`);
        skippedFiles++;
      } finally {
        if (fileCounter % 50 === 0) {
          const percentageComplete = Math.round((fileCounter / totalFiles) * 33); // File processing is ~1/3 of the job
          this.sendMonotonicProgress(progress, percentageComplete);
          console.info(`[${config.name}] Processed ${fileCounter} of ${totalFiles} files... (${processedFiles} successful, ${skippedFiles} skipped/errored)`);
        }
      }
    }
    console.info(`[${config.name}] Completed file iteration. Processed: ${processedFiles}, Skipped/Errored: ${skippedFiles}.`);

    return { chunks, processedFiles, skippedFiles };
  }

  private chunkFileContent(
    content: string,
    filePath: string,
    relativePath: string,
    config: RepositoryConfig,
    language: string,
    chunkStrategy: string
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const timestamp = new Date().toISOString();
    const fileUrl = `file://${filePath}`;
    const title = `${config.name}/${relativePath}`;

    // Different chunking strategies based on file type
    let textChunks: string[] = [];

    switch (chunkStrategy) {
      case 'semantic':
        // For semantic chunking, we'd ideally use a more sophisticated approach
        // For now, we'll use a simple paragraph-based approach
        textChunks = this.chunkByParagraphs(content, config.chunkSize);
        break;
      case 'line':
        // Chunk by lines, respecting max chunk size
        textChunks = this.chunkByLines(content, config.chunkSize);
        break;
      default:
        // Default to simple text chunking
        textChunks = this.chunkText(content, config.chunkSize);
    }

    // Create document chunks with metadata
    chunks.push(...textChunks.map((text, index) => ({
      text,
      url: fileUrl,
      title,
      timestamp,
      filePath: relativePath,
      language,
      chunkIndex: index,
      totalChunks: textChunks.length,
    })));

    return chunks;
  }

  private chunkText(text: string, maxChunkSize: number): string[] {
    const words = text.split(/\s+/);
    const chunks: string[] = [];
    let currentChunk: string[] = [];

    for (const word of words) {
      currentChunk.push(word);
      const currentLength = currentChunk.join(' ').length;

      if (currentLength >= maxChunkSize) {
        chunks.push(currentChunk.join(' '));
        currentChunk = [];
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
    }

    return chunks;
  }

  private chunkByLines(text: string, maxChunkSize: number): string[] {
    const lines = text.split(/\r?\n/);
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentLength = 0;

    for (const line of lines) {
      const lineLength = line.length + 1; // +1 for the newline

      if (currentLength + lineLength > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [];
        currentLength = 0;
      }

      currentChunk.push(line);
      currentLength += lineLength;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
    }

    return chunks;
  }

  private chunkByParagraphs(text: string, maxChunkSize: number): string[] {
    // Split by double newlines (paragraphs)
    const paragraphs = text.split(/\r?\n\r?\n/);
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentLength = 0;

    for (const paragraph of paragraphs) {
      const paragraphLength = paragraph.length + 2; // +2 for the double newline

      if (currentLength + paragraphLength > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n\n'));
        currentChunk = [];
        currentLength = 0;
      }

      currentChunk.push(paragraph);
      currentLength += paragraphLength;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n'));
    }

    return chunks;
  }

  private async saveRepositoryConfig(config: RepositoryConfig): Promise<void> {
    // Ensure the config directory exists
    try {
      await fs.mkdir(REPO_CONFIG_DIR, { recursive: true });
    } catch (error) {
      console.error('Error creating repository config directory:', error);
      throw new McpError(ErrorCode.InternalError, 'Failed to create repository config directory');
    }

    // Save the config file
    const configPath = path.join(REPO_CONFIG_DIR, `${config.name}.json`);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  private generatePointId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Process repository asynchronously to avoid MCP timeout
   */
  private async processRepositoryAsync(config: RepositoryConfig, progress: ProgressState): Promise<void> {
    try {
      // Mark this repository as being processed
      LocalRepositoryHandler.activeIndexingProcesses.set(config.name, true);

      // Update status to processing
      await this.statusManager.updateStatus({
        repositoryName: config.name,
        status: 'processing'
      });

      console.info(`[${config.name}] Starting to process repository files asynchronously...`);

      // Process the repository files
      const { chunks, processedFiles, skippedFiles } = await this.processRepository(config, progress);

      // Update status with file processing results
      await this.statusManager.updateStatus({
        repositoryName: config.name,
        totalFiles: processedFiles + skippedFiles,
        processedFiles,
        skippedFiles,
        totalChunks: chunks.length,
        percentageComplete: 33
      });

      console.info(`[${config.name}] Finished processing repository files. Found ${chunks.length} chunks from ${processedFiles} files (${skippedFiles} skipped).`);

      // Batch process chunks with smaller batch size for better responsiveness
      const batchSize = LocalRepositoryHandler.BATCH_SIZE;
      let indexedChunks = 0;
      const totalChunks = chunks.length;
      const totalBatches = Math.ceil(totalChunks / batchSize);

      console.info(`[${config.name}] Starting to generate embeddings and index ${totalChunks} chunks in ${totalBatches} batches...`);

      const COLLECTION_NAME = 'documentation';

      for (let i = 0; i < totalChunks; i += batchSize) {
        const batchChunks = chunks.slice(i, i + batchSize);
        const currentBatch = Math.floor(i / batchSize) + 1;

        // Update status before processing batch
        await this.statusManager.updateStatus({
          repositoryName: config.name,
          currentBatch,
          totalBatches,
          indexedChunks,
          percentageComplete: 33 + Math.round((i / totalChunks) * 66)
        });

        console.info(`[${config.name}] Processing batch ${currentBatch} of ${totalBatches}...`);

        try {
          const embeddingResults = await Promise.allSettled(
            batchChunks.map(async (chunk) => {
              try {
                const embedding = await this.apiClient.getEmbeddings(chunk.text);
                return {
                  id: this.generatePointId(),
                  vector: embedding,
                  payload: {
                    ...chunk,
                    _type: 'DocumentChunk' as const,
                    repository: config.name,
                    isRepositoryFile: true,
                  } as Record<string, unknown>,
                };
              } catch (embeddingError) {
                console.error(`[${config.name}] Failed to generate embedding for chunk from ${chunk.filePath || chunk.url}: ${embeddingError instanceof Error ? embeddingError.message : String(embeddingError)}`);
                throw embeddingError; // Re-throw to be caught by Promise.allSettled
              }
            })
          );

          const successfulPoints = embeddingResults
            .filter(result => result.status === 'fulfilled')
            .map(result => (result as PromiseFulfilledResult<any>).value);

          const failedEmbeddingsCount = embeddingResults.filter(result => result.status === 'rejected').length;
          if (failedEmbeddingsCount > 0) {
            console.warn(`[${config.name}] Failed to generate embeddings for ${failedEmbeddingsCount} of ${batchChunks.length} chunks in batch ${currentBatch}.`);
          }

          if (successfulPoints.length > 0) {
            try {
              await this.apiClient.qdrantClient.upsert(COLLECTION_NAME, {
                wait: true,
                points: successfulPoints,
              });
              indexedChunks += successfulPoints.length;
            } catch (upsertError) {
              console.error(`[${config.name}] Failed to upsert batch ${currentBatch} of ${successfulPoints.length} points to Qdrant: ${upsertError instanceof Error ? upsertError.message : String(upsertError)}`);
            }
          }

          const percentageComplete = 33 + Math.round(((i + batchChunks.length) / totalChunks) * 66);
          this.sendMonotonicProgress(progress, percentageComplete);
          console.info(`[${config.name}] Processed batch ${currentBatch} of ${totalBatches}. Successfully indexed in this batch: ${successfulPoints.length}. Total indexed so far: ${indexedChunks} chunks.`);

          // Update status after processing batch
          await this.statusManager.updateStatus({
            repositoryName: config.name,
            currentBatch,
            totalBatches,
            indexedChunks,
            percentageComplete
          });
        } catch (batchError) {
          console.error(`[${config.name}] Error processing batch ${currentBatch}:`, batchError);
          // Continue with next batch despite errors
        }
      }

      // Mark indexing as completed
      console.info(`[${config.name}] Finished generating embeddings and indexing. Total indexed: ${indexedChunks} of ${totalChunks} chunks.`);

      await this.statusManager.completeStatus(config.name, true, {
        processedFiles,
        skippedFiles,
        totalChunks,
        indexedChunks
      });
      this.sendMonotonicProgress(progress, 100);

      // If watch mode is enabled, start the watcher
      if (config.watchMode) {
        // This would be implemented in a separate class
        // this.startRepositoryWatcher(config);
      }
    } catch (error) {
      console.error(`[${config.name}] Error during async repository processing:`, error);

      // Update status to failed
      await this.statusManager.completeStatus(
        config.name,
        false,
        undefined,
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      // Remove from active processes
      LocalRepositoryHandler.activeIndexingProcesses.delete(config.name);
    }
  }
}
