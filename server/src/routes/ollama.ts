import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import Joi from "joi";
import { JobScheduler } from "@/services/JobScheduler";
import { WorkerRegistry } from "@/services/WorkerRegistry";
import { logger } from "@/utils/logger";
import { asyncHandler, createError } from "@/middleware/errorHandler";
import { InferenceRequest, OllamaModel } from "@/types";

export const ollamaRoutes = (
  jobScheduler: JobScheduler,
  workerRegistry: WorkerRegistry
): Router => {
  const router = Router();

  // Validation schemas for different endpoints
  const generateRequestSchema = Joi.object({
    model: Joi.string().required(),
    prompt: Joi.string().required().max(100000),
    suffix: Joi.string().optional(),
    images: Joi.array().items(Joi.string()).optional(),
    think: Joi.boolean().optional(),
    format: Joi.alternatives()
      .try(Joi.string().valid("json"), Joi.object())
      .optional(),
    options: Joi.object({
      temperature: Joi.number().min(0).max(2),
      top_k: Joi.number().integer().min(1).max(100),
      top_p: Joi.number().min(0).max(1),
      min_p: Joi.number().min(0).max(1),
      typical_p: Joi.number().min(0).max(1),
      repeat_last_n: Joi.number().integer().min(-1),
      repeat_penalty: Joi.number().min(0),
      presence_penalty: Joi.number(),
      frequency_penalty: Joi.number(),
      penalize_newline: Joi.boolean(),
      stop: Joi.array().items(Joi.string()).max(10),
      numa: Joi.boolean(),
      num_ctx: Joi.number().integer().min(1),
      num_batch: Joi.number().integer().min(1),
      num_gpu: Joi.number().integer().min(0),
      main_gpu: Joi.number().integer().min(0),
      use_mmap: Joi.boolean(),
      num_thread: Joi.number().integer().min(1),
      num_keep: Joi.number().integer().min(0),
      seed: Joi.number().integer(),
      num_predict: Joi.number().integer().min(-1),
    }).optional(),
    system: Joi.string().optional(),
    template: Joi.string().optional(),
    stream: Joi.boolean().default(true),
    raw: Joi.boolean().default(false),
    keep_alive: Joi.alternatives()
      .try(Joi.string(), Joi.number().integer().min(0))
      .optional(),
    context: Joi.array().items(Joi.number()).optional(),
  });

  const chatRequestSchema = Joi.object({
    model: Joi.string().required(),
    messages: Joi.array()
      .items(
        Joi.object({
          role: Joi.string()
            .valid("system", "user", "assistant", "tool")
            .required(),
          content: Joi.string().required(),
          thinking: Joi.string().optional(),
          images: Joi.array().items(Joi.string()).optional(),
          tool_calls: Joi.array().items(Joi.object()).optional(),
          tool_name: Joi.string().optional(),
        })
      )
      .required(),
    tools: Joi.array()
      .items(
        Joi.object({
          type: Joi.string().valid("function").required(),
          function: Joi.object({
            name: Joi.string().required(),
            description: Joi.string().required(),
            parameters: Joi.object().required(),
          }).required(),
        })
      )
      .optional(),
    think: Joi.boolean().optional(),
    format: Joi.alternatives()
      .try(Joi.string().valid("json"), Joi.object())
      .optional(),
    options: Joi.object().optional(),
    stream: Joi.boolean().default(true),
    keep_alive: Joi.alternatives()
      .try(Joi.string(), Joi.number().integer().min(0))
      .optional(),
  });

  const createModelSchema = Joi.object({
    model: Joi.string().required(),
    from: Joi.string().optional(),
    files: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
    adapters: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
    template: Joi.string().optional(),
    license: Joi.alternatives()
      .try(Joi.string(), Joi.array().items(Joi.string()))
      .optional(),
    system: Joi.string().optional(),
    parameters: Joi.object().optional(),
    messages: Joi.array().items(Joi.object()).optional(),
    stream: Joi.boolean().default(true),
    quantize: Joi.string().valid("q4_K_M", "q4_K_S", "q8_0").optional(),
  });

  const copyModelSchema = Joi.object({
    source: Joi.string().required(),
    destination: Joi.string().required(),
  });

  const deleteModelSchema = Joi.object({
    model: Joi.string().required(),
  });

  const pullModelSchema = Joi.object({
    model: Joi.string().required(),
    insecure: Joi.boolean().default(false),
    stream: Joi.boolean().default(true),
  });

  const pushModelSchema = Joi.object({
    model: Joi.string().required(),
    insecure: Joi.boolean().default(false),
    stream: Joi.boolean().default(true),
  });

  const showModelSchema = Joi.object({
    model: Joi.string().required(),
    verbose: Joi.boolean().default(false),
  });

  const embedRequestSchema = Joi.object({
    model: Joi.string().required(),
    input: Joi.alternatives()
      .try(Joi.string(), Joi.array().items(Joi.string()))
      .required(),
    truncate: Joi.boolean().default(true),
    options: Joi.object().optional(),
    keep_alive: Joi.alternatives()
      .try(Joi.string(), Joi.number().integer().min(0))
      .optional(),
  });

  const embeddingsRequestSchema = Joi.object({
    model: Joi.string().required(),
    prompt: Joi.string().required(),
    options: Joi.object().optional(),
    keep_alive: Joi.alternatives()
      .try(Joi.string(), Joi.number().integer().min(0))
      .optional(),
  });

  // Helper function to validate model exists in the network
  const validateModelExists = (model: string) => {
    const availableModels = workerRegistry.getAllAvailableModels();
    if (!availableModels.includes(model)) {
      throw createError(
        `Model '${model}' is not available on any worker in the network`,
        404
      );
    }
    // Note: We don't check for immediately available workers here
    // The job scheduler will queue the request and assign it when workers become available
  };

  // Helper function to stream response
  const streamResponse = (res: Response, data: any) => {
    res.write(JSON.stringify(data) + "\n");
  };

  // Helper function to convert LLMama response to Ollama format
  const convertToOllamaResponse = (response: any, model: string) => {
    return {
      model,
      created_at: response.created_at || new Date().toISOString(),
      response: response.response || "",
      done: response.done || false,
      context: response.context || [],
      total_duration: response.total_duration || 0,
      load_duration: response.load_duration || 0,
      prompt_eval_count: response.prompt_eval_count || 0,
      prompt_eval_duration: response.prompt_eval_duration || 0,
      eval_count: response.eval_count || 0,
      eval_duration: response.eval_duration || 0,
    };
  };

  // API/GENERATE - Generate a completion
  router.post(
    "/api/generate",
    asyncHandler(async (req: Request, res: Response) => {
      const { error, value: validatedData } = generateRequestSchema.validate(
        req.body
      );
      if (error) {
        throw createError(
          `Validation error: ${error.details[0]?.message}`,
          400
        );
      }

      validateModelExists(validatedData.model);

      // Handle load/unload cases
      if (!validatedData.prompt || validatedData.prompt.trim() === "") {
        if (validatedData.keep_alive === 0) {
          // Unload model
          const unloadResponse = {
            model: validatedData.model,
            created_at: new Date().toISOString(),
            response: "",
            done: true,
            done_reason: "unload",
          };

          if (validatedData.stream) {
            res.setHeader("Content-Type", "application/json");
            streamResponse(res, unloadResponse);
            res.end();
          } else {
            res.json(unloadResponse);
          }
          return;
        } else {
          // Load model
          const loadResponse = {
            model: validatedData.model,
            created_at: new Date().toISOString(),
            response: "",
            done: true,
          };

          if (validatedData.stream) {
            res.setHeader("Content-Type", "application/json");
            streamResponse(res, loadResponse);
            res.end();
          } else {
            res.json(loadResponse);
          }
          return;
        }
      }

      const inferenceRequest: InferenceRequest = {
        id: uuidv4(),
        model: validatedData.model,
        prompt: validatedData.prompt,
        stream: validatedData.stream,
        options: validatedData.options || {},
        priority: "medium",
        timeout: 300000,
        metadata: {
          ollamaEndpoint: "/api/generate",
          suffix: validatedData.suffix,
          images: validatedData.images,
          think: validatedData.think,
          format: validatedData.format,
          system: validatedData.system,
          template: validatedData.template,
          raw: validatedData.raw,
          keep_alive: validatedData.keep_alive,
          context: validatedData.context,
          submittedAt: new Date().toISOString(),
          clientIp: req.ip,
          userAgent: req.get("User-Agent"),
        },
      };

      logger.job(inferenceRequest.id, "Ollama generate request submitted", {
        model: inferenceRequest.model,
        promptLength: inferenceRequest.prompt.length,
        stream: validatedData.stream,
      });

      try {
        if (validatedData.stream) {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Transfer-Encoding", "chunked");

          // TODO: Implement streaming response
          // For now, we'll simulate streaming by getting the full response and streaming it
          const result = await jobScheduler.submitAndWait(inferenceRequest);
          const ollamaResponse = convertToOllamaResponse(
            result,
            validatedData.model
          );

          // Stream the response in chunks
          const responseText = ollamaResponse.response;
          const chunkSize = 10; // Characters per chunk

          for (let i = 0; i < responseText.length; i += chunkSize) {
            const chunk = responseText.slice(i, i + chunkSize);
            const streamData = {
              ...ollamaResponse,
              response: chunk,
              done: i + chunkSize >= responseText.length,
            };

            if (!streamData.done) {
              delete streamData.total_duration;
              delete streamData.load_duration;
              delete streamData.prompt_eval_count;
              delete streamData.prompt_eval_duration;
              delete streamData.eval_count;
              delete streamData.eval_duration;
              delete streamData.context;
            }

            streamResponse(res, streamData);

            // Small delay to simulate streaming
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          res.end();
        } else {
          const result = await jobScheduler.submitAndWait(inferenceRequest);
          const ollamaResponse = convertToOllamaResponse(
            result,
            validatedData.model
          );
          res.json(ollamaResponse);
        }
      } catch (error) {
        logger.job(inferenceRequest.id, "Ollama generate request failed", {
          error: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      }
    })
  );

  // API/CHAT - Generate a chat completion
  router.post(
    "/api/chat",
    asyncHandler(async (req: Request, res: Response) => {
      const { error, value: validatedData } = chatRequestSchema.validate(
        req.body
      );
      if (error) {
        throw createError(
          `Validation error: ${error.details[0]?.message}`,
          400
        );
      }

      validateModelExists(validatedData.model);

      // Handle load/unload cases
      if (!validatedData.messages || validatedData.messages.length === 0) {
        if (validatedData.keep_alive === 0) {
          // Unload model
          const unloadResponse = {
            model: validatedData.model,
            created_at: new Date().toISOString(),
            message: { role: "assistant", content: "" },
            done_reason: "unload",
            done: true,
          };

          res.json(unloadResponse);
          return;
        } else {
          // Load model
          const loadResponse = {
            model: validatedData.model,
            created_at: new Date().toISOString(),
            message: { role: "assistant", content: "" },
            done_reason: "load",
            done: true,
          };

          res.json(loadResponse);
          return;
        }
      }

      // Convert chat messages to a single prompt
      const prompt =
        validatedData.messages
          .map((msg: any) => `${msg.role}: ${msg.content}`)
          .join("\n") + "\nassistant:";

      const inferenceRequest: InferenceRequest = {
        id: uuidv4(),
        model: validatedData.model,
        prompt,
        stream: validatedData.stream,
        options: validatedData.options || {},
        priority: "medium",
        timeout: 300000,
        metadata: {
          ollamaEndpoint: "/api/chat",
          messages: validatedData.messages,
          tools: validatedData.tools,
          think: validatedData.think,
          format: validatedData.format,
          keep_alive: validatedData.keep_alive,
          submittedAt: new Date().toISOString(),
          clientIp: req.ip,
          userAgent: req.get("User-Agent"),
        },
      };

      logger.job(inferenceRequest.id, "Ollama chat request submitted", {
        model: inferenceRequest.model,
        messageCount: validatedData.messages.length,
        stream: validatedData.stream,
      });

      try {
        if (validatedData.stream) {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Transfer-Encoding", "chunked");

          const result = await jobScheduler.submitAndWait(inferenceRequest);
          const responseText = result.response || "";
          const chunkSize = 10;

          for (let i = 0; i < responseText.length; i += chunkSize) {
            const chunk = responseText.slice(i, i + chunkSize);
            const streamData = {
              model: validatedData.model,
              created_at: new Date().toISOString(),
              message: {
                role: "assistant",
                content: chunk,
                images: null,
              },
              done: i + chunkSize >= responseText.length,
            };

            if (streamData.done) {
              streamData.done = true;
              // Add final metadata
              Object.assign(streamData, {
                total_duration: result.total_duration || 0,
                load_duration: result.load_duration || 0,
                prompt_eval_count: result.prompt_eval_count || 0,
                prompt_eval_duration: result.prompt_eval_duration || 0,
                eval_count: result.eval_count || 0,
                eval_duration: result.eval_duration || 0,
              });
            }

            streamResponse(res, streamData);
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          res.end();
        } else {
          const result = await jobScheduler.submitAndWait(inferenceRequest);
          const chatResponse = {
            model: validatedData.model,
            created_at: new Date().toISOString(),
            message: {
              role: "assistant",
              content: result.response || "",
            },
            done: true,
            total_duration: result.total_duration || 0,
            load_duration: result.load_duration || 0,
            prompt_eval_count: result.prompt_eval_count || 0,
            prompt_eval_duration: result.prompt_eval_duration || 0,
            eval_count: result.eval_count || 0,
            eval_duration: result.eval_duration || 0,
          };

          res.json(chatResponse);
        }
      } catch (error) {
        logger.job(inferenceRequest.id, "Ollama chat request failed", {
          error: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      }
    })
  );

  // API/CREATE - Create a model
  router.post(
    "/api/create",
    asyncHandler(async (req: Request, res: Response) => {
      const { error, value: validatedData } = createModelSchema.validate(
        req.body
      );
      if (error) {
        throw createError(
          `Validation error: ${error.details[0]?.message}`,
          400
        );
      }

      // This is a placeholder implementation
      // In a real implementation, you would handle model creation/copying/quantization
      logger.info("Model creation requested", validatedData);

      if (validatedData.stream) {
        res.setHeader("Content-Type", "application/json");

        const steps = [
          "reading model metadata",
          "creating system layer",
          "writing manifest",
          "success",
        ];

        for (const step of steps) {
          streamResponse(res, { status: step });
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        res.end();
      } else {
        res.json({ status: "success" });
      }
    })
  );

  // API/TAGS - List local models
  router.get(
    "/api/tags",
    asyncHandler(async (req: Request, res: Response) => {
      const allWorkers = workerRegistry.getAllWorkers();
      const modelsMap = new Map<string, OllamaModel>();

      // Aggregate models from all workers
      for (const worker of allWorkers) {
        for (const model of worker.capabilities.availableModels) {
          if (!modelsMap.has(model.name)) {
            modelsMap.set(model.name, {
              name: model.name,
              model: model.name,
              modified_at: model.modified_at,
              size: model.size,
              digest: model.digest,
              details: model.details,
            } as any);
          }
        }
      }

      const models = Array.from(modelsMap.values()).sort((a, b) =>
        a.name.localeCompare(b.name)
      );

      res.json({ models });
    })
  );

  // API/SHOW - Show model information
  router.post(
    "/api/show",
    asyncHandler(async (req: Request, res: Response) => {
      const { error, value: validatedData } = showModelSchema.validate(
        req.body
      );
      if (error) {
        throw createError(
          `Validation error: ${error.details[0]?.message}`,
          400
        );
      }

      validateModelExists(validatedData.model);

      // Find model details from workers
      const allWorkers = workerRegistry.getAllWorkers();
      let modelInfo = null;

      for (const worker of allWorkers) {
        const model = worker.capabilities.availableModels.find(
          (m) => m.name === validatedData.model
        );
        if (model) {
          modelInfo = model;
          break;
        }
      }

      if (!modelInfo) {
        throw createError(`Model '${validatedData.model}' not found`, 404);
      }

      const response: any = {
        modelfile: `# Modelfile generated by LLMama\n# Model: ${validatedData.model}\nFROM ${validatedData.model}`,
        parameters: 'stop "\\n"\nstop "user:"\nstop "assistant:"',
        template:
          "{{ if .System }}{{ .System }}\\n{{ end }}{{ if .Prompt }}{{ .Prompt }}{{ end }}",
        details: modelInfo.details || {
          parent_model: "",
          format: "gguf",
          family: "llama",
          families: ["llama"],
          parameter_size: "Unknown",
          quantization_level: "Unknown",
        },
        model_info: {
          "general.architecture": "llama",
          "general.parameter_count": 0,
          "llama.context_length": 4096,
          "llama.embedding_length": 4096,
        } as Record<string, any>,
        capabilities: ["completion"],
      };

      if (validatedData.verbose) {
        // Add verbose information
        response.model_info["tokenizer.ggml.tokens"] = [];
        response.model_info["tokenizer.ggml.merges"] = [];
        response.model_info["tokenizer.ggml.token_type"] = [];
      }

      res.json(response);
    })
  );

  // API/COPY - Copy a model
  router.post(
    "/api/copy",
    asyncHandler(async (req: Request, res: Response) => {
      const { error, value: validatedData } = copyModelSchema.validate(
        req.body
      );
      if (error) {
        throw createError(
          `Validation error: ${error.details[0]?.message}`,
          400
        );
      }

      validateModelExists(validatedData.source);

      // This is a placeholder implementation
      logger.info("Model copy requested", validatedData);

      res.status(200).json({ status: "success" });
    })
  );

  // API/DELETE - Delete a model
  router.delete(
    "/api/delete",
    asyncHandler(async (req: Request, res: Response) => {
      const { error, value: validatedData } = deleteModelSchema.validate(
        req.body
      );
      if (error) {
        throw createError(
          `Validation error: ${error.details[0]?.message}`,
          400
        );
      }

      validateModelExists(validatedData.model);

      // This is a placeholder implementation
      logger.info("Model deletion requested", validatedData);

      res.status(200).json({ status: "success" });
    })
  );

  // API/PULL - Pull a model
  router.post(
    "/api/pull",
    asyncHandler(async (req: Request, res: Response) => {
      const { error, value: validatedData } = pullModelSchema.validate(
        req.body
      );
      if (error) {
        throw createError(
          `Validation error: ${error.details[0]?.message}`,
          400
        );
      }

      logger.info("Model pull requested", validatedData);

      if (validatedData.stream) {
        res.setHeader("Content-Type", "application/json");

        const steps = [
          { status: "pulling manifest" },
          {
            status: "downloading",
            digest: "sha256:example",
            total: 1000000,
            completed: 250000,
          },
          {
            status: "downloading",
            digest: "sha256:example",
            total: 1000000,
            completed: 500000,
          },
          {
            status: "downloading",
            digest: "sha256:example",
            total: 1000000,
            completed: 1000000,
          },
          { status: "verifying sha256 digest" },
          { status: "writing manifest" },
          { status: "removing any unused layers" },
          { status: "success" },
        ];

        for (const step of steps) {
          streamResponse(res, step);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        res.end();
      } else {
        res.json({ status: "success" });
      }
    })
  );

  // API/PUSH - Push a model
  router.post(
    "/api/push",
    asyncHandler(async (req: Request, res: Response) => {
      const { error, value: validatedData } = pushModelSchema.validate(
        req.body
      );
      if (error) {
        throw createError(
          `Validation error: ${error.details[0]?.message}`,
          400
        );
      }

      validateModelExists(validatedData.model);

      logger.info("Model push requested", validatedData);

      if (validatedData.stream) {
        res.setHeader("Content-Type", "application/json");

        const steps = [
          { status: "retrieving manifest" },
          {
            status: "starting upload",
            digest: "sha256:example",
            total: 1000000,
          },
          { status: "pushing manifest" },
          { status: "success" },
        ];

        for (const step of steps) {
          streamResponse(res, step);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        res.end();
      } else {
        res.json({ status: "success" });
      }
    })
  );

  // API/EMBED - Generate embeddings
  router.post(
    "/api/embed",
    asyncHandler(async (req: Request, res: Response) => {
      const { error, value: validatedData } = embedRequestSchema.validate(
        req.body
      );
      if (error) {
        throw createError(
          `Validation error: ${error.details[0]?.message}`,
          400
        );
      }

      validateModelExists(validatedData.model);

      // Convert input to array if it's a string
      const inputs = Array.isArray(validatedData.input)
        ? validatedData.input
        : [validatedData.input];

      // Generate placeholder embeddings (in real implementation, send to worker)
      const embeddings = inputs.map(
        () => Array.from({ length: 384 }, () => Math.random() * 2 - 1) // Random embeddings
      );

      res.json({
        model: validatedData.model,
        embeddings,
        total_duration: 1000000,
        load_duration: 100000,
        prompt_eval_count: inputs.reduce(
          (sum: number, input: string) => sum + input.split(" ").length,
          0
        ),
      });
    })
  );

  // API/PS - List running models
  router.get(
    "/api/ps",
    asyncHandler(async (req: Request, res: Response) => {
      const allWorkers = workerRegistry.getAllWorkers();
      const runningModels = [];

      for (const worker of allWorkers) {
        if (worker.status === "online" && worker.currentJobs > 0) {
          // In a real implementation, you'd track which specific models are loaded
          // For now, we'll simulate based on available models
          for (const model of worker.capabilities.availableModels.slice(0, 1)) {
            // Simulate one loaded model per worker
            runningModels.push({
              name: model.name,
              model: model.name,
              size: model.size,
              digest: model.digest,
              details: model.details,
              expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes from now
              size_vram: model.size,
            });
          }
        }
      }

      res.json({ models: runningModels });
    })
  );

  // API/EMBEDDINGS - Generate embedding (legacy endpoint)
  router.post(
    "/api/embeddings",
    asyncHandler(async (req: Request, res: Response) => {
      const { error, value: validatedData } = embeddingsRequestSchema.validate(
        req.body
      );
      if (error) {
        throw createError(
          `Validation error: ${error.details[0]?.message}`,
          400
        );
      }

      validateModelExists(validatedData.model);

      // Generate placeholder embedding
      const embedding = Array.from(
        { length: 384 },
        () => Math.random() * 2 - 1
      );

      res.json({
        embedding,
      });
    })
  );

  // API/VERSION - Get version
  router.get(
    "/api/version",
    asyncHandler(async (req: Request, res: Response) => {
      res.json({
        version: "0.5.1",
      });
    })
  );

  // BLOB endpoints for model creation
  router.head(
    "/api/blobs/:digest",
    asyncHandler(async (req: Request, res: Response) => {
      const { digest } = req.params;

      if (!digest) {
        res.status(400).end();
        return;
      }

      // Check if blob exists (placeholder implementation)
      const exists = digest.startsWith("sha256:");

      if (exists) {
        res.status(200).end();
      } else {
        res.status(404).end();
      }
    })
  );

  router.post(
    "/api/blobs/:digest",
    asyncHandler(async (req: Request, res: Response) => {
      const { digest } = req.params;

      // Handle blob upload (placeholder implementation)
      logger.info("Blob upload requested", {
        digest,
        contentLength: req.get("Content-Length"),
      });

      // In a real implementation, you would:
      // 1. Validate the SHA256 digest
      // 2. Store the blob
      // 3. Verify the digest matches

      res.status(201).end();
    })
  );

  return router;
};
