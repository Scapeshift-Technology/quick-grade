// Debug entry point for JetBrains IDE
// Set up a run configuration pointing to this file
// Make sure to install ts-node: npm install --save-dev ts-node

// Mock SST Resource for local development
const mockResource = {
  CronSuccessNotificationTopic: {
    arn: 'mock-success-topic-arn'
  },
  CronErrorNotificationTopic: {
    arn: 'mock-error-topic-arn'
  }
};

// Mock the sst module before requiring the handler
require.cache[require.resolve('sst')] = {
  exports: {
    Resource: mockResource
  }
};

// Register ts-node with transpile-only mode to skip type checking
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs'
  }
});

// Remove Lambda environment variable to force local execution
delete process.env.AWS_LAMBDA_FUNCTION_NAME;

// Mock environment variables that would normally be set by SST
// Note: DATABASE_CONNECTION_STRING should be set to real value for local testing
process.env.STAGE = 'local';
process.env.CRON_JOB_NAME = 'test-cron-local';

const { handler } = require('./testCron/handler.ts');

// Mock event for testing
const mockEvent = {
  source: 'aws.events',
  'detail-type': 'Scheduled Event',
  detail: {}
};

console.log('🚀 Running handler locally...');

// Run the handler
handler(mockEvent)
  .then(result => {
    console.log('✅ Handler completed successfully:', result);
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Handler failed:', error);
    process.exit(1);
  }); 