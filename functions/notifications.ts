import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { Resource } from 'sst';
import { CronErrorNotification, CronSuccessNotification } from './types';

const sns = new SNSClient({ region: 'us-east-1' });

/**
 * Send success notification for cron jobs
 */
export async function sendCronSuccessNotification(
  notification: CronSuccessNotification
): Promise<void> {
  // Skip notifications in local environment
  if (notification.environment === 'local') {
    console.log('🔄 Skipping SNS success notification (local environment)');
    return;
  }

  const { jobName, stage, startTime, additionalInfo } = notification;
  
  let message = `${jobName} completed successfully!

Details:
- Job started at: ${startTime}
- Stage: ${stage}
- Environment: ${notification.environment}`;

  // Add additional info if provided
  if (additionalInfo) {
    message += '\n\nAdditional Information:';
    for (const [key, value] of Object.entries(additionalInfo)) {
      message += `\n- ${key}: ${value}`;
    }
  }

  message += '\n\nThis is an automated notification from the cron system.';

  try {
    await sns.send(new PublishCommand({
      TopicArn: Resource.CronSuccessNotificationTopic.arn,
      Subject: `SUCCESS: ${jobName}`,
      Message: message,
    }));
    
    console.log('✅ Success notification sent');
  } catch (error) {
    console.error('❌ Failed to send success notification:', error);
    // Don't throw - we don't want notification failures to break the main job
  }
}

/**
 * Send error notification for cron jobs
 */
export async function sendCronErrorNotification(
  notification: CronErrorNotification
): Promise<void> {
  // Skip notifications in local environment
  if (notification.environment === 'local') {
    console.log('🔄 Skipping SNS error notification (local environment)');
    return;
  }

  const { jobName, stage, startTime, error } = notification;
  
  const message = `${jobName} failed with error!

Details:
- Job started at: ${startTime}
- Stage: ${stage}
- Environment: ${notification.environment}
- Error: ${error.message}
- Stack trace: ${error.stack || 'N/A'}

This is an automated notification from the cron system.`;

  try {
    await sns.send(new PublishCommand({
      TopicArn: Resource.CronErrorNotificationTopic.arn,
      Subject: `ERROR: ${jobName}`,
      Message: message,
    }));
    
    console.log('📧 Error notification sent');
  } catch (notificationError) {
    console.error('❌ Failed to send error notification:', notificationError);
    // Don't throw - we don't want notification failures to compound the original error
  }
}

/**
 * Utility function to get environment type
 */
export function getEnvironmentType(): 'local' | 'lambda' {
  return !process.env.AWS_LAMBDA_FUNCTION_NAME ? 'local' : 'lambda';
}

/**
 * Utility function to format Eastern Time timestamp
 */
export function formatEasternTime(date: Date): string {
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
  
  const parts = easternTime.formatToParts(date);
  return `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}-${parts.find(p => p.type === 'day')?.value}T${parts.find(p => p.type === 'hour')?.value}:${parts.find(p => p.type === 'minute')?.value}:${parts.find(p => p.type === 'second')?.value}`;
} 