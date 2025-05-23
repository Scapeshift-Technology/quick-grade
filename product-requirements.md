# Product Requirements Document: Serverless Telegram Bot

## 1. Project Overview

### 1.1 Vision
Build a highly scalable serverless Telegram bot using AWS Lambda and SST (Serverless Stack) that can be added to Telegram groups to process user interactions and integrate with an existing SQL Server database.

### 1.2 Current Scope (Stage 1)
- Implement **only** the `/register` command functionality
- Establish foundational serverless architecture
- Set up proper testing and deployment pipelines
- Prepare infrastructure for future command additions

### 1.3 Future Vision (Post Stage 1)
- Bot capable of reading and processing all messages in Telegram groups (not just commands)
- Additional commands for financial/betting tracking
- Privacy mode OFF to receive all group messages

## 2. Architecture & Technical Requirements

### 2.1 Infrastructure as Code (IaC)
- **Framework**: SST (Serverless Stack) v3
- **Cloud Provider**: AWS
- **Region**: us-east-1
- **Deployment Strategy**: Infrastructure as Code using TypeScript

### 2.2 Serverless Architecture Components

#### 2.2.1 Lambda Functions
1. **Webhook Handler** (`functions/webhook.ts`)
   - Receives POST requests from Telegram webhook
   - Validates and parses incoming messages
   - Forwards messages to SQS FIFO queue
   - Returns immediate response to Telegram (prevent timeouts)

2. **Message Consumer** (`functions/messageConsumer.ts`)
   - Processes messages from SQS queue
   - Handles bot commands using Telegraf library
   - Integrates with SQL Server database
   - Implements business logic for commands

#### 2.2.2 Message Queuing
- **Primary Queue**: SQS FIFO queue for ordered message processing
  - Ensures messages from each user are processed in order
  - Prevents race conditions in user interactions
  - `MessageGroupId`: User ID from Telegram
  - `MessageDeduplicationId`: Message ID from Telegram

#### 2.2.3 Database Integration
- **Database Type**: SQL Server (existing implementation)
- **Connection Strategy**: Stored procedures and SQL functions
- **Key Stored Procedure**: `dbo.PartyTelegramUser_REGISTER_tr`
- **Assumption**: All database operations are pre-implemented

### 2.3 Security & Configuration Management

#### 2.3.1 Environment Variables & Secrets
**Sensitive Data (Config.Secret)**:
- `TELEGRAM_BOT_TOKEN`: Bot authentication token from BotFather
- `DATABASE_CONNECTION_STRING`: SQL Server connection details

**Configuration (Config.Parameter)**:
- `AWS_REGION`: Deployment region (automatically handled by SST)

**Storage & Access**:
- Secrets stored in AWS Systems Manager (SSM) Parameter Store
- Encrypted at rest
- Function-level IAM permissions (principle of least privilege)
- Stage-specific configurations (`dev`, `prod`)

#### 2.3.2 Deployment Environments
- **Development/Staging**: Single AWS account for local development with SST live Lambda and testing
- **Production**: Separate AWS account for live deployment

## 3. Functional Requirements

### 3.1 Stage 1: User Registration

#### 3.1.1 Command: `/register [username] [token]`

**Purpose**: Allow users to register their external platform credentials with the Telegram bot

**Input Parameters**:
- `username`: User's identifier from external platform
- `token`: Authentication token acquired from separate platform

**Processing Flow**:
1. User sends `/register [username] [token]` in Telegram
2. Webhook receives message and forwards to SQS queue
3. Message consumer processes registration request
4. System calls `dbo.PartyTelegramUser_REGISTER_tr` stored procedure
5. Bot responds with success/failure message to user

**Validation Requirements**:
- Command format must be exactly `/register [username] [token]`
- Both username and token parameters are required
- Token validation handled by database stored procedure

**Response Messages**:
- Success: "Registration successful! Welcome [username]"
- Failure: "Registration failed. Please check your credentials and try again."
- Invalid format: "Please use format: /register [username] [token]"

### 3.2 Future Functionality (Post Stage 1)

#### 3.2.1 Group Message Processing
- Configure bot with Privacy Mode OFF
- Process all messages in group, not just commands
- Implement message parsing and keyword detection
- Maintain backward compatibility with command structure

#### 3.2.2 Additional Commands (Placeholder)
- Financial tracking commands
- Betting/partnership management
- Account management features

## 4. Non-Functional Requirements

### 4.1 Performance
- **Response Time**: Webhook must respond to Telegram within 5 seconds
- **Message Processing**: SQS ensures ordered processing per user
- **Scalability**: Auto-scaling Lambda functions based on demand
- **Concurrency**: Independent processing for different users

### 4.2 Reliability
- **Error Handling**: Basic error logging and monitoring
- **Monitoring**: CloudWatch logs and metrics
- **Alerting**: Notifications for system failures

### 4.3 Security
- **Token Storage**: Encrypted secrets in AWS SSM
- **Database Access**: Secure connection strings
- **IAM Permissions**: Least privilege access model
- **Input Validation**: Sanitize all user inputs

## 5. Testing Strategy

