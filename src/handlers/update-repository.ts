import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler, ProgressState } from './base-handler.js';
import { DocumentChunk, McpToolResponse, RepositoryConfig } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import crypto from 'crypto';
import { detectLanguage } from '../utils/language-detection.js';
import { RepositoryConfigLoader } from '../utils/repository-config-loader.js';

const COLLECTION_NAME = 'documentation';
const REPO_CONFIG_DIR = path.join(process.cwd(), 'repo-configs');

export class UpdateRepositoryHandler extends BaseHandler {
  async handle(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    const progress: ProgressState = { token: callContext?.progressToken, last: -1 };

    if (!args.name || typeof args.name !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Repository name is required');
    }

    const repoName = args.name;
    const configPath = path.join(REPO_CONFIG_DIR, `${repoName}.json`);

    try {
      // Check if the repository config exists
      try {
        await fs.access(configPath);
      } catch {
        throw new McpError(ErrorCode.InvalidParams, `Repository not found: ${repoName}`);
      }

      // Read the config
      const configContent = await fs.readFile(configPath, 'utf-8');
      let config = JSON.parse(configContent) as RepositoryConfig;

      // Update config with any provided parameters
      if (args.include) config.include = args.include;
      if (args.exclude) config.exclude = args.exclude;
      if (args.watchMode !== undefined) config.watchMode = args.watchMode;
      if (args.watchInterval) config.watchInterval = args.watchInterval;
      if (args.chunkSize) config.chunkSize = args.chunkSize;
      if (args.fileTypeConfig) config.fileTypeConfig = { ...config.fileTypeConfig, ...args.fileTypeConfig };

      // Check if the repository path exists
      try {
        const stats = await fs.stat(config.path);
        if (!stats.isDirectory()) {
          throw new McpError(ErrorCode.InvalidParams, `Path is not a directory: ${config.path}`);
        }
      } catch (error) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid repository path: ${config.path}`);
      }

      // Save the updated config
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

      // Update the repositories.json configuration file
      const configLoader = new RepositoryConfigLoader(this.server, this.apiClient);
      await configLoader.addRepositoryToConfig(config);
      console.info(`[${config.name}] Repository configuration updated and saved.`);
      this.sendMonotonicProgress(progress);

      // Process the repository
      console.info(`[${config.name}] Starting to re-process repository files...`);
      const { chunks, processedFiles, skippedFiles } = await this.processRepository(config, progress);
      console.info(`[${config.name}] Finished re-processing repository files. Found ${chunks.length} chunks from ${processedFiles} processed files (${skippedFiles} skipped).`);
      this.sendMonotonicProgress(progress, 25); // 25% for file processing

      // Remove existing repository documents from the vector database
      console.info(`[${config.name}] Removing existing documents from vector database...`);
      await this.apiClient.qdrantClient.delete(COLLECTION_NAME, {
        filter: {
          must: [
            {
              key: 'repository',
              match: { value: repoName }
            },
            {
              key: 'isRepositoryFile',
              match: { value: true }
            }
          ]
        },
        wait: true
      });
      this.sendMonotonicProgress(progress, 50); // 50% after deletion

      // Batch process chunks for better performance
      const batchSize = 100;
      let indexedChunks = 0;
      const totalChunks = chunks.length;

      console.info(`[${config.name}] Starting to generate embeddings and re-index ${totalChunks} chunks...`);
      for (let i = 0; i < totalChunks; i += batchSize) {
        const batchChunks = chunks.slice(i, i + batchSize);

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
              console.error(`[${config.name}] Failed to generate embedding for chunk from ${chunk.filePath || chunk.url} during update: ${embeddingError instanceof Error ? embeddingError.message : String(embeddingError)}`);
              throw embeddingError; // Re-throw to be caught by Promise.allSettled
            }
          })
        );

        const successfulPoints = embeddingResults
          .filter(result => result.status === 'fulfilled')
          .map(result => (result as PromiseFulfilledResult<any>).value);

        const failedEmbeddingsCount = embeddingResults.filter(result => result.status === 'rejected').length;
        if (failedEmbeddingsCount > 0) {
            console.warn(`[${config.name}] Failed to generate embeddings for ${failedEmbeddingsCount} of ${batchChunks.length} chunks in this batch during update.`);
        }

        if (successfulPoints.length > 0) {
          try {
            await this.apiClient.qdrantClient.upsert(COLLECTION_NAME, {
              wait: true,
              points: successfulPoints,
            });
            indexedChunks += successfulPoints.length;
          } catch (upsertError) {
            console.error(`[${config.name}] Failed to upsert batch of ${successfulPoints.length} points to Qdrant during update: ${upsertError instanceof Error ? upsertError.message : String(upsertError)}`);
          }
        }
        
        const percentageComplete = 50 + Math.round(((i + batchChunks.length) / totalChunks) * 50); // Remaining 50% for indexing
        console.info(`[${config.name}] Re-processed batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(totalChunks / batchSize)}. Successfully re-indexed in this batch: ${successfulPoints.length}. Total re-indexed so far: ${indexedChunks} chunks.`);
        this.sendMonotonicProgress(progress, percentageComplete);
      }
      console.info(`[${config.name}] Finished generating embeddings and re-indexing. Total indexed: ${indexedChunks} chunks.`);
      this.sendMonotonicProgress(progress, 100);

      return {
        content: [
          {
            type: 'text',
            text: `Successfully updated repository: ${config.name} (${config.path})\n` +
                  `Processed ${processedFiles} files, skipped ${skippedFiles} files\n` +
                  `Created ${chunks.length} chunks, indexed ${indexedChunks} chunks\n` +
                  `Watch mode: ${config.watchMode ? 'enabled' : 'disabled'}`,
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
            text: `Failed to update repository: ${error}`,
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

    console.info(`[${config.name}] Found ${totalFiles} files to re-process based on include/exclude patterns.`);
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
        if (fileCounter % 50 === 0 && fileCounter > 0) {
          const percentageComplete = Math.round((fileCounter / totalFiles) * 25); // File processing is ~1/4 of the job here
          this.sendMonotonicProgress(progress, percentageComplete);
          console.info(`[${config.name}] Re-processed ${fileCounter} of ${totalFiles} files... (${processedFiles} successful, ${skippedFiles} skipped/errored)`);
        }
      } catch (error) {
        console.error(`[${config.name}] Error processing file ${file}:`, error);
        skippedFiles++;
      }
    }
    console.info(`[${config.name}] Completed file re-iteration. Processed: ${processedFiles}, Skipped/Errored: ${skippedFiles}.`);

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

  private generatePointId(): string {
    return crypto.randomBytes(16).toString('hex');
  }
}
