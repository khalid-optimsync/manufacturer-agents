import { PROVIDER_REGISTRY, GatewayRegistry } from './chunk-PHSTPDWR.js';
import { ModelsDevGateway, parseModelRouterId } from './chunk-R6XC4DV5.js';
import { NetlifyGateway } from './chunk-HSX2K7HB.js';
import { RuntimeContext } from './chunk-HLRWYUFN.js';
import { MastraError } from './chunk-PZUZNPFM.js';
import { createHash, randomUUID } from 'crypto';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible-v5';
import { createGoogleGenerativeAI } from '@ai-sdk/google-v5';
import { createOpenAI } from '@ai-sdk/openai-v5';

// src/llm/model/gateways/index.ts
function findGatewayForModel(gatewayId, gateways) {
  const prefixedGateway = gateways.find(
    (g) => g.id !== "models.dev" && (g.id === gatewayId || gatewayId.startsWith(`${g.id}/`))
  );
  if (prefixedGateway) {
    return prefixedGateway;
  }
  const modelsDevGateway = gateways.find((g) => g.id === "models.dev");
  if (modelsDevGateway) {
    return modelsDevGateway;
  }
  throw new MastraError({
    id: "MODEL_ROUTER_NO_GATEWAY_FOUND",
    category: "USER",
    domain: "MODEL_ROUTER",
    text: `No Mastra model router gateway found for model id ${gatewayId}`
  });
}
var AISDKV5LanguageModel = class {
  /**
   * The language model must specify which language model interface version it implements.
   */
  specificationVersion = "v2";
  /**
   * Name of the provider for logging purposes.
   */
  provider;
  /**
   * Provider-specific model ID for logging purposes.
   */
  modelId;
  /**
   * Supported URL patterns by media type for the provider.
   *
   * The keys are media type patterns or full media types (e.g. `*\/*` for everything, `audio/*`, `video/*`, or `application/pdf`).
   * and the values are arrays of regular expressions that match the URL paths.
   * The matching should be against lower-case URLs.
   * Matched URLs are supported natively by the model and are not downloaded.
   * @returns A map of supported URL patterns by media type (as a promise or a plain object).
   */
  supportedUrls;
  #model;
  constructor(config) {
    this.#model = config;
    this.provider = this.#model.provider;
    this.modelId = this.#model.modelId;
    this.supportedUrls = this.#model.supportedUrls;
  }
  async doGenerate(options) {
    const result = await this.#model.doGenerate(options);
    return {
      request: result.request,
      response: result.response,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: result.warnings });
          controller.enqueue({
            type: "response-metadata",
            id: result.response?.id,
            modelId: result.response?.modelId,
            timestamp: result.response?.timestamp
          });
          for (const message of result.content) {
            if (message.type === "tool-call") {
              const toolCall = message;
              controller.enqueue({
                type: "tool-input-start",
                id: toolCall.toolCallId,
                toolName: toolCall.toolName
              });
              controller.enqueue({
                type: "tool-input-delta",
                id: toolCall.toolCallId,
                delta: toolCall.input
              });
              controller.enqueue({
                type: "tool-input-end",
                id: toolCall.toolCallId
              });
              controller.enqueue(toolCall);
            } else if (message.type === "tool-result") {
              const toolResult = message;
              controller.enqueue(toolResult);
            } else if (message.type === "text") {
              const text = message;
              const id = `msg_${randomUUID()}`;
              controller.enqueue({
                type: "text-start",
                id,
                providerMetadata: text.providerMetadata
              });
              controller.enqueue({
                type: "text-delta",
                id,
                delta: text.text
              });
              controller.enqueue({
                type: "text-end",
                id
              });
            } else if (message.type === "reasoning") {
              const id = `reasoning_${randomUUID()}`;
              const reasoning = message;
              controller.enqueue({
                type: "reasoning-start",
                id,
                providerMetadata: reasoning.providerMetadata
              });
              controller.enqueue({
                type: "reasoning-delta",
                id,
                delta: reasoning.text,
                providerMetadata: reasoning.providerMetadata
              });
              controller.enqueue({
                type: "reasoning-end",
                id,
                providerMetadata: reasoning.providerMetadata
              });
            } else if (message.type === "file") {
              const file = message;
              controller.enqueue({
                type: "file",
                mediaType: file.mediaType,
                data: file.data
              });
            } else if (message.type === "source") {
              const source = message;
              if (source.sourceType === "url") {
                controller.enqueue({
                  type: "source",
                  id: source.id,
                  sourceType: "url",
                  url: source.url,
                  title: source.title,
                  providerMetadata: source.providerMetadata
                });
              } else {
                controller.enqueue({
                  type: "source",
                  id: source.id,
                  sourceType: "document",
                  mediaType: source.mediaType,
                  filename: source.filename,
                  title: source.title,
                  providerMetadata: source.providerMetadata
                });
              }
            }
          }
          controller.enqueue({
            type: "finish",
            finishReason: result.finishReason,
            usage: result.usage,
            providerMetadata: result.providerMetadata
          });
          controller.close();
        }
      })
    };
  }
  async doStream(options) {
    return await this.#model.doStream(options);
  }
};

