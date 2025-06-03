import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { ScheduledEvent } from 'aws-lambda';
import * as sql from 'mssql';
import { Resource } from 'sst';

const sns = new SNSClient({ region: 'us-east-1' });

/**
 * Applies monkey patching for package.json resolution.
 * Must be called before importing playwright-core in each invocation.
 */
function applyMonkeyPatching(): void {
    console.log('applyMonkeyPatching(): Applying monkey patching for package.json resolution');
    try {
        const fs = require('fs');

        // Check if we can access the Lambda filesystem
        console.log('applyMonkeyPatching(): Lambda filesystem contents (/var/task):');
        try { console.log(fs.readdirSync('/var/task')); } catch (e) { console.error('DEBUG: Error reading /var/task:', e); }
        console.log('applyMonkeyPatching(): Lambda filesystem contents (/tmp before write):');
        try { console.log(fs.readdirSync('/tmp')); } catch (e) { console.error('DEBUG: Error reading /tmp:', e); }

        // Try to create a mock package.json
        const mockPackagePath = '/tmp/package.json';
        // Check if file exists to avoid errors in rare concurrent scenarios (though unlikely in Lambda)
        if (!fs.existsSync(mockPackagePath)) {
            console.log(`applyMonkeyPatching(): Creating mock package.json at ${mockPackagePath}`);
            fs.writeFileSync(mockPackagePath, JSON.stringify({
                name: "playwright-core",
                version: "1.41.2" // Use a relevant version or keep as is
            }));
            console.log(`applyMonkeyPatching(): Mock package.json created.`);
        } else {
            console.log(`applyMonkeyPatching(): Mock package.json already exists at ${mockPackagePath}`);
        }

        const originalResolve = require.resolve;
        // @ts-ignore
        require.resolve = function(request, options) {
            // console.log(`DEBUG: require.resolve called with request: ${request}`); // Optional: keep for debug
            if (request === '../../../package.json') {
                // console.log(`DEBUG: Intercepted require.resolve for package.json, returning: ${mockPackagePath}`); // Optional
                return mockPackagePath;
            }
            // Handle cases where options might be passed
            if (options) {
                return originalResolve(request, options);
            }
            return originalResolve(request);
        };
        console.log('applyMonkeyPatching: Monkey patched require.resolve successfully.');
    } catch (error) {
        console.error('applyMonkeyPatching(): Error applying monkey patch:', error);
        // Depending on severity, might want to re-throw or handle
    }
}

async function scrapeHackerNewsTopStory(): Promise<string> {
  console.log('🚀 Starting Hacker News top story scraping...');
  
  try {
    // Detect if we're running locally vs in Lambda
    const isLocal = !process.env.AWS_LAMBDA_FUNCTION_NAME;
    console.log(`🌍 Running in ${isLocal ? 'LOCAL' : 'LAMBDA'} environment`);

    let chromium, executablePath;

    if (isLocal) {
      // Local environment - use system chromium, no monkey patching needed
      console.log('🏠 scrapeHackerNewsTopStory(): Using local chromium installation...');
      chromium = require('playwright').chromium;
      executablePath = undefined; // Use system default
    } else {
      // Lambda environment - apply monkey patching and use layer
      applyMonkeyPatching();

      // Import dependencies here
      console.log('☁️ scrapeHackerNewsTopStory(): Requiring chromium-for-lambda...');
      const chromiumForLambda = require('chromium-for-lambda');
      console.log('✅ scrapeHackerNewsTopStory(): Successfully required chromium-for-lambda.');

      console.log('☁️ scrapeHackerNewsTopStory(): Requiring playwright-core...');
      chromium = require('playwright-core').chromium;
      console.log('✅ scrapeHackerNewsTopStory(): Successfully required playwright-core.');

      if (!chromium || typeof chromium.launch !== 'function') {
           console.error('❌ scrapeHackerNewsTopStory(): FATAL - Chromium object or launch method is invalid after import.');
           throw new Error('Failed to correctly import playwright-core or chromium object.');
      }
      console.log('✅ scrapeHackerNewsTopStory(): Chromium object and launch function seem valid.');

      // Get the chromium executable path from the layer
      executablePath = chromiumForLambda.executablePath;
      console.log('📁 Using chromium executable:', executablePath);
      
      // Set LD_LIBRARY_PATH to help the loader find shared libraries
      const currentLdPath = process.env.LD_LIBRARY_PATH || '';
      const chromiumDir = require('path').dirname(executablePath);
      const newLdPath = chromiumDir + (currentLdPath ? ':' + currentLdPath : '');
      process.env.LD_LIBRARY_PATH = newLdPath;
      console.log(`📚 Updated LD_LIBRARY_PATH: ${process.env.LD_LIBRARY_PATH}`);
    }
    
    // Launch browser with appropriate configuration
    const launchOptions: any = {
      headless: !isLocal, // Run headed locally, headless in Lambda
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    };

    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    console.log('Launching browser with options:', JSON.stringify(launchOptions, null, 2));
    const browser = await chromium.launch(launchOptions);

    const page = await browser.newPage();
    
    // Set user agent to avoid blocking
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    
    console.log('Navigating to Hacker News...');
    await page.goto('https://news.ycombinator.com/', {
      waitUntil: 'networkidle',
      timeout: 30000 
    });

    console.log('Extracting top story title...');
    
    // Try multiple selectors for the top story title on Hacker News
    const titleSelectors = [
      'tr.athing:first-child .titleline > a:first-child',
      'tr.athing:first-child .storylink',
      'tr.athing:first-child td.title a',
      '.athing:first-child .titleline a',
      'table.itemlist tr.athing:first-child .title a'
    ];
    
    let topStoryTitle = null;
    
    for (const selector of titleSelectors) {
      try {
        const element = await page.locator(selector).first();
        if (await element.count() > 0) {
          topStoryTitle = await element.textContent();
          if (topStoryTitle && topStoryTitle.trim()) {
            console.log(`Found top story title using selector: ${selector}`);
            break;
          }
        }
      } catch (error) {
        console.log(`Selector ${selector} failed:`, (error as Error).message);
        continue;
      }
    }
    
    await browser.close();
    
    if (!topStoryTitle || !topStoryTitle.trim()) {
      console.log('No top story title found, using fallback');
      throw new Error('Unable to retrieve top story title - no title found using any selector');
    }
    
    const cleanTitle = topStoryTitle.trim();
    console.log('Successfully extracted top story title:', cleanTitle);
    return cleanTitle;
    
  } catch (error) {
    console.error('Error scraping Hacker News top story:', error);
    throw error; // Re-throw the original error instead of returning error string
  }
}

