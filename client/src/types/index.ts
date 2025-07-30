export interface InferenceRequest {
	id: string;
	model: string;
	prompt: string;
	stream?: boolean;
	options?: {
		temperature?: number;
		top_k?: number;
		top_p?: number;
		num_predict?: number;
		stop?: string[];
		seed?: number;
	};
	priority: "high" | "medium" | "low";
	timeout?: number;
	metadata?: Record<string, any>;
}

export interface InferenceResponse {
	id: string;
	model?: string;
	created_at?: string;
	response: string;
	done: boolean;
	context?: number[];
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	prompt_eval_duration?: number;
	eval_count?: number;
	eval_duration?: number;
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
	gpuMemoryMB?: number;
	availableGpuMemoryMB?: number;
	cpuUsagePercent: number;
	memoryUsagePercent: number;
	gpuUsagePercent?: number;
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