// src/llm/model/router.ts
function getStaticProvidersByGateway(name) {
  return Object.fromEntries(Object.entries(PROVIDER_REGISTRY).filter(([_provider, config]) => config.gateway === name));
}
var defaultGateways = [new NetlifyGateway(), new ModelsDevGateway(getStaticProvidersByGateway(`models.dev`))];
var ModelRouterLanguageModel = class _ModelRouterLanguageModel {
  specificationVersion = "v2";
  defaultObjectGenerationMode = "json";
  supportsStructuredOutputs = true;
  supportsImageUrls = true;
  supportedUrls = {};
  modelId;
  provider;
  config;
  gateway;
  constructor(config, customGateways) {
    let normalizedConfig;
    if (typeof config === "string") {
      normalizedConfig = { id: config };
    } else if ("providerId" in config && "modelId" in config) {
      normalizedConfig = {
        id: `${config.providerId}/${config.modelId}`,
        url: config.url,
        apiKey: config.apiKey,
        headers: config.headers
      };
    } else {
      normalizedConfig = {
        id: config.id,
        url: config.url,
        apiKey: config.apiKey,
        headers: config.headers
      };
    }
    const parsedConfig = {
      ...normalizedConfig,
      routerId: normalizedConfig.id
    };
    this.gateway = findGatewayForModel(normalizedConfig.id, [...customGateways || [], ...defaultGateways]);
    const gatewayPrefix = this.gateway.id === "models.dev" ? void 0 : this.gateway.id;
    const parsed = parseModelRouterId(normalizedConfig.id, gatewayPrefix);
    this.provider = parsed.providerId || "openai-compatible";
    if (parsed.providerId && parsed.modelId !== normalizedConfig.id) {
      parsedConfig.id = parsed.modelId;
    }
    this.modelId = parsedConfig.id;
    this.config = parsedConfig;
  }
  async doGenerate(options) {
    let apiKey;
    try {
      if (this.config.url) {
        apiKey = this.config.apiKey || "";
      } else {
        apiKey = this.config.apiKey || await this.gateway.getApiKey(this.config.routerId);
      }
    } catch (error) {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "error",
              error
            });
            controller.close();
          }
        })
      };
    }
    const gatewayPrefix = this.gateway.id === "models.dev" ? void 0 : this.gateway.id;
    const model = await this.resolveLanguageModel({
      apiKey,
      headers: this.config.headers,
      ...parseModelRouterId(this.config.routerId, gatewayPrefix)
    });
    const aiSDKV5Model = new AISDKV5LanguageModel(model);
    return aiSDKV5Model.doGenerate(options);
  }
  async doStream(options) {
    let apiKey;
    try {
      if (this.config.url) {
        apiKey = this.config.apiKey || "";
      } else {
        apiKey = this.config.apiKey || await this.gateway.getApiKey(this.config.routerId);
      }
    } catch (error) {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "error",
              error
            });
            controller.close();
          }
        })
      };
    }
    const gatewayPrefix = this.gateway.id === "models.dev" ? void 0 : this.gateway.id;
    const model = await this.resolveLanguageModel({
      apiKey,
      headers: this.config.headers,
      ...parseModelRouterId(this.config.routerId, gatewayPrefix)
    });
    const aiSDKV5Model = new AISDKV5LanguageModel(model);
    return aiSDKV5Model.doStream(options);
  }
  async resolveLanguageModel({
    modelId,
    providerId,
    apiKey,
    headers
  }) {
    const key = createHash("sha256").update(
      this.gateway.id + modelId + providerId + apiKey + (this.config.url || "") + (headers ? JSON.stringify(headers) : "")
    ).digest("hex");
    if (_ModelRouterLanguageModel.modelInstances.has(key)) return _ModelRouterLanguageModel.modelInstances.get(key);
    if (this.config.url) {
      const modelInstance2 = createOpenAICompatible({
        name: providerId,
        apiKey,
        baseURL: this.config.url,
        headers: this.config.headers,
        supportsStructuredOutputs: true
      }).chatModel(modelId);
      _ModelRouterLanguageModel.modelInstances.set(key, modelInstance2);
      return modelInstance2;
    }
    const modelInstance = await this.gateway.resolveLanguageModel({ modelId, providerId, apiKey, headers });
    _ModelRouterLanguageModel.modelInstances.set(key, modelInstance);
    return modelInstance;
  }
  static modelInstances = /* @__PURE__ */ new Map();
};