### 5.1 Local Development Testing
**Tools**: 
- SST Live Lambda Development (`pnpm sst dev`)
- Jest/Vitest for unit testing
- Mock frameworks for external dependencies

**Focus**:
- Unit tests for Lambda handlers
- Mock Telegram API interactions
- Mock database connections
- Input validation testing

### 5.2 Integration Testing (Development/Staging Environment)
**Setup**:
- Dedicated development/staging Telegram bot
- Development/staging AWS account deployment
- Development/staging database instance
- Separate development/staging secrets configuration

**Testing Scope**:
- Full message flow: Telegram → Webhook → SQS → Consumer → Database
- SQS monitoring
- Error handling verification
- Database integration validation

### 5.3 End-to-End Testing (Development/Staging Environment)
**Scenarios**:
- Complete user registration workflow
- Invalid command handling
- System failure recovery
- Message ordering verification

### 5.4 User Acceptance Testing (Development/Staging Environment)
**Process**:
- Limited group of test users
- Real-world usage scenarios
- Feedback collection and iteration
- Usability validation

### 5.5 Production Smoke Testing
**Scope**:
- Minimal functionality verification post-deployment
- Test registration with designated test accounts
- Quick sanity checks without extensive testing

## 6. Deployment & Operations

### 6.1 Deployment Process
```bash
# Local development
pnpm sst dev

# Development/Staging deployment
pnpm sst deploy --stage dev

# Production deployment
pnpm sst deploy --stage prod
```

### 6.2 Secret Management
```bash
# Set development/staging secrets
pnpm sst secrets set TELEGRAM_BOT_TOKEN "dev-bot-token" --stage dev
pnpm sst secrets set DATABASE_CONNECTION_STRING "dev-db-string" --stage dev

# Set production secrets
pnpm sst secrets set TELEGRAM_BOT_TOKEN "prod-bot-token" --stage prod
pnpm sst secrets set DATABASE_CONNECTION_STRING "prod-db-string" --stage prod
```

### 6.3 Telegram Webhook Configuration
```bash
# Set webhook URL after deployment
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<WEBHOOK_URL>"
```

### 6.4 Monitoring & Observability
- **CloudWatch Logs**: Function execution logs
- **CloudWatch Metrics**: Lambda performance metrics
- **SQS Metrics**: Queue depth and processing rates
- **SST Console**: Real-time development monitoring

## 7. Dependencies & Prerequisites

### 7.1 External Dependencies
- Existing SQL Server database with implemented stored procedures
- External platform for token generation
- AWS accounts (development/staging and production)
- Telegram Bot API access

### 7.2 Development Dependencies
```json
{
  "dependencies": {
    "@aws-sdk/client-sqs": "latest",
    "telegraf": "latest"
  },
  "devDependencies": {
    "@types/aws-lambda": "latest",
    "sst": "latest",
    "typescript": "latest"
  }
}
```

## 8. Success Criteria

### 8.1 Stage 1 Success Metrics
- [ ] Users can successfully register using `/register [username] [token]`
- [ ] Registration data is correctly stored in SQL Server database
- [ ] Bot responds appropriately to valid and invalid commands
- [ ] System handles failures gracefully with basic error logging
- [ ] All tests pass in development/staging environment
- [ ] Production deployment successful with smoke tests passing

### 8.2 Quality Gates
- [ ] Unit test coverage > 80%
- [ ] All integration tests pass in development/staging
- [ ] No critical security vulnerabilities
- [ ] Performance requirements met (< 5s response time)
- [ ] Successful UAT completion

## 9. Risk Assessment

### 9.1 Technical Risks
- **Database Connectivity**: SQL Server connection failures
- **Telegram API**: Rate limiting and API changes
- **AWS Service Limits**: Lambda concurrent execution limits
- **Message Ordering**: SQS FIFO queue constraints

### 9.2 Mitigation Strategies
- **Error Handling**: Comprehensive error logging and monitoring
- **Rate Limiting**: Implement backoff strategies
- **Monitoring**: Proactive alerting and monitoring
- **Testing**: Comprehensive testing at all levels

## 10. Implementation Roadmap

### Phase 1: Infrastructure Setup
1. Create SST project structure
2. Configure AWS accounts and credentials
3. Set up basic Lambda functions and SQS queues
4. Implement webhook handler

### Phase 2: Core Functionality
1. Implement message consumer with Telegraf
2. Add database integration for registration
3. Implement `/register` command processing
4. Add basic error handling and logging

### Phase 3: Testing & Validation
1. Set up local development environment
2. Deploy to development/staging and configure development/staging bot
3. Execute integration and E2E tests
4. Conduct user acceptance testing

### Phase 4: Production Deployment
1. Deploy to production environment
2. Configure production bot and webhook
3. Execute smoke tests
4. Monitor and validate production operation

### Phase 5: Future Enhancements (Post Stage 1)
1. Implement group message processing
2. Add additional commands
3. Enhance monitoring and alerting
4. Scale testing and deployment processes

---

**Document Version**: 1.0  
**Last Updated**: 5/22/2025
**Next Review**: After Stage 1 completion 