// Shared TypeScript types for the quick-grade project

export interface MLBTransaction {
  id: number;
  person: {
    id: number;
    fullName: string;
    link: string;
  };
  toTeam?: {
    id: number;
    name: string;
    link: string;
  };
  fromTeam?: {
    id: number;
    name: string;
    link: string;
  };
  date: string;
  effectiveDate?: string;
  resolutionDate?: string;
  typeCode: string;
  typeDesc: string;
  description: string;
}

export interface MLBTransactionsAPIResponse {
  copyright: string;
  transactions: MLBTransaction[];
}

export interface TeamHistoryRecord {
  MLBPlayer: number;
  Date: Date;
  MLBTeam: number;
  Description: string;
}

export interface CronNotificationConfig {
  jobName: string;
  stage: string;
  startTime: string;
  environment: 'local' | 'lambda';
}

export interface CronSuccessNotification extends CronNotificationConfig {
  additionalInfo?: Record<string, any>;
}

export interface CronErrorNotification extends CronNotificationConfig {
  error: Error;
}

export interface DateRange {
  startDate: string;
  endDate: string;
} 