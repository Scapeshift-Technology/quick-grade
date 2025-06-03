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
                console.log(`DEBUG: Intercepted require.resolve for package.json, returning: ${mockPackagePath}`); // Optional
                console.log(`INFO: Intercepted require.resolve for package.json, returning: ${mockPackagePath}`); // Optional
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

      try {
        const playwrightCorePackageJson = require('playwright-core/package.json');
        console.log('ℹ️ Actual playwright-core package.json from node_modules:', JSON.stringify(playwrightCorePackageJson, null, 2));
        console.log(`ℹ️ Actual playwright-core version from node_modules: ${playwrightCorePackageJson.version}`);
      } catch (e) {
        console.warn('⚠️ Could not read playwright-core/package.json to determine version.', e);
      }

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
      console.log('📚 Current LD_LIBRARY_PATH:', currentLdPath);
      const chromiumDir = require('path').dirname(executablePath);
      console.log('📚 Chromium directory:', chromiumDir);
      const newLdPath = chromiumDir + (currentLdPath ? ':' + currentLdPath : '');
      process.env.LD_LIBRARY_PATH = newLdPath;
      console.log(`📚 Updated LD_LIBRARY_PATH: ${process.env.LD_LIBRARY_PATH}`);
      
      // list contents of LD_LIBRARY_PATH
      console.log('📚 Verifying contents of LD_LIBRARY_PATH directories:');
      const fs = require('fs');
      const path = require('path');
      const ldPaths = process.env.LD_LIBRARY_PATH?.split(':') || [];
      for (const p of ldPaths) {
        if (p) { // Ensure path is not empty
          try {
            console.log(`Contents of ${p}:`);
            const files = fs.readdirSync(p);
            console.log(files.join(', '));
          } catch (e) {
            console.error(`Error reading directory ${p}:`, (e as Error).message);
          }
        }
      }
      
    }
    
    const { execSync } = require('child_process');
    
    // Optional: Configure proxy if environment variables are set
    const proxyUser = process.env.PROXY_USER;
    const proxyPass = process.env.PROXY_PASS;
    const proxyHostPort = process.env.PROXY_HOST_PORT;

    if (proxyUser && proxyPass && proxyHostPort) {
      console.log(`🔐 Using proxy authentication for user: ${proxyUser}`);
      console.log(`🌐 Using proxy server: ${proxyHostPort}`);
    } else {
      console.log('ℹ️ No proxy configuration found or proxy environment variables are incomplete. Proceeding without proxy.');
    }

    // Perform curl IP check if proxy is configured
    if (proxyUser && proxyPass && proxyHostPort) {
      console.log('🕵️‍♂️ Performing IP check with curl via proxy...');
      // Target URL for curl IP check (using a simple JSON IP echo service)
      const curlTargetUrl = 'https://api.ipify.org?format=json'; 
      const curlCommand = `curl --silent --connect-timeout 10 -x "${proxyHostPort}" -U "${proxyUser}:${proxyPass}" "${curlTargetUrl}"`;
      console.log(`Executing curl command: ${curlCommand.slice(0, 80)}...`);
      try {
        const curlOutput = execSync(curlCommand, { encoding: 'utf-8' });
        console.log('Curl IP check raw output:', curlOutput);
        try {
          const curlJson = JSON.parse(curlOutput);
          console.log('Curl IP check JSON response:', curlJson);
        } catch (parseError) {
          console.error('Failed to parse curl IP check output as JSON:', parseError);
          console.error('Curl raw output that failed to parse:', curlOutput);
        }
      } catch (e) {
        const curlError = e as any; // Cast to any to access potential properties
        console.error('Error executing curl IP check command:');
        if (curlError instanceof Error) {
          console.error('Message:', curlError.message);
        } else {
          console.error('Raw error:', curlError);
        }
        // For errors from execSync, stdout and stderr might be on the error object
        if (typeof curlError.stdout === 'string' || Buffer.isBuffer(curlError.stdout)) {
            console.error('Curl stdout on error:', curlError.stdout.toString());
        }
        if (typeof curlError.stderr === 'string' || Buffer.isBuffer(curlError.stderr)) {
            console.error('Curl stderr on error:', curlError.stderr.toString());
        }
        // Decide if this should be fatal. For now, log and continue to Playwright test.
      }
    } else {
      console.log('ℹ️ Skipping curl IP check as proxy is not configured.');
    }

    const baseLaunchOptions: any = {
      headless: !isLocal,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--disable-gpu',
      ]
    };

    if (executablePath) {
      baseLaunchOptions.executablePath = executablePath;
    }

    console.log('Launching browser with base options:', JSON.stringify(baseLaunchOptions, null, 2));
    let browser: any = null;
    let browserContext: any = null;

    try {
      browser = await chromium.launch(baseLaunchOptions);

      let page;

      if (proxyUser && proxyPass && proxyHostPort) {
        console.log(`🔐 Proxy environment variables are set. User: ${proxyUser}, Host/Port: ${proxyHostPort}`);
        console.log('ℹ️ Forcing Playwright to run WITHOUT proxy for this test run, to isolate browser context issues.');
        // Temporarily disable passing proxy to newContext for testing
        // browserContext = await browser.newContext({
        //   proxy: {
        //     server: proxyHostPort,
        //     username: proxyUser,
        //     password: proxyPass
        //   }
        // });
        // console.log('Creating new page from (supposedly proxied but now unproxied) context...');
        // page = await browserContext.newPage(); 
        // Fall through to default context creation for this test
        console.log('Creating new page from default (unproxied) browser context for this test run...');
        browserContext = await browser.newContext(); // Create a default context
        page = await browserContext.newPage();

      } else {
        console.log('ℹ️ No proxy environment variables set. Creating new page from default browser context.');
        browserContext = await browser.newContext(); // Create a default context
        page = await browserContext.newPage();
      }

      // Listen for page crash events
      page.on('crash', () => {
        console.error('❌ Page crashed!');
      });
      
      console.log('Navigating to about:blank...');
      // Test with about:blank first
      try {
        console.log('Attempting to navigate to about:blank...');
        await page.goto('about:blank');
        console.log('Successfully navigated to about:blank.');
      } catch (e) {
        console.error('Failed to navigate to about:blank:', e);
        await browser.close(); // Ensure browser is closed on preliminary failure
        throw e; // Re-throw to indicate critical failure
      }
      
      // Check IP address
      try {
        console.log('Checking IP address via https://api.ipify.org?format=json...');
        
        // Temporarily set Accept-Encoding to request uncompressed content
        await page.setExtraHTTPHeaders({ 'Accept-Encoding': 'identity' });

        const ip_data_rsp = await page.goto('https://api.ipify.org?format=json', {
          waitUntil: 'commit',
          timeout: 30000 // Increased timeout to 30 seconds
        });

        if (!ip_data_rsp) {
          console.error('Failed to get a response object from IP check service');
          throw new Error('No response object from IP check service');
        }
        
        // Try to get headers first
        try {
          const headers = ip_data_rsp.headers();
          console.log('IP data response headers:', JSON.stringify(headers, null, 2));
        } catch (headerError) {
          console.error('Error getting IP data response headers:', headerError);
          // If headers fail, the body will likely fail too. We might want to throw here.
        }

        const responseBody = await ip_data_rsp.text();
        console.log('Raw IP data response body:', responseBody);
        
        // Reset extra HTTP headers after the request so it doesn't affect subsequent navigations
        await page.setExtraHTTPHeaders({});

        try {
          const ip_data_rsp_json = JSON.parse(responseBody);
          console.log('IP data response (JSON):', ip_data_rsp_json);
        } catch (jsonError) {
          console.error('Failed to parse IP data response as JSON:', jsonError);
          console.error('Raw response body that failed to parse:', responseBody);
          throw new Error('Failed to parse IP data from IP check service as JSON.');
        }

      } catch (error) {
        console.error('Error checking IP address:', error);
        // Reset extra HTTP headers in case of an error too, to be safe for subsequent operations if any
        await page.setExtraHTTPHeaders({}); 
        // No: throw error; // Making IP check non-fatal again as main issue is page creation with proxy
      }
      
      // Set user agent for Hacker News (original User-Agent setting)
      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      });
      
      console.log('Navigating to Hacker News...');
      await page.goto('https://news.ycombinator.com/', {
        waitUntil: 'domcontentloaded',
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
      console.error('Error during Playwright operations (e.g., page creation, navigation, scraping):', error);
      throw error; // Re-throw to be caught by the outermost catch
    } finally {
      console.log('Ensuring browser and context are closed in finally block...');
      if (browserContext) {
        try {
          console.log('Attempting to close browser context...');
          await browserContext.close();
          console.log('Browser context closed.');
        } catch (contextCloseError) {
          console.error('Error closing browser context:', contextCloseError);
        }
      }
      if (browser && browser.isConnected()) {
        try {
          console.log('Attempting to close browser...');
          await browser.close();
          console.log('Browser closed.');
        } catch (browserCloseError) {
          console.error('Error closing browser:', browserCloseError);
        }
      } else if (browser) {
        console.log('Browser object exists but is not connected. Skipping close attempt.');
      } else {
        console.log('No browser object to close.');
      }
    }
  } catch (error) {
    // This outer catch is for errors like chromium.launch() failing or other setup issues
    // or errors re-thrown from the inner Playwright operations block
    console.error('Error in scrapeHackerNewsTopStory (outer catch):', error);
    // Note: browser closing is handled in the finally block of the inner try
    throw error; 
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