# Chromium Layer for AWS Lambda

This directory contains the Chromium browser layer for AWS Lambda functions that use Playwright.

## Files

- `layer.zip` - Pre-built Chromium layer (checked into source control)
- `upload-layer.sh` - Script to upload layer.zip to AWS Lambda layers
- `README.md` - This file

## Manual Layer Upload Workflow

The layer is uploaded manually before deployment using AWS SSO profiles. This follows SST best practices with separate AWS accounts per stage.

### Prerequisites

1. **AWS SSO Setup**: Configure AWS SSO profiles
   ```bash
   # Configure profiles (one-time setup)
   aws configure sso --profile quick-grade-dev
   aws configure sso --profile quick-grade-prod
   ```

2. **Working layer.zip**: The layer.zip should contain the `chromium-for-lambda` package structure:
   ```
   layer.zip
   └── nodejs/
       └── node_modules/
           └── chromium-for-lambda/
               ├── index.js
               ├── package.json
               └── chrome-headless-shell-linux64/
                   └── headless_shell (166MB binary)
   ```

### Upload Process

1. **Login to AWS SSO**:
   ```bash
   # For dev environment
   aws sso login --profile quick-grade-dev
   
   # For prod environment  
   aws sso login --profile quick-grade-prod
   ```

2. **Upload the layer**:
   ```bash
   # Upload to dev
   ./layers/chromium/upload-layer.sh --profile quick-grade-dev
   
   # Upload to prod
   ./layers/chromium/upload-layer.sh --profile quick-grade-prod
   ```

3. **Set the layer ARN as a secret**:
   ```bash
   # Copy the ARN from upload script output, then:
   sst secret set CHROMIUM_LAYER_ARN "arn:aws:lambda:us-east-1:123456789012:layer:chromium-for-lambda-quick-grade:1" --stage dev
   
   # Or for prod:
   sst secret set CHROMIUM_LAYER_ARN "arn:aws:lambda:us-east-1:123456789012:layer:chromium-for-lambda-quick-grade:1" --stage prod
   ```

4. **Deploy your application**:
   ```bash
   sst deploy --stage dev
   # or
   sst deploy --stage prod
   ```

### CI/CD Integration

The GitHub Actions workflows no longer handle layer upload. The deployment assumes the layer is already uploaded and the ARN is set as a secret.

**Before pushing to main/develop**:
1. Upload layer to appropriate environment
2. Set CHROMIUM_LAYER_ARN secret  
3. Push code (deployment will use existing layer)

## Layer Contents

The layer contains:
- Complete `chromium-for-lambda` NPM package structure
- Chromium browser binary (166MB) compatible with AWS Lambda arm64
- Required shared libraries and dependencies
- Proper executable permissions

## Version Management

- Layer versions are managed by AWS Lambda (auto-incrementing)
- Upload a new layer version when:
  - `chromium-for-lambda` structure changes
  - Lambda runtime compatibility updates needed
  - Binary optimizations are made

## Troubleshooting

### AWS SSO Issues
```bash
# Check current identity
aws sts get-caller-identity

# Re-login if needed
aws sso login --profile quick-grade-dev
```

### Layer Upload Errors
```bash
# Verify layer structure
node tests/verify-layer-structure.js

# Check AWS permissions
aws lambda list-layers --region us-east-1
```

### Deployment Issues
```bash
# Check if secret is set
sst secret list --stage dev

# Verify layer ARN
sst secret get CHROMIUM_LAYER_ARN --stage dev
```

### Layer Structure Problems
- Verify the zip contains `nodejs/node_modules/chromium-for-lambda/`
- Check that `index.js` exports correct `executablePath`
- Ensure `headless_shell` binary exists and has correct permissions

## Benefits

- **Manual Control**: Upload layers when needed, not on every deployment
- **Performance**: Functions get 93% smaller bundles and 75% faster cold starts  
- **SSO Integration**: Uses standard AWS SSO profiles per environment
- **Secret Management**: Layer ARNs stored securely as SST secrets
- **Multi-Account**: Proper isolation between dev and prod environments
