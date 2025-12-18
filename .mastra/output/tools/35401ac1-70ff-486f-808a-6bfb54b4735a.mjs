import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { promises } from 'fs';
import { join } from 'path';
import fetch from 'node-fetch';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

const MANUFACTURER_POLICIES = {
  abbvie: "https://340besp.com/resources/abbvie/policy.pdf",
  alkermes: "https://340besp.com/resources/alkermes/policy.pdf",
  amgen: "https://340besp.com/resources/amgen/policy.pdf",
  astrazeneca: "https://340besp.com/resources/astrazeneca/policy.pdf",
  biogen: "https://340besp.com/resources/biogen/policy.pdf",
  bristolmyerssquibb: "https://340besp.com/resources/bristolmyerssquibb/policy.pdf",
  elililly: "https://340besp.com/resources/elililly/policy.pdf",
  gilead: "https://340besp.com/resources/gilead/policy.pdf",
  glaxosmithkline: "https://340besp.com/resources/glaxosmithkline/policy.pdf",
  janssen: "https://340besp.com/resources/janssen/policy.pdf",
  merck: "https://340besp.com/resources/merck/policy.pdf",
  novartis: "https://340besp.com/resources/novartis/policy.pdf",
  pfizer: "https://340besp.com/resources/pfizer/policy.pdf",
  regeneron: "https://340besp.com/resources/regeneron/policy.pdf",
  roche: "https://340besp.com/resources/roche/policy.pdf",
  sanofi: "https://340besp.com/resources/sanofi/policy.pdf",
  teva: "https://340besp.com/resources/teva/policy.pdf"
  // Add more manufacturers as needed
};

const SYSTEM_PROMPT = `You are a 340B Manufacturer Policy Parser.

Your job is to read the full text of a single manufacturer's 340B policy and extract all eligibility-related rules and conditions into a detailed structured table.

Create one row per distinct condition, not one per paragraph.
Split multi-condition sentences into separate rule rows.
Never merge "register on 340B ESP" with "submit claims data" \u2014 separate rows.

Output ONLY a markdown table with these columns:

rule_id, entity_type, scope_area, requirement_type, condition_summary, applies_to_drugs, data_requirements, geography_or_location, effective_date, exceptions_or_notes, evidence_excerpt

Do not modify the wording.`;
async function downloadPDF(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download PDF from ${url}: ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
async function extractTextFromPDF(pdfBuffer) {
  const pdfParse = (await import('pdf-parse')).default || await import('pdf-parse');
  const data = await pdfParse(pdfBuffer);
  return data.text;
}
async function callLLM(policyText) {
  const { text } = await generateText({
    model: openai("gpt-4o-mini"),
    system: SYSTEM_PROMPT,
    prompt: `Extract eligibility rules from the following 340B manufacturer policy text:

${policyText}`
  });
  return text;
}
function parseMarkdownTable(markdown) {
  const lines = markdown.split("\n").filter((line) => line.trim());
  const rows = [];
  for (const line of lines) {
    if (line.match(/^\|[\s\-:]+$/)) continue;
    if (line.startsWith("|")) {
      const cells = line.split("|").map((cell) => cell.trim()).filter((cell) => cell.length > 0);
      if (cells.length > 0) {
        rows.push(cells);
      }
    }
  }
  return rows;
}
function rowsToCSV(rows) {
  return rows.map((row) => {
    return row.map((cell) => {
      const escaped = cell.replace(/"/g, '""');
      if (escaped.includes(",") || escaped.includes('"') || escaped.includes("\n")) {
        return `"${escaped}"`;
      }
      return escaped;
    }).join(",");
  }).join("\n");
}
async function ensureOutputDir() {
  const outputDir = join(process.cwd(), "output");
  try {
    await promises.access(outputDir);
  } catch {
    await promises.mkdir(outputDir, { recursive: true });
  }
  return outputDir;
}
async function readExistingCSV(filePath) {
  try {
    return await promises.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}
async function writeCSV(filePath, content) {
  await promises.writeFile(filePath, content, "utf-8");
}
async function writeLastRunStatus(outputDir, status) {
  const statusPath = join(outputDir, "last_run_status.json");
  await promises.writeFile(statusPath, JSON.stringify(status, null, 2), "utf-8");
}
const policySyncTool = createTool({
  id: "policy-sync",
  description: "Sync 340B manufacturer policies by downloading PDFs, extracting eligibility rules, and generating CSV files",
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
      error: z.string().optional()
    }))
  }),
  execute: async () => {
    const outputDir = await ensureOutputDir();
    const details = [];
    let updatedCount = 0;
    let unchangedCount = 0;
    const updatedManufacturers = [];
    for (const [manufacturerKey, pdfUrl] of Object.entries(MANUFACTURER_POLICIES)) {
      const detail = {
        id: manufacturerKey,
        updated: false
      };
      try {
        const pdfBuffer = await downloadPDF(pdfUrl);
        const policyText = await extractTextFromPDF(pdfBuffer);
        const markdownTable = await callLLM(policyText);
        const rows = parseMarkdownTable(markdownTable);
        if (rows.length === 0) {
          detail.error = "No rows extracted from markdown table";
          details.push(detail);
          continue;
        }
        detail.rulesCount = rows.length - 1;
        const csvContent = rowsToCSV(rows);
        const csvPath = join(outputDir, `${manufacturerKey}_340b_rules.csv`);
        const existingCSV = await readExistingCSV(csvPath);
        if (existingCSV === null || existingCSV !== csvContent) {
          await writeCSV(csvPath, csvContent);
          detail.updated = true;
          updatedCount++;
          updatedManufacturers.push(manufacturerKey);
        } else {
          detail.updated = false;
          unchangedCount++;
        }
      } catch (error) {
        detail.error = error instanceof Error ? error.message : String(error);
        unchangedCount++;
      }
      details.push(detail);
    }
    const lastRunStatus = {
      last_run: (/* @__PURE__ */ new Date()).toISOString(),
      updates: updatedManufacturers
    };
    await writeLastRunStatus(outputDir, lastRunStatus);
    const result = {
      totalManufacturers: Object.keys(MANUFACTURER_POLICIES).length,
      updated: updatedCount,
      unchanged: unchangedCount,
      details
    };
    return result;
  }
});

export { policySyncTool };