// src/llm/model/resolve-model.ts
function isOpenAICompatibleObjectConfig(modelConfig) {
  if (typeof modelConfig === "object" && "specificationVersion" in modelConfig) return false;
  if (typeof modelConfig === "object" && !("model" in modelConfig)) {
    if ("id" in modelConfig) return true;
    if ("providerId" in modelConfig && "modelId" in modelConfig) return true;
  }
  return false;
}
async function resolveModelConfig(modelConfig, runtimeContext = new RuntimeContext(), mastra) {
  if (typeof modelConfig === "function") {
    modelConfig = await modelConfig({ runtimeContext, mastra });
  }
  if (modelConfig instanceof ModelRouterLanguageModel || modelConfig instanceof AISDKV5LanguageModel) {
    return modelConfig;
  }
  if (typeof modelConfig === "object" && "specificationVersion" in modelConfig) {
    if (modelConfig.specificationVersion === "v2") {
      return new AISDKV5LanguageModel(modelConfig);
    }
    return modelConfig;
  }
  const gatewayRecord = mastra?.listGateways();
  const customGateways = gatewayRecord ? Object.values(gatewayRecord) : void 0;
  if (typeof modelConfig === "string" || isOpenAICompatibleObjectConfig(modelConfig)) {
    return new ModelRouterLanguageModel(modelConfig, customGateways);
  }
  throw new Error("Invalid model configuration provided");
}
var ModelRouterEmbeddingModel = class {
  specificationVersion = "v2";
  modelId;
  provider;
  maxEmbeddingsPerCall = 2048;
  supportsParallelCalls = true;
  providerModel;
  constructor(config) {
    let normalizedConfig;
    if (typeof config === "string") {
      const parts = config.split("/");
      if (parts.length !== 2) {
        throw new Error(`Invalid model string format: "${config}". Expected format: "provider/model"`);
      }
      const [providerId, modelId] = parts;
      normalizedConfig = { providerId, modelId };
    } else if ("providerId" in config && "modelId" in config) {
      normalizedConfig = {
        providerId: config.providerId,
        modelId: config.modelId,
        url: config.url,
        apiKey: config.apiKey,
        headers: config.headers
      };
    } else {
      const parts = config.id.split("/");
      if (parts.length !== 2) {
        throw new Error(`Invalid model string format: "${config.id}". Expected format: "provider/model"`);
      }
      const [providerId, modelId] = parts;
      normalizedConfig = {
        providerId,
        modelId,
        url: config.url,
        apiKey: config.apiKey,
        headers: config.headers
      };
    }
    this.provider = normalizedConfig.providerId;
    this.modelId = normalizedConfig.modelId;
    if (normalizedConfig.url) {
      const apiKey = normalizedConfig.apiKey || "";
      this.providerModel = createOpenAICompatible({
        name: normalizedConfig.providerId,
        apiKey,
        baseURL: normalizedConfig.url,
        headers: normalizedConfig.headers
      }).textEmbeddingModel(normalizedConfig.modelId);
    } else {
      const registry = GatewayRegistry.getInstance();
      const providerConfig = registry.getProviderConfig(normalizedConfig.providerId);
      if (!providerConfig) {
        throw new Error(`Unknown provider: ${normalizedConfig.providerId}`);
      }
      let apiKey = normalizedConfig.apiKey;
      if (!apiKey) {
        const apiKeyEnvVar = providerConfig.apiKeyEnvVar;
        if (Array.isArray(apiKeyEnvVar)) {
          for (const envVar of apiKeyEnvVar) {
            apiKey = process.env[envVar];
            if (apiKey) break;
          }
        } else {
          apiKey = process.env[apiKeyEnvVar];
        }
      }
      if (!apiKey) {
        const envVarDisplay = Array.isArray(providerConfig.apiKeyEnvVar) ? providerConfig.apiKeyEnvVar.join(" or ") : providerConfig.apiKeyEnvVar;
        throw new Error(`API key not found for provider ${normalizedConfig.providerId}. Set ${envVarDisplay}`);
      }
      if (normalizedConfig.providerId === "openai") {
        this.providerModel = createOpenAI({ apiKey }).textEmbeddingModel(
          normalizedConfig.modelId
        );
      } else if (normalizedConfig.providerId === "google") {
        this.providerModel = createGoogleGenerativeAI({ apiKey }).textEmbedding(
          normalizedConfig.modelId
        );
      } else {
        if (!providerConfig.url) {
          throw new Error(`Provider ${normalizedConfig.providerId} does not have a URL configured`);
        }
        this.providerModel = createOpenAICompatible({
          name: normalizedConfig.providerId,
          apiKey,
          baseURL: providerConfig.url
        }).textEmbeddingModel(normalizedConfig.modelId);
      }
    }
    if (this.providerModel.maxEmbeddingsPerCall !== void 0) {
      this.maxEmbeddingsPerCall = this.providerModel.maxEmbeddingsPerCall;
    }
    if (this.providerModel.supportsParallelCalls !== void 0) {
      this.supportsParallelCalls = this.providerModel.supportsParallelCalls;
    }
  }
  async doEmbed(args) {
    return this.providerModel.doEmbed(args);
  }
};

export { ModelRouterEmbeddingModel, ModelRouterLanguageModel, resolveModelConfig };
//# sourceMappingURL=chunk-72F4RGK7.js.map
//# sourceMappingURL=chunk-72F4RGK7.js.map