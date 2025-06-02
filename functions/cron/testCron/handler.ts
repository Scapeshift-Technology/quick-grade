import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { ScheduledEvent } from 'aws-lambda';
import sql from 'mssql';
// import { chromium } from 'playwright'; // Temporarily disabled
import { Resource } from 'sst';

const sns = new SNSClient({ region: 'us-east-1' });

async function scrapeNYTimesHeadline(): Promise<string> {
  // Temporarily disabled web scraping to resolve deployment issues
  console.log('Web scraping temporarily disabled - returning placeholder headline');
  return 'Web scraping feature temporarily disabled for deployment testing';
}

export const handler = async (event: ScheduledEvent) => {
  console.log('Cron event:', event);
  const startTime = new Date();
  
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
    const isLocal = !process.env.AWS_LAMBDA_FUNCTION_NAME;
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
    
    // Get headline (temporarily using placeholder)
    console.log('Starting NY Times headline scraping...');
    const headline = await scrapeNYTimesHeadline();
    console.log('NY Times headline scraping completed');
    
    // Send success notification with headline
    const successMessage = `Test cron job completed successfully!

Details:
- Job started at: ${easternTimeString} ET
- Database connection: Successful
- Record inserted: Yes
- Total records in _CronLogins table: ${recordCount}
- Stage: ${process.env.STAGE}
- Job name: ${process.env.CRON_JOB_NAME}

Today's NYT front page headline is: ${headline}

This is a test of the cron notification system.`;

    await sns.send(new PublishCommand({
      TopicArn: Resource.CronSuccessNotificationTopic.arn,
      Subject: "Test of cron SUCCESS notification",
      Message: successMessage,
    }));
    
    console.log('Success notification sent');
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Cron job completed successfully',
        recordCount: recordCount,
        startTime: easternTimeString,
        headline: headline
      })
    };
    
  } catch (error) {
    console.error('Error in cron job:', error);
    
    // Send error notification
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
    
    throw error;
  }
}; 