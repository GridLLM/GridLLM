// Worker and Node Types
export interface NodeCapabilities {
	workerId: string;
	availableModels: OllamaModel[];
	systemResources: SystemResources;
	performanceTier: "high" | "medium" | "low";
	maxConcurrentTasks: number;
	supportedFormats: string[];
	lastUpdated: Date;
}

export interface SystemResources {
	cpuCores: number;
	totalMemoryMB: number;
	availableMemoryMB: number;
	cpuUsagePercent: number;
	memoryUsagePercent: number;
	gpuMemoryMB?: number;
	gpuUsagePercent?: number;
	diskSpaceGB: number;
	platform: string;
	architecture: string;
}

export interface OllamaModel {
	name: string;
	model?: string;
	size: number;
	digest: string;
	modified_at: string;
	details?: {
		parent_model?: string;
		format: string;
		family: string;
		families: string[];
		parameter_size: string;
		quantization_level: string;
	};
}

// Worker Status and Connection
export interface WorkerInfo {
	workerId: string;
	capabilities: NodeCapabilities;
	status: "online" | "offline" | "busy" | "error";
	currentJobs: number;
	lastHeartbeat: Date;
	registeredAt: Date;
	totalJobsProcessed: number;
	connectionHealth: "healthy" | "degraded" | "unhealthy";
}

export interface WorkerStatus {
	workerId: string;
	status: "idle" | "busy" | "error" | "offline";
	currentJobs: number;
	maxJobs: number;
	systemResources: SystemResources;
	connectionHealth: "healthy" | "degraded" | "unhealthy";
	lastUpdated: Date;
}

// Job and Inference Types
export interface InferenceRequest {
	id: string;
	model: string;
	prompt?: string; // Optional for embedding requests
	stream?: boolean;
	// Embedding-specific fields
	input?: string | string[]; // For embedding requests
	truncate?: boolean; // For embedding requests
	// Common fields
	options?: {
		temperature?: number;
		top_k?: number;
		top_p?: number;
		num_predict?: number;
		stop?: string[];
		seed?: number;
		[key: string]: any;
	};
	priority?: "high" | "medium" | "low";
	timeout?: number;
	metadata?: {
		retryCount?: number;
		orphaned?: boolean;
		originalWorkerId?: string;
		orphanedAt?: string;
		requeueCount?: number;
		requestType?: "inference" | "embedding"; // To distinguish request types
		ollamaEndpoint?: string;
		[key: string]: any;
	};
}

export interface EmbeddingRequest {
	id: string;
	model: string;
	input: string | string[];
	truncate?: boolean;
	options?: {
		[key: string]: any;
	};
	priority?: "high" | "medium" | "low";
	timeout?: number;
	metadata?: {
		retryCount?: number;
		orphaned?: boolean;
		originalWorkerId?: string;
		orphanedAt?: string;
		requeueCount?: number;
		ollamaEndpoint?: string;
		[key: string]: any;
	};
}

export interface InferenceResponse {
	id: string;
	model?: string;
	created_at?: string;
	response?: string; // Optional for embedding responses
	thinking?: string;
	done?: boolean;
	done_reason?: string;
	context?: number[];
	// Embedding-specific fields
	embeddings?: number[][]; // For embedding responses
	embedding?: number[]; // Legacy field for single embedding
	// Common timing fields
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	prompt_eval_duration?: number;
	eval_count?: number;
	eval_duration?: number;
}

export interface EmbeddingResponse {
	id: string;
	model?: string;
	embeddings: number[][];
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
}

export interface JobAssignment {
	jobId: string;
	workerId: string;
	request: InferenceRequest;
	assignedAt: Date;
	timeout: number;
}

// Server Types
export interface ServerStatus {
	serverId: string;
	status: "running" | "maintenance" | "error";
	connectedWorkers: number;
	activeJobs: number;
	queuedJobs: number;
	totalJobsProcessed: number;
	uptime: number;
	version: string;
}

// Error Types
export interface GridLLMError extends Error {
	statusCode?: number;
	code?: string;
	details?: any;
}

// Events
export interface WorkerEvent {
	type:
		| "registered"
		| "unregistered"
		| "heartbeat"
		| "status_changed"
		| "job_completed"
		| "job_failed";
	workerId: string;
	timestamp: Date;
	data?: any;
}

export interface JobEvent {
	type:
		| "created"
		| "assigned"
		| "started"
		| "completed"
		| "failed"
		| "timeout";
	jobId: string;
	workerId?: string;
	timestamp: Date;
	data?: any;
}

// Ollama-specific types
export interface OllamaChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	thinking?: string;
	images?: string[];
	tool_calls?: any[];
	tool_name?: string;
}

export interface OllamaChatRequest {
	model: string;
	messages: OllamaChatMessage[];
	tools?: any[];
	think?: boolean;
	format?: string | object;
	options?: Record<string, any>;
	stream?: boolean;
	keep_alive?: string | number;
}

export interface OllamaChatResponse {
	model: string;
	created_at: string;
	message: {
		role: string;
		content: string;
		thinking?: string;
		images?: null;
		tool_calls?: any[];
	};
	done: boolean;
	done_reason?: string;
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	prompt_eval_duration?: number;
	eval_count?: number;
	eval_duration?: number;
}

export interface OllamaGenerateRequest {
	model: string;
	prompt: string;
	suffix?: string;
	images?: string[];
	think?: boolean;
	format?: string | object;
	options?: Record<string, any>;
	system?: string;
	template?: string;
	stream?: boolean;
	raw?: boolean;
	keep_alive?: string | number;
	context?: number[];
}

export interface OllamaGenerateResponse {
	model: string;
	created_at: string;
	response: string;
	thinking?: string;
	done: boolean;
	done_reason?: string;
	context?: number[];
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	prompt_eval_duration?: number;
	eval_count?: number;
	eval_duration?: number;
}

export interface OllamaModelDetails {
	parent_model?: string;
	format: string;
	family: string;
	families: string[];
	parameter_size: string;
	quantization_level: string;
}

export interface OllamaModelInfo {
	name: string;
	model: string;
	modified_at: string;
	size: number;
	digest: string;
	details: OllamaModelDetails;
}

export interface OllamaTagsResponse {
	models: OllamaModelInfo[];
}

export interface OllamaShowResponse {
	modelfile: string;
	parameters: string;
	template: string;
	details: OllamaModelDetails;
	model_info: Record<string, any>;
	capabilities: string[];
}
