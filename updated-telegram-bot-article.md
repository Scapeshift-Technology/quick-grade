# Architecting Highly Scalable Serverless Telegram Bots

## Telegram as a Messaging Platform

Telegram is a powerful platform for building interactive applications. It has a large active userbase, a robust API with features like large file uploads, payments, and other useful functionality. You get a battle-tested, multi-functional chat interface for free - all you have to do is provide value to its users.

Many developers and entrepreneurs have recognized Telegram's potential as an application platform, with some even building their entire startups as Telegram bots.

## Hosting Telegram Bots

When building Telegram bots, we need a deployment approach that satisfies these requirements:

1. Low cost, ideally free until the bot reaches significant usage
2. Ability to create and test multiple bots simultaneously
3. Frictionless development with infrastructure that doesn't create obstacles
4. Massive scalability for when usage does take off

AWS serverless offerings are ideal for this use case. We can deploy our bot as an AWS Lambda function and only pay for actual compute time. With the AWS free tier providing 1 million invocations and 400,000 GB-seconds of compute time monthly for free, you can operate many bots without any cost until they gain significant traction.

## Serverless Infrastructure as Code with SST

Setting up AWS resources manually is time-consuming and error-prone. Instead, we'll use Infrastructure as Code (IaC) principles to declaratively specify our resources. SST (Serverless Stack) is perfect for this - it's specifically designed for building serverless applications and makes infrastructure a first-class citizen in your codebase.

SST v3 makes it even easier with a unified config file and support for over 150 providers, giving you everything you need to build a massively scalable Telegram bot.

## Setting Up an SST Project for Our Telegram Bot

Let's start by creating a new SST project:

```bash
pnpm create sst@latest telegram-bot
cd telegram-bot
pnpm install
```

## Configuring the SST Stack

We'll replace the default `sst.config.ts` with our Telegram bot configuration:

```typescript
import { SSTConfig } from "sst";
import { Function, Config, Queue } from "sst/constructs";

export default {
  config(_input) {
    return {
      name: "telegram-bot",
      region: "us-east-1",
    };
  },
  stacks(app) {
    app.stack(function TelegramBotStack({ stack }) {
      // Create a secure way to store the Telegram bot token
      const TELEGRAM_BOT_TOKEN = new Config.Secret(stack, "TELEGRAM_BOT_TOKEN");
      
      // Create a dead-letter queue for failed message processing
      const deadLetterQueue = new Queue(stack, "deadLetterQueue");
      
      // Create the message queue for handling messages in order
      const messageQueue = new Queue(stack, "messageQueue", {
        cdk: {
          queue: {
            fifo: true, // FIFO ensures messages are processed in order
            deadLetterQueue: {
              queue: deadLetterQueue.cdk.queue,
              maxReceiveCount: 3, // Number of processing attempts before sending to DLQ
            },
          },
        },
        consumer: {
          function: {
            bind: [TELEGRAM_BOT_TOKEN],
            handler: "functions/messageConsumer.handler",
            nodejs: {
              install: ["telegraf"], // Install Telegraf for the consumer
            }
          },
        },
      });
      
      // Create the webhook endpoint
      const webhook = new Function(stack, "webhook", {
        handler: "functions/webhook.handler",
        bind: [messageQueue],
        url: true, // Creates a function URL
      });
      
      // Show the webhook URL in the output
      stack.addOutputs({
        WebhookUrl: webhook.url,
        DeadLetterQueueUrl: deadLetterQueue.url,
      });
    });
  },
} satisfies SSTConfig;
```

This creates:
1. A secure way to store our Telegram bot token
2. A FIFO SQS queue for handling messages in order
3. A dead-letter queue for failed message processing
4. A Lambda function with a URL endpoint to receive webhook calls from Telegram
5. A Lambda function to process messages from the queue

## Setting Up Our Telegram Bot with BotFather

Before implementing the code, we need to set up a bot with BotFather:

1. Open Telegram and search for @BotFather
2. Send `/newbot` and follow the instructions
3. Note the token provided - we'll need this for our SST app

Next, set the token in SST:

```bash
pnpm sst secrets set TELEGRAM_BOT_TOKEN "your-telegram-bot-token" --stage dev
```

## Implementing Webhook Handler

Create the webhook handler in `functions/webhook.ts`:

```typescript
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { Queue } from "sst/node/queue";
import { APIGatewayProxyHandlerV2 } from "aws-lambda";

const sqs = new SQSClient({});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "No body provided" }),
    };
  }

  try {
    const update = JSON.parse(event.body);
    
    // Extract message details for FIFO queue
    const messageId = update.message?.message_id || update.callback_query?.id || Date.now().toString();
    const userId = update.message?.from?.id || update.callback_query?.from?.id || "unknown";
    
    await sqs.send(new SendMessageCommand({
      QueueUrl: Queue.messageQueue.queueUrl,
      MessageBody: event.body,
      MessageDeduplicationId: messageId.toString(),
      MessageGroupId: userId.toString(),
    }));
    
    // Return quickly to Telegram
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error("Error processing webhook:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to process webhook" }),
    };
  }
};
```

This function:
1. Receives the webhook POST from Telegram
2. Validates and parses the request
3. Sends the message to our SQS queue with the appropriate FIFO parameters
4. Returns a quick response to Telegram

## Implementing the Message Consumer

Create the message consumer in `functions/messageConsumer.ts`:

