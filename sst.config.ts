/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    // Map stages to AWS profiles - only use profiles for local development
    // GitHub Actions will use the assumed role credentials
    const isLocal = !process.env.GITHUB_ACTIONS;
    const profile = isLocal 
      ? (input?.stage === "prod" ? "quick-grade-prod" : "quick-grade-dev")
      : undefined;
    
    return {
      name: "quick-grade",
      removal: input?.stage === "prod" ? "retain" : "remove",
      protect: ["prod"].includes(input?.stage),
      home: "aws",
      providers: {
        aws: {
          ...(profile && { profile }), // Only set profile if it exists
          region: "us-east-1",
        },
      },
    };
  },
  async run() {
    // Create secrets for sensitive data
    const TELEGRAM_BOT_TOKEN = new sst.Secret("TELEGRAM_BOT_TOKEN");
    const DATABASE_CONNECTION_STRING = new sst.Secret("DATABASE_CONNECTION_STRING");
    
    // Create the message queue for handling messages in order
    const messageQueue = new sst.aws.Queue("MessageQueue", {
      fifo: true, // FIFO ensures messages are processed in order
    });
    
    // Create the message consumer function
    const messageConsumer = new sst.aws.Function("MessageConsumer", {
      handler: "functions/messageConsumer.handler",
      link: [TELEGRAM_BOT_TOKEN, DATABASE_CONNECTION_STRING, messageQueue],
      environment: {
        NODE_ENV: $app.stage === "prod" ? "production" : "development",
        STAGE: $app.stage,
      },
    });
    
    // Subscribe the consumer to the queue
    messageQueue.subscribe(messageConsumer.arn);
    
    // Create the webhook endpoint
    const webhook = new sst.aws.Function("Webhook", {
      handler: "functions/webhook.handler",
      link: [messageQueue],
      url: true, // Creates a function URL
      environment: {
        NODE_ENV: $app.stage === "prod" ? "production" : "development",
        STAGE: $app.stage,
      },
    });
    
    // Return outputs
    return {
      webhookUrl: webhook.url,
      messageQueueUrl: messageQueue.url,
    };
  },
});
