import type { ScheduledEvent } from 'aws-lambda';
import { logCronExecution } from '../../database';
import {
  formatEasternTime,
  getEnvironmentType,
  sendCronErrorNotification,
  sendCronSuccessNotification
} from '../../notifications';

async function scrapeHackerNewsTopStory(): Promise<string> {
  console.log('🚀 Starting Hacker News top story scraping...');
  
  try {
    // Detect if we're running locally vs in Lambda
    const isLocal = !process.env.AWS_LAMBDA_FUNCTION_NAME;
    console.log(`🌍 Running in ${isLocal ? 'LOCAL' : 'LAMBDA'} environment`);

    let puppeteer, executablePath, chromiumModule;

    if (isLocal) {
      // Local environment - use system puppeteer with bundled chromium
      console.log('🏠 Using local puppeteer installation...');
      puppeteer = require('puppeteer');
      executablePath = undefined; // Use bundled Chromium from puppeteer
    } else {
      // Lambda environment - use Sparticuz chromium from layer
      console.log('☁️ Using Sparticuz chromium from layer...');
      
      try {
        // @ts-ignore - Sparticuz chromium is available in the layer
        const chromiumPackage = await import('@sparticuz/chromium');
        chromiumModule = chromiumPackage.default || chromiumPackage;
        puppeteer = require('puppeteer-core');
        
        console.log('📋 Chromium package keys:', Object.keys(chromiumPackage));
        console.log('📋 Chromium module keys:', Object.keys(chromiumModule));
        
        // Use the official Sparticuz method to get the executable path
        console.log('🔍 Getting executable path from Sparticuz chromium...');
        executablePath = await chromiumModule.executablePath();
        console.log('📁 Successfully got chromium executable path:', executablePath);
        
      } catch (error) {
        console.error('❌ Failed to import or use chromium from layer:', error);
        throw new Error(`Failed to setup Sparticuz chromium: ${(error as Error).message}`);
      }
      
      console.log('📁 Final chromium executable path:', executablePath);
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
      console.log('ℹ️ Proxy host port:', proxyHostPort);
      console.log('ℹ️ Proxy user:', proxyUser);
      console.log('ℹ️ Proxy pass is set? = ', !!proxyPass);
    }

    // Perform curl IP check if proxy is configured
    if (proxyUser && proxyPass && proxyHostPort) {
      console.log('🕵️‍♂️ Performing IP check with curl via proxy...');
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
        const curlError = e as any;
        console.error('Error executing curl IP check command:');
        if (curlError instanceof Error) {
          console.error('Message:', curlError.message);
        } else {
          console.error('Raw error:', curlError);
        }
        if (typeof curlError.stdout === 'string' || Buffer.isBuffer(curlError.stdout)) {
            console.error('Curl stdout on error:', curlError.stdout.toString());
        }
        if (typeof curlError.stderr === 'string' || Buffer.isBuffer(curlError.stderr)) {
            console.error('Curl stderr on error:', curlError.stderr.toString());
        }
      }
    } else {
      console.log('ℹ️ Skipping curl IP check as proxy is not configured.');
    }

    const baseLaunchOptions: any = {
      headless: !isLocal,
      args: isLocal ? [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--disable-gpu',
      ] : [
        ...chromiumModule.args,
        '--hide-scrollbars',
        '--disable-web-security',
      ]
    };

    if (executablePath) {
      baseLaunchOptions.executablePath = executablePath;
    }

    console.log('Launching browser with base options:', JSON.stringify(baseLaunchOptions, null, 2));
    let browser: any = null;

    try {
      browser = await puppeteer.launch(baseLaunchOptions);
      const page = await browser.newPage();

      // Set user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      console.log('Navigating to about:blank...');
      await page.goto('about:blank');
      console.log('Successfully navigated to about:blank.');
      
      // Check IP address
      try {
        console.log('Checking IP address via https://api.ipify.org?format=json...');
        
        await page.goto('https://api.ipify.org?format=json', { waitUntil: 'networkidle0' });

        const responseBody = await page.content();
        console.log('Raw IP data response body:', responseBody);
        
        // Extract JSON from the page content
        const bodyElement = await page.$('body');
        const ipDataText = await page.evaluate((element: any) => element.textContent, bodyElement);
        
        try {
          const ip_data_rsp_json = JSON.parse(ipDataText);
          console.log('IP data response (JSON):', ip_data_rsp_json);
        } catch (jsonError) {
          console.error('Failed to parse IP data response as JSON:', jsonError);
          console.error('Raw response body that failed to parse:', ipDataText);
        }

      } catch (error) {
        console.error('Error checking IP address:', error);
      }
      
      console.log('Navigating to Hacker News...');
      await page.goto('https://news.ycombinator.com/', { waitUntil: 'networkidle0' });

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
          const element = await page.$(selector);
          if (element) {
            topStoryTitle = await page.evaluate((el: any) => el.textContent, element);
            if (topStoryTitle && topStoryTitle.trim()) {
              console.log(`Found top story title using selector: ${selector}`);
              break;
            }
          }
        } catch (error) {
          console.log(`Selector ${selector} failed:`, (error as Error).message);
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
      console.error('Error during Puppeteer operations:', error);
      throw error;
    } finally {
      console.log('Ensuring browser is closed in finally block...');
      if (browser) {
        try {
          console.log('Attempting to close browser...');
          await browser.close();
          console.log('Browser closed.');
        } catch (browserCloseError) {
          console.error('Error closing browser:', browserCloseError);
        }
      } else {
        console.log('No browser object to close.');
      }
    }
  } catch (error) {
    console.error('Error in scrapeHackerNewsTopStory (outer catch):', error);
    throw error; 
  }
}

export const handler = async (event: ScheduledEvent) => {
  console.log('Cron event:', event);
  const startTime = new Date();
  const environment = getEnvironmentType();
  const easternTimeString = formatEasternTime(startTime);
  
  console.log(`Handler running in ${environment.toUpperCase()} environment`);
  console.log(`Cron job started at: ${easternTimeString} ET`);
  
  try {
    // Log cron execution using the new shared function
    await logCronExecution(easternTimeString, environment);
    console.log(`Successfully logged cron execution for ${process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.CRON_JOB_NAME }`);
    
    // Get headline
    console.log('Starting Hacker News top story scraping...');
    const topStory = await scrapeHackerNewsTopStory();
    console.log('Hacker News top story scraping completed');
    
    // Send success notification using shared module
    await sendCronSuccessNotification({
      jobName: 'test-cron',
      stage: process.env.STAGE || 'unknown',
      startTime: easternTimeString,
      environment,
      additionalInfo: {
        'Database connection': 'Successful',
        'Record inserted': 'Yes',
        'Top Hacker News story': topStory
      }
    });
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Cron job completed successfully',
        startTime: easternTimeString,
        topStory: topStory,
        environment
      })
    };
    
  } catch (error) {
    console.error('Error in cron job:', error);
    
    // Send error notification using shared module
    await sendCronErrorNotification({
      jobName: 'test-cron',
      stage: process.env.STAGE || 'unknown',
      startTime: easternTimeString,
      environment,
      error: error instanceof Error ? error : new Error(String(error))
    });
    
    throw error;
  }
}; 