```typescript
import { SQSEvent } from "aws-lambda";
import { Telegraf } from "telegraf";
import { Config } from "sst/node/config";

// Initialize bot with token from SST secrets
const bot = new Telegraf(Config.TELEGRAM_BOT_TOKEN);

// Set up bot commands
bot.command("start", (ctx) => ctx.reply("Welcome to my bot!"));
bot.command("help", (ctx) => ctx.reply("How can I help you?"));
bot.on("text", (ctx) => ctx.reply(`You said: ${ctx.message.text}`));

export const handler = async (event: SQSEvent) => {
  try {
    for (const record of event.Records) {
      const update = JSON.parse(record.body);
      
      // Process the message with Telegraf
      await bot.handleUpdate(update);
    }
    
    return { success: true };
  } catch (error) {
    console.error("Error processing message:", error);
    throw error;
  }
};
```

This function:
1. Processes messages from the SQS queue
2. Uses Telegraf to handle bot commands and messages
3. Makes sure each update is processed in order within its message group

## Error Handling with Dead-Letter Queues

In a production system, it's critical to handle errors gracefully. Messages might fail to process for various reasons:

- Temporary API outages
- Rate limiting from Telegram
- Bugs in your message handling code
- Network issues

A dead-letter queue (DLQ) captures messages that fail processing after multiple attempts. In our stack configuration, we've added a DLQ with a `maxReceiveCount` of 3, meaning a message will be moved to the DLQ after 3 failed processing attempts.

To handle these failed messages, you might want to add a consumer to the DLQ:

```typescript
// Add this to your stack configuration
deadLetterQueue.subscribe("deadLetterProcessor", {
  handler: "functions/deadLetterProcessor.handler",
  bind: [TELEGRAM_BOT_TOKEN],
});
```

Then implement a handler for failed messages:

```typescript
// functions/deadLetterProcessor.ts
import { SQSEvent } from "aws-lambda";
import { Telegraf } from "telegraf";
import { Config } from "sst/node/config";

const bot = new Telegraf(Config.TELEGRAM_BOT_TOKEN);

export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    try {
      // Parse the failed message
      const originalMessage = JSON.parse(record.body);
      const update = JSON.parse(originalMessage);
      
      // Log details for debugging
      console.log("Failed message:", JSON.stringify(update, null, 2));
      
      // Optionally notify the user about the issue
      if (update.message?.chat?.id) {
        await bot.telegram.sendMessage(
          update.message.chat.id,
          "Sorry, I couldn't process your last message. Our team has been notified."
        );
      }
      
      // You could also send notifications to your team
      // or store the failed message in a database for analysis
    } catch (error) {
      console.error("Error processing DLQ message:", error);
    }
  }
  
  return { success: true };
};
```

With this setup, your bot can gracefully handle failures while providing feedback to users and visibility for your team. The DLQ gives you a safety net to:

1. Prevent message loss when errors occur
2. Analyze patterns in failed messages
3. Implement recovery strategies for different failure types
4. Retry processing after fixing issues

For critical bots, you might also want to set up CloudWatch alarms on the DLQ to alert your team when messages start failing.

## Installing Dependencies

For our functions to work properly, we need to install the required packages. SST makes this easy by allowing you to specify packages directly in your function configuration using the `nodejs.install` property, as shown in our stack configuration.

For local development, you'll also want to install these packages:

```bash
# Install AWS SDK packages
pnpm add @aws-sdk/client-sqs

# Install Telegraf for Telegram bot functionality
pnpm add telegraf

# Install AWS Lambda types for TypeScript
pnpm add -D @types/aws-lambda
```

The great thing about SST is that when you deploy, it automatically bundles only the dependencies each function actually needs, optimizing your Lambda function size.

## Local Development with SST

One of SST's best features is its live Lambda development environment. This lets you test your functions locally while still interacting with actual AWS resources like SQS queues.

Start the local development environment:

```bash
pnpm sst dev
```

SST will:
1. Deploy your infrastructure to AWS (but replace the Lambda functions with ones connected to your local machine)
2. Watch for changes to your function code
3. Open the SST Console in your browser

You can now test your webhook endpoint by sending requests to it. Since we're using a webhook, you'll need to use a tool like ngrok to expose your local development environment to the internet so Telegram can reach it:

```bash
# Install ngrok if you haven't already
npm install -g ngrok

# Start ngrok on the port where SST's function URL is accessible
ngrok http <your-SST-dev-port>
```

Now, temporarily set your Telegram webhook to the ngrok URL:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_NGROK_URL>"
```

In the SST Console, you can:
1. View logs from your Lambda functions in real-time
2. Test your functions by sending sample events
3. Monitor queue messages and function invocations
4. See detailed error messages if something goes wrong

This makes debugging straightforward - when you interact with your bot in Telegram, you'll see all the webhook requests and function logs right in the SST Console. You can modify your code and see changes take effect instantly without redeploying.

Remember to change your webhook back to your production URL when you're done testing.

## Setting Up the Telegram Webhook

After deploying our stack, we need to tell Telegram where to send updates:

```bash
pnpm sst deploy --stage dev
```

After deployment, use the webhook URL from the output:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_WEBHOOK_URL>"
```

## Advantages of This Architecture

This architecture provides several benefits:

1. **Immediate Response**: The webhook handler responds immediately to Telegram, preventing timeouts
2. **Ordered Message Processing**: FIFO queues ensure messages from each user are processed in order
3. **Proper Error Handling**: Failed messages go to a dead-letter queue for debugging
4. **Parallelism**: Different users' messages are processed independently
5. **Scalability**: The system scales automatically with message volume
6. **Cost-Efficiency**: You only pay for actual usage

## Conclusion

With SST and AWS serverless services, you can build highly scalable Telegram bots without worrying about infrastructure management. The architecture we've designed ensures:

- Messages are processed in the correct order for each user
- The bot responds quickly to Telegram, avoiding timeouts
- The system scales automatically with usage
- Development is streamlined with infrastructure as code

This approach lets you focus on your bot's unique functionality while the serverless infrastructure handles the rest. 