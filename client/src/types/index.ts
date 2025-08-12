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
	priority: "high" | "medium" | "low";
	timeout?: number;
	metadata?: {
		requestType?: "inference" | "embedding" | "chat"; // To distinguish request types
		messages?: OllamaChatMessage[]; // For chat requests
		ollamaEndpoint?: string; // To specify which Ollama endpoint to use
		[key: string]: any;
	};
}

// Ollama Chat Types
export interface OllamaChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	thinking?: string;
	images?: string[];
	tool_calls?: any[];
	tool_name?: string;
}

export interface InferenceResponse {
	id: string;
	model?: string;
	created_at?: string;
	response?: string; // Optional for embedding responses and chat responses
	thinking?: string;
	done?: boolean;
	done_reason?: string;
	context?: number[];
	// Chat-specific fields
	message?: {
		role?: string;
		content?: string;
		thinking?: string;
		images?: null;
		tool_calls?: any[];
	};
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
	// OpenAI compatibility field
	system_fingerprint?: string;
}

export interface StreamResponse {
	id: string;
	response: string;
	done: boolean;
}

export interface OllamaModel {
	name: string;
	digest: string;
	size: number;
	modified_at: string;
	details?: {
		format: string;
		family: string;
		families?: string[];
		parameter_size: string;
		quantization_level: string;
	};
}

export interface NodeCapabilities {
	workerId: string;
	availableModels: OllamaModel[];
	maxConcurrentTasks: number;
	supportedFormats: string[];
	lastUpdated: Date;
}

export interface TaskJob {
	id: string;
	request: InferenceRequest;
	assignedWorkerId?: string;
	status:
		| "pending"
		| "assigned"
		| "running"
		| "completed"
		| "failed"
		| "cancelled";
	createdAt: Date;
	startedAt?: Date;
	completedAt?: Date;
	error?: string;
	result?: InferenceResponse;
	retryCount: number;
	priority: number;
}

export interface WorkerStatus {
	id: string;
	status: "online" | "offline" | "busy" | "error";
	currentJobs: string[];
	capabilities: NodeCapabilities;
	lastHeartbeat: Date;
	connectionHealth: "healthy" | "degraded" | "poor";
}

export interface BrokerConnection {
	isConnected: boolean;
	lastConnected?: Date;
	reconnectAttempts: number;
	connectionId?: string;
}

export interface HealthStatus {
	status: "healthy" | "degraded" | "unhealthy";
	checks: {
		ollama: boolean;
		redis: boolean;
		broker: boolean;
		resources: boolean;
	};
	uptime: number;
	lastCheck: Date;
}
