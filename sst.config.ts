/// <reference path="./.sst/platform/config.d.ts" />

// Common cron schedule configuration
// All times specified in ET (Eastern Time) and converted to UTC for AWS EventBridge
// Using EDT offset (UTC-4): 8am ET = 12pm UTC (12:00), 8pm ET = 12am UTC (00:00)
// Note: AWS EventBridge doesn't auto-adjust for DST, so using EDT offset year-round
// AWS EventBridge format: minute hour day-of-month month day-of-week year
const commonSchedules = {
  testCron: "0 15 * * ? *",
  uploadMLBPlayerTeamHistory: "0 19 * * ? *", // Daily at noon ET (4pm UTC)
  // Future ESPN and Steamer schedules (kept for reference)
  // espnScrapers: "0 12,0 * * ? *", // 8am and 8pm ET = 12pm and 12am UTC (EDT offset)
  // steamerUpload: "30 12 * * ? *", // 8:30am ET = 12:30pm UTC (EDT offset)
};

// League-specific active seasons (kept for future ESPN scraper implementation)
const leagueSeasons = {
  cfb: { start: "08-01", end: "02-20" }, // Aug 1 to Feb 20
  nfl: { start: "08-01", end: "02-20" }, // Aug 1 to Feb 20
  cbb: { start: "11-01", end: "04-01" }, // Nov 1 to Apr 1
  nba: { start: "10-01", end: "06-30" }, // Oct 1 to June 30
  wnba: { start: "05-01", end: "10-31" }, // May 1 to Oct 31
  mlb: { start: "03-15", end: "11-15" }, // March 15 to Nov 15
};

// Helper function to get active season for leagues (kept for future use)
const getActiveSeasonForLeagues = (leagues: string[]) => {
  // For multiple leagues, use the first league's season (NFL/CFB share the same season)
  return leagueSeasons[leagues[0] as keyof typeof leagueSeasons];
};

// Base cron job configuration - simplified for now
const baseCronConfig = {
  testCron: {
    schedule: commonSchedules.testCron,
    enabled: true
  },
  uploadMLBPlayerTeamHistory: {
    schedule: commonSchedules.uploadMLBPlayerTeamHistory,
    enabled: true
  },
  // Future ESPN and Steamer configurations (commented out for now)
  /*
  espnScraperNFLCFB: {
    schedule: commonSchedules.espnScrapers,
    leagues: ["cfb", "nfl"],
    activeSeason: getActiveSeasonForLeagues(["cfb", "nfl"]),
    enabled: true
  },
  espnScraperCBK: {
    schedule: commonSchedules.espnScrapers,
    leagues: ["cbb"],
    activeSeason: getActiveSeasonForLeagues(["cbb"]),
    enabled: true
  },
  espnScraperNBA: {
    schedule: commonSchedules.espnScrapers,
    leagues: ["nba"],
    activeSeason: getActiveSeasonForLeagues(["nba"]),
    enabled: true
  },
  espnScraperWNBA: {
    schedule: commonSchedules.espnScrapers,
    leagues: ["wnba"],
    activeSeason: getActiveSeasonForLeagues(["wnba"]),
    enabled: true
  },
  espnScraperMLB: {
    schedule: commonSchedules.espnScrapers,
    leagues: ["mlb"],
    activeSeason: getActiveSeasonForLeagues(["mlb"]),
    enabled: true
  },
  steamerUpload: {
    schedule: commonSchedules.steamerUpload,
    enabled: true
  }
  */
};

