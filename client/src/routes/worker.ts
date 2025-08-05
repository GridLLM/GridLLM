import { Router, Request, Response } from "express";
import { BrokerClientService } from "@/services/BrokerClientService";
import { logger } from "@/utils/logger";
import { asyncHandler } from "@/middleware/errorHandler";

export const workerRoutes = (brokerClient: BrokerClientService): Router => {
	const router = Router();

	// Get worker status
	router.get(
		"/status",
		asyncHandler(async (req: Request, res: Response) => {
			try {
				const status = await brokerClient.getStatus();
				const connectionStatus = brokerClient.getConnectionStatus();
				const capabilities = brokerClient.getCapabilities();

				res.json({
					worker: status,
					connection: connectionStatus,
					capabilities,
					timestamp: new Date().toISOString(),
				});
			} catch (error) {
				logger.error("Failed to get worker status", error);
				res.status(500).json({
					error: error instanceof Error ? error.message : "Unknown error",
					timestamp: new Date().toISOString(),
				});
			}
		})
	);

	// Get worker capabilities
	router.get(
		"/capabilities",
		asyncHandler(async (req: Request, res: Response) => {
			try {
				const capabilities = brokerClient.getCapabilities();

				if (!capabilities) {
					res.status(503).json({
						error: "Worker capabilities not available",
						timestamp: new Date().toISOString(),
					});
					return;
				}

				res.json({
					capabilities,
					timestamp: new Date().toISOString(),
				});
			} catch (error) {
				logger.error("Failed to get worker capabilities", error);
				res.status(500).json({
					error: error instanceof Error ? error.message : "Unknown error",
					timestamp: new Date().toISOString(),
				});
			}
		})
	);

	// Get connection status
	router.get(
		"/connection",
		asyncHandler(async (req: Request, res: Response) => {
			try {
				const connectionStatus = brokerClient.getConnectionStatus();

				res.json({
					connection: connectionStatus,
					timestamp: new Date().toISOString(),
				});
			} catch (error) {
				logger.error("Failed to get connection status", error);
				res.status(500).json({
					error: error instanceof Error ? error.message : "Unknown error",
					timestamp: new Date().toISOString(),
				});
			}
		})
	);

	// Get worker metrics
	router.get(
		"/metrics",
		asyncHandler(async (req: Request, res: Response) => {
			try {
				const status = await brokerClient.getStatus();

				res.json({
					metrics: {
						uptime: process.uptime(),
						memoryUsage: process.memoryUsage(),
						cpuUsage: process.cpuUsage(),
						workerStatus: status,
					},
					timestamp: new Date().toISOString(),
				});
			} catch (error) {
				logger.error("Failed to get worker metrics", error);
				res.status(500).json({
					error: error instanceof Error ? error.message : "Unknown error",
					timestamp: new Date().toISOString(),
				});
			}
		})
	);

	return router;
};
