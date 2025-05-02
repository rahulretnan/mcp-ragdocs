//evals.ts

import { EvalConfig } from 'mcp-evals';
import { openai } from "@ai-sdk/openai";
import { grade, EvalFunction } from "mcp-evals";

const search_documentationEval: EvalFunction = {
    name: 'search_documentationEval',
    description: 'Evaluates search_documentation tool functionality',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Find references about Node.js debugging in the stored documentation and provide any relevant code examples.");
        return JSON.parse(result);
    }
};

const list_sourcesEval: EvalFunction = {
    name: 'List Sources Tool Evaluation',
    description: 'Evaluates the functionality of the list_sources tool',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please list all documentation sources currently stored in the system, including source URLs, titles, and last update times.");
        return JSON.parse(result);
    }
};

const extract_urlsEval: EvalFunction = {
    name: 'Extract URLs Tool Evaluation',
    description: 'Evaluates extracting and analyzing URLs from a webpage using the extract_urls tool',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please extract all URLs from the publicly accessible webpage https://example.com, validate them, and add them to the queue for further processing. Provide the list of extracted links and confirm their addition to the queue.");
        return JSON.parse(result);
    }
};

const remove_documentationEval: EvalFunction = {
    name: 'remove_documentationEval',
    description: 'Evaluates the removal of specific documentation sources by their URLs',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Remove these documentation sources permanently from the system: https://docs.example.com/api and https://docs.example.com/old-version");
        return JSON.parse(result);
    }
};

const list_queueEval: EvalFunction = {
    name: 'list_queue Tool Evaluation',
    description: 'Evaluates the listing of the current queue of pending documentation URLs',
    run: async () => {
        const result = await grade(openai("gpt-4"), "List all URLs waiting in the documentation processing queue.");
        return JSON.parse(result);
    }
};

const config: EvalConfig = {
    model: openai("gpt-4"),
    evals: [search_documentationEval, list_sourcesEval, extract_urlsEval, remove_documentationEval, list_queueEval]
};
  
export default config;
  
export const evals = [search_documentationEval, list_sourcesEval, extract_urlsEval, remove_documentationEval, list_queueEval];