export const handler = async (event: ScheduledEvent) => {
  console.log('Cron event:', event);
  const startTime = new Date();
  
  // Detect if we're running locally vs in Lambda
  const isLocal = !process.env.AWS_LAMBDA_FUNCTION_NAME;
  console.log(`Handler running in ${isLocal ? 'LOCAL' : 'LAMBDA'} environment`);
  
  // Format start time as ISO string in Eastern Time
  const easternTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const parts = easternTime.formatToParts(startTime);
  const easternTimeString = `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}-${parts.find(p => p.type === 'day')?.value}T${parts.find(p => p.type === 'hour')?.value}:${parts.find(p => p.type === 'minute')?.value}:${parts.find(p => p.type === 'second')?.value}`;
  
  console.log(`Cron job started at: ${easternTimeString} ET`);
  
  try {
    // Connect to database using environment variable
    const connectionString = process.env.DATABASE_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error('DATABASE_CONNECTION_STRING environment variable is not set');
    }
    
    // Create connection pool
    const pool = new sql.ConnectionPool(connectionString);
    await pool.connect();
    
    console.log('Successfully connected to database');
    
    // Insert record into _CronLogins table
    const insertQuery = `
      INSERT INTO dbo._CronLogins (Dtm, Actor, Description) 
      VALUES (GETUTCDATE(), 'CronTest', @description)
    `;
    
    // Determine environment context for database logging
    const stage = process.env.STAGE || 'unknown';
    const environmentContext = isLocal 
      ? 'local-dev' 
      : `deployed-${stage}`;
    
    const insertRequest = pool.request();
    insertRequest.input('description', sql.VarChar, `cron job started at ${easternTimeString} from ${environmentContext} environment`);
    await insertRequest.query(insertQuery);
    
    console.log('Successfully inserted record into _CronLogins table');
    
    // Count records in _CronLogins table
    const countQuery = 'SELECT COUNT(1) as recordCount FROM dbo._CronLogins';
    const countResult = await pool.request().query(countQuery);
    const recordCount = countResult.recordset[0].recordCount;
    
    console.log(`Total records in _CronLogins table: ${recordCount}`);
    
    // Close connection
    await pool.close();
    
    console.log('Cron job completed successfully');
    
    // Get headline
    console.log('Starting Hacker News top story scraping...');
    const topStory = await scrapeHackerNewsTopStory();
    console.log('Hacker News top story scraping completed');
    
    // Send success notification (skip in local environment)
    if (!isLocal) {
      const successMessage = `Test cron job completed successfully!

Details:
- Job started at: ${easternTimeString} ET
- Database connection: Successful
- Record inserted: Yes
- Total records in _CronLogins table: ${recordCount}
- Stage: ${process.env.STAGE}
- Job name: ${process.env.CRON_JOB_NAME}

Today's top Hacker News story is: ${topStory}

This is a test of the cron notification system.`;

      await sns.send(new PublishCommand({
        TopicArn: Resource.CronSuccessNotificationTopic.arn,
        Subject: "Test of cron SUCCESS notification",
        Message: successMessage,
      }));
      
      console.log('Success notification sent');
    } else {
      console.log('🔄 Skipping SNS success notification (local environment)');
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Cron job completed successfully',
        recordCount: recordCount,
        startTime: easternTimeString,
        topStory: topStory,
        environment: isLocal ? 'local' : 'lambda'
      })
    };
    
  } catch (error) {
    console.error('Error in cron job:', error);
    
    // Send error notification (skip in local environment)
    if (!isLocal) {
      const errorMessage = `Test cron job failed with error!

Details:
- Job started at: ${easternTimeString} ET
- Stage: ${process.env.STAGE}
- Job name: ${process.env.CRON_JOB_NAME}
- Error: ${error instanceof Error ? error.message : String(error)}
- Stack trace: ${error instanceof Error ? error.stack : 'N/A'}

This is a test of the cron error notification system.`;

      try {
        await sns.send(new PublishCommand({
          TopicArn: Resource.CronErrorNotificationTopic.arn,
          Subject: "Test of cron ERROR notification",
          Message: errorMessage,
        }));
        console.log('Error notification sent');
      } catch (notificationError) {
        console.error('Failed to send error notification:', notificationError);
      }
    } else {
      console.log('🔄 Skipping SNS error notification (local environment)');
    }
    
    throw error;
  }
}; 