/// <reference path="../sst-env.d.ts" />
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { Resource } from "sst";

const sqs = new SQSClient({});

// Debug helper function
const debugLog = (message: string, data?: any) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[WEBHOOK DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
};

export const handler = async (event: any) => {
  debugLog("Webhook handler started", { 
    httpMethod: event.httpMethod, 
    headers: event.headers,
    hasBody: !!event.body,
    nodeEnv: process.env.NODE_ENV,
    stage: process.env.STAGE
  });

  if (!event.body) {
    debugLog("No body provided in request");
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "No body provided" }),
    };
  }

  try {
    const update = JSON.parse(event.body);
    debugLog("Parsed Telegram update", update);
    
    // Extract message details for FIFO queue
    const messageId = update.message?.message_id || update.callback_query?.id || Date.now().toString();
    const userId = update.message?.from?.id || update.callback_query?.from?.id || "unknown";
    
    debugLog("Extracted message details", { messageId, userId });
    
    console.log(`Processing message ${messageId} from user ${userId}`);
    
    const sqsParams = {
      QueueUrl: Resource.MessageQueue.url,
      MessageBody: event.body,
      MessageDeduplicationId: messageId.toString(),
      MessageGroupId: userId.toString(),
    };
    
    debugLog("Sending to SQS", sqsParams);
    
    await sqs.send(new SendMessageCommand(sqsParams));
    
    debugLog("Successfully sent to SQS");
    
    // Return quickly to Telegram
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error("Error processing webhook:", error);
    debugLog("Error occurred", { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: "Failed to process webhook",
        message: error instanceof Error ? error.message : String(error)
      }),
    };
  }
}; 