import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { promises as fs } from 'fs';
import { join } from 'path';
import fetch from 'node-fetch';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { MANUFACTURER_POLICIES } from '../manufacturer-policies';

const SYSTEM_PROMPT = `You are a 340B Manufacturer Policy Parser.

Your job is to read the full text of a single manufacturer's 340B policy and extract all eligibility-related rules and conditions into a detailed structured table.

Create one row per distinct condition, not one per paragraph.
Split multi-condition sentences into separate rule rows.
Never merge "register on 340B ESP" with "submit claims data" — separate rows.

Output ONLY a markdown table with these columns:

rule_id, entity_type, scope_area, requirement_type, condition_summary, applies_to_drugs, data_requirements, geography_or_location, effective_date, exceptions_or_notes, evidence_excerpt

Do not modify the wording.`;

interface ManufacturerDetail {
  id: string;
  updated: boolean;
  name?: string;
  rulesCount?: number;
  error?: string;
}

interface SyncResult {
  totalManufacturers: number;
  updated: number;
  unchanged: number;
  details: ManufacturerDetail[];
}

interface LastRunStatus {
  last_run: string;
  updates: string[];
}

async function downloadPDF(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download PDF from ${url}: ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function extractTextFromPDF(pdfBuffer: Buffer): Promise<string> {
  // Dynamic import for pdf-parse to handle CommonJS in ESM context
  const pdfParse = (await import('pdf-parse')).default || await import('pdf-parse');
  const data = await pdfParse(pdfBuffer);
  return data.text;
}

async function callLLM(policyText: string): Promise<string> {
  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    system: SYSTEM_PROMPT,
    prompt: `Extract eligibility rules from the following 340B manufacturer policy text:\n\n${policyText}`,
  });
  return text;
}

function parseMarkdownTable(markdown: string): string[][] {
  const lines = markdown.split('\n').filter(line => line.trim());
  const rows: string[][] = [];
  
  for (const line of lines) {
    // Skip markdown table separators (e.g., |---|---|)
    if (line.match(/^\|[\s\-:]+$/)) continue;
    
    // Parse table rows
    if (line.startsWith('|')) {
      const cells = line
        .split('|')
        .map(cell => cell.trim())
        .filter(cell => cell.length > 0);
      
      if (cells.length > 0) {
        rows.push(cells);
      }
    }
  }
  
  return rows;
}

function rowsToCSV(rows: string[][]): string {
  return rows.map(row => {
    return row.map(cell => {
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      const escaped = cell.replace(/"/g, '""');
      if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')) {
        return `"${escaped}"`;
      }
      return escaped;
    }).join(',');
  }).join('\n');
}

async function ensureOutputDir(): Promise<string> {
  const outputDir = join(process.cwd(), 'output');
  try {
    await fs.access(outputDir);
  } catch {
    await fs.mkdir(outputDir, { recursive: true });
  }
  return outputDir;
}

async function readExistingCSV(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function writeCSV(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, 'utf-8');
}

async function writeLastRunStatus(outputDir: string, status: LastRunStatus): Promise<void> {
  const statusPath = join(outputDir, 'last_run_status.json');
  await fs.writeFile(statusPath, JSON.stringify(status, null, 2), 'utf-8');
}

export const policySyncTool = createTool({
  id: 'policy-sync',
  description: 'Sync 340B manufacturer policies by downloading PDFs, extracting eligibility rules, and generating CSV files',
  inputSchema: z.object({}),
  outputSchema: z.object({
    totalManufacturers: z.number(),
    updated: z.number(),
    unchanged: z.number(),
    details: z.array(z.object({
      id: z.string(),
      updated: z.boolean(),
      name: z.string().optional(),
      rulesCount: z.number().optional(),
      error: z.string().optional(),
    })),
  }),
  execute: async () => {
    const outputDir = await ensureOutputDir();
    const details: ManufacturerDetail[] = [];
    let updatedCount = 0;
    let unchangedCount = 0;
    const updatedManufacturers: string[] = [];

    for (const [manufacturerKey, pdfUrl] of Object.entries(MANUFACTURER_POLICIES)) {
      const detail: ManufacturerDetail = {
        id: manufacturerKey,
        updated: false,
      };

      try {
        // Download PDF
        const pdfBuffer = await downloadPDF(pdfUrl);
        
        // Extract text
        const policyText = await extractTextFromPDF(pdfBuffer);
        
        // Call LLM
        const markdownTable = await callLLM(policyText);
        
        // Parse markdown table
        const rows = parseMarkdownTable(markdownTable);
        
        if (rows.length === 0) {
          detail.error = 'No rows extracted from markdown table';
          details.push(detail);
          continue;
        }

        detail.rulesCount = rows.length - 1; // Subtract header row
        
        // Convert to CSV
        const csvContent = rowsToCSV(rows);
        
        // Check if file exists and compare
        const csvPath = join(outputDir, `${manufacturerKey}_340b_rules.csv`);
        const existingCSV = await readExistingCSV(csvPath);
        
        if (existingCSV === null || existingCSV !== csvContent) {
          // File doesn't exist or content is different
          await writeCSV(csvPath, csvContent);
          detail.updated = true;
          updatedCount++;
          updatedManufacturers.push(manufacturerKey);
        } else {
          // Content is identical
          detail.updated = false;
          unchangedCount++;
        }
      } catch (error) {
        detail.error = error instanceof Error ? error.message : String(error);
        unchangedCount++; // Count errors as unchanged
      }

      details.push(detail);
    }

    // Write last run status
    const lastRunStatus: LastRunStatus = {
      last_run: new Date().toISOString(),
      updates: updatedManufacturers,
    };
    await writeLastRunStatus(outputDir, lastRunStatus);

    const result: SyncResult = {
      totalManufacturers: Object.keys(MANUFACTURER_POLICIES).length,
      updated: updatedCount,
      unchanged: unchangedCount,
      details,
    };

    return result;
  },
});

