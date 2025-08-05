import { Request, Response, NextFunction } from "express";
import { logger } from "@/utils/logger";

export interface GridLLMError extends Error {
	statusCode?: number;
	code?: string;
	details?: any;
}

export const createError = (
	message: string,
	statusCode: number = 500,
	code?: string,
	details?: any
): GridLLMError => {
	const error = new Error(message) as GridLLMError;
	error.statusCode = statusCode;
	if (code) error.code = code;
	error.details = details;
	return error;
};

export const asyncHandler = (fn: Function) => {
	return (req: Request, res: Response, next: NextFunction) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
};

export const errorHandler = (
	error: GridLLMError,
	req: Request,
	res: Response,
	next: NextFunction
): void => {
	let statusCode = error.statusCode || 500;
	let message = error.message || "Internal Server Error";
	let code = error.code;
	let details = error.details;

	// Handle specific error types
	if (error.name === "ValidationError") {
		statusCode = 400;
		message = "Validation Error";
	} else if (error.name === "CastError") {
		statusCode = 400;
		message = "Invalid ID format";
	} else if (
		error.name === "MongoError" &&
		error.message.includes("duplicate key")
	) {
		statusCode = 409;
		message = "Resource already exists";
	}

	// Log the error
	logger.error("Request error", {
		error: {
			message: error.message,
			stack: error.stack,
			statusCode,
			code,
			details,
		},
		request: {
			method: req.method,
			url: req.url,
			ip: req.ip,
			userAgent: req.get("User-Agent"),
		},
	});

	// Send error response
	res.status(statusCode).json({
		error: {
			message,
			code,
			details: process.env.NODE_ENV === "development" ? details : undefined,
		},
		timestamp: new Date().toISOString(),
		path: req.path,
		method: req.method,
	});
};

export const notFoundHandler = (req: Request, res: Response): void => {
	res.status(404).json({
		error: {
			message: "Route not found",
			code: "NOT_FOUND",
		},
		timestamp: new Date().toISOString(),
		path: req.path,
		method: req.method,
	});
};
