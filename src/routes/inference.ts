import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';
import { BrokerClientService } from '@/services/BrokerClientService';
import { logger } from '@/utils/logger';
import { asyncHandler, createError } from '@/middleware/errorHandler';
import { InferenceRequest } from '@/types';

export const inferenceRoutes = (brokerClient: BrokerClientService): Router => {
  const router = Router();

  // Validation schema for inference requests
  const inferenceRequestSchema = Joi.object({
    model: Joi.string().required(),
    prompt: Joi.string().required().max(100000), // 100KB max prompt
    stream: Joi.boolean().default(false),
    options: Joi.object({
      temperature: Joi.number().min(0).max(2).default(0.8),
      top_k: Joi.number().integer().min(1).max(100).default(40),
      top_p: Joi.number().min(0).max(1).default(0.9),
      num_predict: Joi.number().integer().min(-1).max(4096).default(128),
      stop: Joi.array().items(Joi.string()).max(10),
      seed: Joi.number().integer(),
    }).default({}),
    priority: Joi.string().valid('high', 'medium', 'low').default('medium'),
    timeout: Joi.number().integer().min(1000).max(600000).default(300000), // 5 minutes default
    metadata: Joi.object().default({}),
  });

  // Submit inference request
  router.post('/', asyncHandler(async (req: Request, res: Response) => {
    try {
      // Validate request body
      const { error, value: validatedData } = inferenceRequestSchema.validate(req.body);
      if (error) {
        throw createError(`Validation error: ${error.details[0]?.message}`, 400);
      }

      // Check if broker client is ready
      const connectionStatus = brokerClient.getConnectionStatus();
      if (!connectionStatus.isConnected) {
        throw createError('Broker client not connected', 503);
      }

      // Check if model is available
      const capabilities = brokerClient.getCapabilities();
      if (!capabilities) {
        throw createError('Worker capabilities not available', 503);
      }

      const modelAvailable = capabilities.availableModels.some(
        model => model.name === validatedData.model
      );
      if (!modelAvailable) {
        throw createError(`Model '${validatedData.model}' is not available on this worker`, 400);
      }

      // Create inference request
      const inferenceRequest: InferenceRequest = {
        id: uuidv4(),
        model: validatedData.model,
        prompt: validatedData.prompt,
        stream: validatedData.stream,
        options: validatedData.options,
        priority: validatedData.priority,
        timeout: validatedData.timeout,
        metadata: {
          ...validatedData.metadata,
          submittedAt: new Date().toISOString(),
          clientIp: req.ip,
          userAgent: req.get('User-Agent'),
        },
      };

      logger.info('Inference request submitted', {
        id: inferenceRequest.id,
        model: inferenceRequest.model,
        priority: inferenceRequest.priority,
        promptLength: inferenceRequest.prompt.length,
      });

      // Add job to queue
      await brokerClient.addJob(inferenceRequest);

      res.status(202).json({
        id: inferenceRequest.id,
        status: 'accepted',
        message: 'Inference request queued successfully',
        estimatedProcessingTime: '30-300 seconds',
        timestamp: new Date().toISOString(),
      });

    } catch (error) {
      logger.error('Failed to submit inference request', error);
      
      if (error instanceof Error && (error as any).statusCode) {
        res.status((error as any).statusCode).json({
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(500).json({
          error: 'Internal server error',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }));

  // Get inference status (if we had job tracking)
  router.get('/:id/status', asyncHandler(async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // In a real implementation, you'd look up the job status
      // For now, return a placeholder response
      logger.info('Inference status requested', { id });

      res.json({
        id,
        status: 'processing',
        message: 'Job status tracking not implemented yet',
        timestamp: new Date().toISOString(),
      });

    } catch (error) {
      logger.error('Failed to get inference status', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }));

  // Cancel inference request
  router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // In a real implementation, you'd cancel the job
      logger.info('Inference cancellation requested', { id });

      res.json({
        id,
        status: 'cancellation_requested',
        message: 'Job cancellation not implemented yet',
        timestamp: new Date().toISOString(),
      });

    } catch (error) {
      logger.error('Failed to cancel inference request', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }));

  // Get available models
  router.get('/models', asyncHandler(async (req: Request, res: Response) => {
    try {
      const capabilities = brokerClient.getCapabilities();
      
      if (!capabilities) {
        throw createError('Worker capabilities not available', 503);
      }

      res.json({
        models: capabilities.availableModels.map(model => ({
          name: model.name,
          size: model.size,
          modified_at: model.modified_at,
          details: model.details,
        })),
        count: capabilities.availableModels.length,
        timestamp: new Date().toISOString(),
      });

    } catch (error) {
      logger.error('Failed to get available models', error);
      
      if (error instanceof Error && (error as any).statusCode) {
        res.status((error as any).statusCode).json({
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(500).json({
          error: 'Internal server error',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }));

  return router;
};
