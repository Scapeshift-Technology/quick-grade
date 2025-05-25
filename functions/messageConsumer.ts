import { SQSEvent } from "aws-lambda";
import { Resource } from "sst";
import { Context, Telegraf } from "telegraf";
import { registerUser, validateRegistrationInput } from "./database";

// Debug helper function
const debugLog = (message: string, data?: any) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[CONSUMER DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
};

// Bot setup function
const setupBot = () => {
  debugLog("Setting up Telegraf bot", { 
    hasToken: !!Resource.TELEGRAM_BOT_TOKEN.value,
    tokenLength: Resource.TELEGRAM_BOT_TOKEN.value?.length,
    stage: process.env.STAGE,
    nodeEnv: process.env.NODE_ENV
  });
  
  // Configure bot options based on stage
  const botOptions: any = {};
  
  // Use test environment for dev stage
  if (process.env.STAGE === 'dev') {
    botOptions.telegram = {
      apiRoot: 'https://api.telegram.org/bot',
      testEnv: true
    };
    debugLog("Configuring bot for Telegram test environment");
  } else {
    debugLog("Configuring bot for Telegram production environment");
  }
  
  const bot = new Telegraf(Resource.TELEGRAM_BOT_TOKEN.value, botOptions);

  // Set up the /register command
  bot.command("register", async (ctx: Context) => {
    debugLog("Register command received", {
      messageText: ctx.message && 'text' in ctx.message ? ctx.message.text : undefined,
      userId: ctx.from?.id,
      chatId: ctx.chat?.id
    });

    const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
    if (!messageText) {
      await ctx.reply("Invalid message format");
      return;
    }

    const parts = messageText.split(" ");
    
    debugLog("Command parts parsed", { parts, length: parts.length });
    
    // Validate command format: /register [username] [token]
    if (parts.length !== 3) {
      debugLog("Invalid command format");
      await ctx.reply("Please use format: /register [username] [token]");
      return;
    }
    
    const [, username, token] = parts;
    
    console.log(`Registration attempt - Username: ${username}, Token: ${token.substring(0, 4)}...`);
    debugLog("Registration details", { username, tokenPrefix: token.substring(0, 4) });
    
    // Validate input parameters
    const validation = validateRegistrationInput(username, token);
    if (!validation.isValid) {
      debugLog("Input validation failed", { message: validation.message });
      await ctx.reply(validation.message);
      return;
    }
    
    try {
      // Call database stored procedure
      debugLog("Calling database registration");
      const result = await registerUser(username, token);
      
      debugLog("Database call completed", { success: result.success });
      
      await ctx.reply(result.message);
      
      if (result.success) {
        console.log(`User ${username} registered successfully`);
      }
      
    } catch (error) {
      console.error("Registration error:", error);
      debugLog("Registration failed", { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      await ctx.reply("Registration failed. Please check your credentials and try again.");
    }
  });

  // Add help command for testing
  bot.command("help", async (ctx: Context) => {
    debugLog("Help command received");
    await ctx.reply("Available commands:\n/register [username] [token] - Register your account");
  });

  // Add start command for testing
  bot.command("start", async (ctx: Context) => {
    debugLog("Start command received");
    await ctx.reply("Welcome! Use /help to see available commands.");
  });

  // Handle unknown commands
  bot.on("text", async (ctx: Context) => {
    const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
    debugLog("Unknown text message received", { text: messageText });
    await ctx.reply("Unknown command. Use /help to see available commands.");
  });

  return bot;
};

export const handler = async (event: SQSEvent) => {
  debugLog("Message consumer handler started", { 
    recordCount: event.Records.length,
    nodeEnv: process.env.NODE_ENV,
    stage: process.env.STAGE
  });

  try {
    // Initialize bot inside the handler
    const bot = setupBot();
    
    for (const record of event.Records) {
      debugLog("Processing SQS record", {
        messageId: record.messageId,
        body: record.body.substring(0, 100) + "..."
      });

      const update = JSON.parse(record.body);
      debugLog("Parsed Telegram update from SQS", update);
      
      // Process the message with Telegraf
      await bot.handleUpdate(update);
      debugLog("Successfully processed update with Telegraf");
    }
    
    debugLog("All records processed successfully");
    return { success: true };
  } catch (error) {
    console.error("Error processing message:", error);
    debugLog("Error in message consumer", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}; 