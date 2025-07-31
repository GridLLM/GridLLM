/**
 * Jest setup file for integration tests
 */

// Global test setup
beforeAll(() => {
	console.log("Setting up integration test environment...");
});

afterAll(() => {
	console.log("Cleaning up integration test environment...");
});

// Increase timeout for integration tests
jest.setTimeout(30000);
