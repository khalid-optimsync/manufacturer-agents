import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { createTool } from '@mastra/core/tools';
import { promises } from 'fs';
import { join } from 'path';
import fetch$1 from 'node-fetch';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

const forecastSchema = z.object({
  date: z.string(),
  maxTemp: z.number(),
  minTemp: z.number(),
  precipitationChance: z.number(),
  condition: z.string(),
  location: z.string()
});
function getWeatherCondition$1(code) {
  const conditions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    95: "Thunderstorm"
  };
  return conditions[code] || "Unknown";
}
const fetchWeather = createStep({
  id: "fetch-weather",
  description: "Fetches weather forecast for a given city",
  inputSchema: z.object({
    city: z.string().describe("The city to get the weather for")
  }),
  outputSchema: forecastSchema,
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }
    const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(inputData.city)}&count=1`;
    const geocodingResponse = await fetch(geocodingUrl);
    const geocodingData = await geocodingResponse.json();
    if (!geocodingData.results?.[0]) {
      throw new Error(`Location '${inputData.city}' not found`);
    }
    const { latitude, longitude, name } = geocodingData.results[0];
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=precipitation,weathercode&timezone=auto,&hourly=precipitation_probability,temperature_2m`;
    const response = await fetch(weatherUrl);
    const data = await response.json();
    const forecast = {
      date: (/* @__PURE__ */ new Date()).toISOString(),
      maxTemp: Math.max(...data.hourly.temperature_2m),
      minTemp: Math.min(...data.hourly.temperature_2m),
      condition: getWeatherCondition$1(data.current.weathercode),
      precipitationChance: data.hourly.precipitation_probability.reduce(
        (acc, curr) => Math.max(acc, curr),
        0
      ),
      location: name
    };
    return forecast;
  }
});
const planActivities = createStep({
  id: "plan-activities",
  description: "Suggests activities based on weather conditions",
  inputSchema: forecastSchema,
  outputSchema: z.object({
    activities: z.string()
  }),
  execute: async ({ inputData, mastra }) => {
    const forecast = inputData;
    if (!forecast) {
      throw new Error("Forecast data not found");
    }
    const agent = mastra?.getAgent("weatherAgent");
    if (!agent) {
      throw new Error("Weather agent not found");
    }
    const prompt = `Based on the following weather forecast for ${forecast.location}, suggest appropriate activities:
      ${JSON.stringify(forecast, null, 2)}
      For each day in the forecast, structure your response exactly as follows:

      \u{1F4C5} [Day, Month Date, Year]
      \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

      \u{1F321}\uFE0F WEATHER SUMMARY
      \u2022 Conditions: [brief description]
      \u2022 Temperature: [X\xB0C/Y\xB0F to A\xB0C/B\xB0F]
      \u2022 Precipitation: [X% chance]

      \u{1F305} MORNING ACTIVITIES
      Outdoor:
      \u2022 [Activity Name] - [Brief description including specific location/route]
        Best timing: [specific time range]
        Note: [relevant weather consideration]

      \u{1F31E} AFTERNOON ACTIVITIES
      Outdoor:
      \u2022 [Activity Name] - [Brief description including specific location/route]
        Best timing: [specific time range]
        Note: [relevant weather consideration]

      \u{1F3E0} INDOOR ALTERNATIVES
      \u2022 [Activity Name] - [Brief description including specific venue]
        Ideal for: [weather condition that would trigger this alternative]

      \u26A0\uFE0F SPECIAL CONSIDERATIONS
      \u2022 [Any relevant weather warnings, UV index, wind conditions, etc.]

      Guidelines:
      - Suggest 2-3 time-specific outdoor activities per day
      - Include 1-2 indoor backup options
      - For precipitation >50%, lead with indoor activities
      - All activities must be specific to the location
      - Include specific venues, trails, or locations
      - Consider activity intensity based on temperature
      - Keep descriptions concise but informative

      Maintain this exact formatting for consistency, using the emoji and section headers as shown.`;
    const response = await agent.stream([
      {
        role: "user",
        content: prompt
      }
    ]);
    let activitiesText = "";
    for await (const chunk of response.textStream) {
      process.stdout.write(chunk);
      activitiesText += chunk;
    }
    return {
      activities: activitiesText
    };
  }
});
const weatherWorkflow = createWorkflow({
  id: "weather-workflow",
  inputSchema: z.object({
    city: z.string().describe("The city to get the weather for")
  }),
  outputSchema: z.object({
    activities: z.string()
  })
}).then(fetchWeather).then(planActivities);
weatherWorkflow.commit();

