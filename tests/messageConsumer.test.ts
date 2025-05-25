import { registerUser, validateRegistrationInput } from '../functions/database';

// Mock the mssql module
jest.mock('mssql', () => ({
  connect: jest.fn(),
  Char: jest.fn((size) => ({ type: 'char', size })),
  BigInt: jest.fn(() => ({ type: 'bigint' }))
}));

// Mock the sst module
jest.mock('sst', () => ({
  Resource: {
    TELEGRAM_BOT_TOKEN: { value: 'test-bot-token' },
    DATABASE_CONNECTION_STRING: { value: 'Driver={ODBC Driver 18 for SQL Server};Server=tcp:test-server.database.windows.net,1433;Database=test-database;Uid=test-user;Pwd=test-password;Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;' }
  }
}));

// Import after mocking
import * as sql from 'mssql';
const mockConnect = sql.connect as jest.MockedFunction<any>;

describe('Registration Input Validation', () => {
  describe('validateRegistrationInput', () => {
    test('should pass validation for valid username and token', () => {
      const username = 'UsrUnder16ch';
      const token = 'TokenIsOkBecauseItsExactly32Char';   // 32 characters
      
      const result = validateRegistrationInput(username, token);
      
      expect(result.isValid).toBe(true);
    });

    test('should fail validation when username exceeds 32 characters', () => {
      const username = 'ThisUsernameTooLong';  // 19 characters
      const token = 'TokenIsOkBecauseItsExactly32Char';  // Valid token
      
      const result = validateRegistrationInput(username, token);
      
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.message).toBe('username is too long (max 16 chars)');
      }
    });

    test('should fail validation when token exceeds 32 characters', () => {
      const username = 'UsernameOK';  // Valid username
      const token = 'TokenIsUnder32Chars';
      
      const result = validateRegistrationInput(username, token);
      
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.message).toBe('token is not the expected length (32 chars)');
      }
    });

    test('should fail validation when both username and token exceed 32 characters', () => {
      const username = 'ThisUsernameIsTooLongExceeds32Chars';  // 35 characters
      const token = 'TokenIsNotExactly32CharsItsTooLong';  // 34 characters
      
      const result = validateRegistrationInput(username, token);
      
      expect(result.isValid).toBe(false);
      // Should fail on username first (order of validation)
      if (!result.isValid) {
        expect(result.message).toBe('username is too long (max 16 chars)');
      }
    });
  });
});

describe('Database Registration', () => {
  let mockPool: any;
  let mockRequest: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock objects
    mockRequest = {
      input: jest.fn().mockReturnThis(),
      execute: jest.fn()
    };
    
    mockPool = {
      request: jest.fn().mockReturnValue(mockRequest),
      connected: true,
      close: jest.fn()
    };
    
    // Mock sql.connect to return our mock pool
    (mockConnect as jest.MockedFunction<any>).mockResolvedValue(mockPool);
  });

  describe('registerUser', () => {
    test('should successfully register user with valid credentials', async () => {
      // Mock successful database execution
      mockRequest.execute.mockResolvedValue({ recordset: [] });
      
      const telegramUserId = 123456789;
      const result = await registerUser('testuser', 'testtoken', telegramUserId);
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Registration successful! Welcome testuser');
      
      // Verify database calls
      expect(mockConnect).toHaveBeenCalledWith('Driver={ODBC Driver 18 for SQL Server};Server=tcp:test-server.database.windows.net,1433;Database=test-database;Uid=test-user;Pwd=test-password;Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;');
      expect(mockPool.request).toHaveBeenCalled();
      expect(mockRequest.input).toHaveBeenCalledWith('Party', expect.anything(), 'testuser');
      expect(mockRequest.input).toHaveBeenCalledWith('Token', expect.anything(), 'testtoken');
      expect(mockRequest.input).toHaveBeenCalledWith('TelegramUser', expect.anything(), telegramUserId);
      expect(mockRequest.execute).toHaveBeenCalledWith('dbo.PartyTelegramUser_REGISTER_tr');
      expect(mockPool.close).toHaveBeenCalled();
    });

    test('should handle database connection failure', async () => {
      // Mock connection failure
      (mockConnect as jest.MockedFunction<any>).mockRejectedValue(new Error('Connection failed'));
      
      const telegramUserId = 123456789;
      const result = await registerUser('testuser', 'testtoken', telegramUserId);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Registration failed. Please check your credentials and try again.');
    });

    test('should handle stored procedure execution failure', async () => {
      // Mock successful connection but failed execution
      mockRequest.execute.mockRejectedValue(new Error('Stored procedure failed'));
      
      const telegramUserId = 123456789;
      const result = await registerUser('testuser', 'testtoken', telegramUserId);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Registration failed. Please check your credentials and try again.');
      expect(mockPool.close).toHaveBeenCalled();
    });
  });
});