// Cron job configuration - same configuration for all environments
const cronConfig = {
  dev: baseCronConfig,
  prod: baseCronConfig
};

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
    const stage = $app.stage as 'dev' | 'prod';
    const config = cronConfig[stage];
    
    // Create secrets for sensitive data
    const TELEGRAM_BOT_TOKEN = new sst.Secret("TELEGRAM_BOT_TOKEN");
    const DATABASE_CONNECTION_STRING_TELEGRAM_BOT = new sst.Secret("DATABASE_CONNECTION_STRING_TELEGRAM_BOT");
    
    // Create database connection secret for cron test
    const DATABASE_CONNECTION_STRING_CRON_TEST = new sst.Secret("DATABASE_CONNECTION_STRING_CRON_TEST");
    
    // Create database connection secret for persister (shared by new cron functions)
    const DATABASE_CONNECTION_STRING_PERSISTER = new sst.Secret("DATABASE_CONNECTION_STRING_PERSISTER");
    
    // Create proxy secrets for cron test
    const PROXY_USER = new sst.Secret("PROXY_USER");
    const PROXY_PASS = new sst.Secret("PROXY_PASS");
    const PROXY_HOST_PORT = new sst.Secret("PROXY_HOST_PORT");
    
    // Future secrets (commented out for now)
    /*
    const DATABASE_CONNECTION_STRING_ESPN_SCRAPER = new sst.Secret("DATABASE_CONNECTION_STRING_ESPN_SCRAPER");
    const DATABASE_CONNECTION_STRING_STEAMER_UPLOAD = new sst.Secret("DATABASE_CONNECTION_STRING_STEAMER_UPLOAD");
    const STEAMER_USR = new sst.Secret("STEAMER_USR");
    const STEAMER_PW = new sst.Secret("STEAMER_PW");
    */
    const CHROMIUM_LAYER_ARN = new sst.Secret("CHROMIUM_LAYER_ARN");
    
    // Create SNS topics for notifications - emails can be subscribed manually in AWS Console
    const cronErrorNotificationTopic = new sst.aws.SnsTopic("CronErrorNotificationTopic");
    const cronSuccessNotificationTopic = new sst.aws.SnsTopic("CronSuccessNotificationTopic");
    
    // Create the message queue for handling messages in order
    const messageQueue = new sst.aws.Queue("MessageQueue", {
      fifo: true, // FIFO ensures messages are processed in order
    });
    
    // Create the message consumer function
    const messageConsumer = new sst.aws.Function("MessageConsumer", {
      handler: "functions/messageConsumer.handler",
      architecture: "arm64",
      link: [TELEGRAM_BOT_TOKEN, DATABASE_CONNECTION_STRING_TELEGRAM_BOT, messageQueue],
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
      architecture: "arm64",
      link: [messageQueue],
      url: true, // Creates a function URL
      environment: {
        NODE_ENV: $app.stage === "prod" ? "production" : "development",
        STAGE: $app.stage,
      },
    });
    
    // Test Cron Job - Simple database connectivity test
    const testCron = new sst.aws.Cron("TestCron", {
      schedule: stage === 'prod' ? `cron(${config.testCron.schedule})` : 'cron(0 0 30 2 ? *)',
      job: {
        handler: "functions/cron/testCron/handler.handler",
        architecture: "arm64",
        nodejs: {
          format: "cjs",
          esbuild: {
            target: "node20",
            format: "cjs",
            platform: "node"
          }
        },
        layers: [CHROMIUM_LAYER_ARN.value],
        timeout: "1 minutes",
        memory: "8192 MB",
        link: [
          DATABASE_CONNECTION_STRING_PERSISTER,
          cronErrorNotificationTopic,
          cronSuccessNotificationTopic,
          PROXY_USER,
          PROXY_PASS,
          PROXY_HOST_PORT
        ],
        environment: {
          NODE_ENV: $app.stage === "prod" ? "production" : "development",
          STAGE: $app.stage,
          CRON_JOB_NAME: "test-cron",
          DEBUG: "pw:api",
          DATABASE_CONNECTION_STRING: DATABASE_CONNECTION_STRING_CRON_TEST.value,
          PROXY_USER: PROXY_USER.value,
          PROXY_PASS: PROXY_PASS.value,
          PROXY_HOST_PORT: PROXY_HOST_PORT.value
        },
      },
    });
    
    // MLB Player Team History Upload Cron Job
    const uploadMLBPlayerTeamHistoryCron = new sst.aws.Cron("UploadMLBPlayerTeamHistoryCron", {
      schedule: stage === 'prod' ? `cron(${config.uploadMLBPlayerTeamHistory.schedule})` : 'cron(0 0 30 2 ? *)',
      job: {
        handler: "functions/cron/uploadMLBPlayerTeamHistory/handler.handler",
        architecture: "arm64",
        nodejs: {
          format: "cjs",
          esbuild: {
            target: "node20",
            format: "cjs",
            platform: "node"
          }
        },
        timeout: "5 minutes",
        memory: "1024 MB",
        link: [
          DATABASE_CONNECTION_STRING_PERSISTER,
          cronErrorNotificationTopic,
          cronSuccessNotificationTopic,
        ],
        environment: {
          NODE_ENV: $app.stage === "prod" ? "production" : "development",
          STAGE: $app.stage,
          CRON_JOB_NAME: "upload-mlb-player-team-history",
        },
      },
    });
    
    // Future ESPN and Steamer cron jobs (commented out for now)
    /*
    const espnScraperNFLCFBCron = new sst.aws.Cron("EspnScraperNFLCFBCron", {
      schedule: `cron(${config.espnScraperNFLCFB.schedule})`,
      job: {
        handler: "handler.handler",
        bundle: "functions/cron/espnScraper",
        architecture: "arm64",
        link: [
          DATABASE_CONNECTION_STRING_ESPN_SCRAPER,
          cronErrorNotificationTopic,
          cronSuccessNotificationTopic
        ],
        layers: [CHROMIUM_LAYER_ARN.value],
        timeout: "15 minutes",
        memory: "2048 MB",
        environment: {
          NODE_ENV: $app.stage === "prod" ? "production" : "development",
          STAGE: $app.stage,
          CRON_JOB_NAME: "espn-scraper-nflcfb",
          ESPN_LEAGUES: JSON.stringify(config.espnScraperNFLCFB.leagues),
          ESPN_ACTIVE_SEASON_START: config.espnScraperNFLCFB.activeSeason.start,
          ESPN_ACTIVE_SEASON_END: config.espnScraperNFLCFB.activeSeason.end,
          MAX_SIMULTANEOUS_PAGES: "3",
          PLAYWRIGHT_HEADED: "false"
        },
      },
    });
    
    // ... other ESPN scrapers and Steamer upload cron jobs would go here
    */
    
    // Return outputs
    return {
      webhookUrl: webhook.url,
      messageQueueUrl: messageQueue.url,
      testCronSchedule: config.testCron.schedule,
      uploadMLBPlayerTeamHistorySchedule: config.uploadMLBPlayerTeamHistory.schedule,
      cronErrorTopicArn: cronErrorNotificationTopic.arn,
      cronSuccessTopicArn: cronSuccessNotificationTopic.arn,
      // Future outputs (commented out for now)
      /*
      espnScraperNFLCFBSchedule: config.espnScraperNFLCFB.schedule,
      espnScraperCBKSchedule: config.espnScraperCBK.schedule,
      espnScraperNBASchedule: config.espnScraperNBA.schedule,
      espnScraperWNBASchedule: config.espnScraperWNBA.schedule,
      espnScraperMLBSchedule: config.espnScraperMLB.schedule,
      steamerUploadSchedule: config.steamerUpload.schedule,
      chromiumLayerArn: CHROMIUM_LAYER_ARN.value,
      */
    };
  },
});