const weatherTool = createTool({
  id: "get-weather",
  description: "Get current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("City name")
  }),
  outputSchema: z.object({
    temperature: z.number(),
    feelsLike: z.number(),
    humidity: z.number(),
    windSpeed: z.number(),
    windGust: z.number(),
    conditions: z.string(),
    location: z.string()
  }),
  execute: async ({ context }) => {
    return await getWeather(context.location);
  }
});
const getWeather = async (location) => {
  const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
  const geocodingResponse = await fetch(geocodingUrl);
  const geocodingData = await geocodingResponse.json();
  if (!geocodingData.results?.[0]) {
    throw new Error(`Location '${location}' not found`);
  }
  const { latitude, longitude, name } = geocodingData.results[0];
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code`;
  const response = await fetch(weatherUrl);
  const data = await response.json();
  return {
    temperature: data.current.temperature_2m,
    feelsLike: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    windSpeed: data.current.wind_speed_10m,
    windGust: data.current.wind_gusts_10m,
    conditions: getWeatherCondition(data.current.weather_code),
    location: name
  };
};
function getWeatherCondition(code) {
  const conditions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail"
  };
  return conditions[code] || "Unknown";
}

const weatherAgent = new Agent({
  name: "Weather Agent",
  instructions: `
      You are a helpful weather assistant that provides accurate weather information and can help planning activities based on the weather.

      Your primary function is to help users get weather details for specific locations. When responding:
      - Always ask for a location if none is provided
      - If the location name isn't in English, please translate it
      - If giving a location with multiple parts (e.g. "New York, NY"), use the most relevant part (e.g. "New York")
      - Include relevant details like humidity, wind conditions, and precipitation
      - Keep responses concise but informative
      - If the user asks for activities and provides the weather forecast, suggest activities based on the weather forecast.
      - If the user asks for activities, respond in the format they request.

      Use the weatherTool to fetch current weather data.
`,
  model: "openai/gpt-4o-mini",
  tools: { weatherTool },
  memory: new Memory({
    storage: new LibSQLStore({
      url: "file:../mastra.db"
      // path is relative to the .mastra/output directory
    })
  })
});

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
  const response = await fetch$1(url);
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

const policySyncAgent = new Agent({
  name: "340B Policy Sync Agent",
  instructions: `
    You are a 340B Policy Sync Agent. Your job is to synchronize manufacturer policies by downloading PDFs, extracting eligibility rules, and generating CSV files.

    When a user requests to run the 340B sync (e.g., "run 340b sync", "sync policies", "run sync"), you must call the policySyncTool exactly once.

    The tool will:
    - Download all manufacturer policy PDFs
    - Extract text from each PDF
    - Process the text through an LLM to extract eligibility rules
    - Generate CSV files for each manufacturer
    - Compare with existing CSVs to detect changes
    - Return a summary of what was updated

    After calling the tool, return the JSON result to the user in a clear format.
  `,
  model: "openai/gpt-4o-mini",
  tools: { policySyncTool }
});

const mastra = new Mastra({
  workflows: {
    weatherWorkflow
  },
  agents: {
    weatherAgent,
    policySyncAgent
  },
  storage: new LibSQLStore({
    // stores observability, scores, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:"
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info"
  }),
  telemetry: {
    // Telemetry is deprecated and will be removed in the Nov 4th release
    enabled: false
  },
  observability: {
    // Enables DefaultExporter and CloudExporter for AI tracing
    default: {
      enabled: true
    }
  }
});

export { mastra };
