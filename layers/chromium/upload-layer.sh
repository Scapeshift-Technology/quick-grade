#!/bin/bash

# Upload Chromium Layer to AWS Lambda
# This script uploads the pre-built layer.zip to AWS Lambda layers
# 
# Usage:
#   1. Login to AWS SSO: aws sso login --profile quick-grade-dev
#   2. Run script: ./upload-layer.sh --profile quick-grade-dev --file path/to/your/layer.zip
#   3. Copy the ARN output and set as secret: sst secret set CHROMIUM_LAYER_ARN "arn:..." --stage dev

set -e  # Exit on error

# Parse command line arguments
if [ $# -ne 4 ] || [ "$1" != "--profile" ] || [ "$3" != "--file" ]; then
  echo "Error: Invalid arguments"
  echo "Usage: $0 --profile <aws-profile-name> --file <path-to-zip-file>"
  echo ""
  echo "Examples:"
  echo "  $0 --profile quick-grade-dev --file ./layer.zip"
  echo "  $0 --profile quick-grade-prod --file ../custom-layer.zip"
  exit 1
fi

AWS_PROFILE="$2"
LAYER_ZIP_PATH="$4"

echo "🚀 Uploading Chromium layer using profile: $AWS_PROFILE with file: $LAYER_ZIP_PATH"

# Validate that the provided file is a zip file
if [[ "$LAYER_ZIP_PATH" != *.zip ]]; then
  echo "❌ Error: The provided file must be a .zip file."
  echo "Provided file: $LAYER_ZIP_PATH"
  exit 1
fi

# Check if AWS profile exists
if ! aws configure list-profiles | grep -q "^${AWS_PROFILE}$"; then
  echo "❌ Error: AWS profile '$AWS_PROFILE' does not exist"
  echo ""
  echo "Please configure the profile first:"
  echo "  aws configure sso --profile $AWS_PROFILE"
  echo ""
  echo "Then login:"
  echo "  aws sso login --profile $AWS_PROFILE"
  exit 1
fi

echo "✅ AWS profile '$AWS_PROFILE' found"

# Configuration
LAYER_NAME="chromium-for-lambda-quick-grade"
LAYER_DESCRIPTION="Chromium for AWS Lambda using chromium-for-lambda package (Profile: $AWS_PROFILE)"
RUNTIME="nodejs20.x"
ARCHITECTURE="arm64"
AWS_REGION="${AWS_REGION:-us-east-1}"

echo "📦 Layer file: $LAYER_ZIP_PATH"
echo "📏 Layer size: $(du -h "$LAYER_ZIP_PATH" | cut -f1)"

# Verify AWS access with the specified profile
echo "🔍 Verifying AWS access with profile '$AWS_PROFILE'..."
CURRENT_USER=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query 'Arn' --output text 2>/dev/null || echo "FAILED")
if [ "$CURRENT_USER" = "FAILED" ]; then
    echo "❌ Error: Unable to access AWS with profile '$AWS_PROFILE'"
    echo ""
    echo "Please login first:"
    echo "  aws sso login --profile $AWS_PROFILE"
    echo ""
    echo "If you continue to have issues, reconfigure the profile:"
    echo "  aws configure sso --profile $AWS_PROFILE"
    exit 1
fi
echo "✅ AWS access verified: $CURRENT_USER"

# Get AWS account number for globally unique bucket name
ACCOUNT_NUMBER=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query 'Account' --output text)
S3_BUCKET="quick-grade-chromium-layer-bucket-${ACCOUNT_NUMBER}"
echo "📂 Using S3 bucket: $S3_BUCKET"

# Check if the bucket exists, create if not
echo "🔍 Checking if S3 bucket exists..."
if ! aws s3api head-bucket --bucket "$S3_BUCKET" --region "$AWS_REGION" --profile "$AWS_PROFILE" 2>/dev/null; then
  echo "📦 Creating S3 bucket $S3_BUCKET..."
  aws s3 mb "s3://${S3_BUCKET}" --region "$AWS_REGION" --profile "$AWS_PROFILE"
  echo "✅ Bucket created successfully"
else
  echo "✅ Bucket already exists"
fi

# Upload the layer zip to S3
echo "☁️ Uploading layer to S3..."
TIMESTAMP=$(date +%Y%m%d%H%M%S)
S3_KEY="layers/${LAYER_NAME}/${TIMESTAMP}/layer.zip"
aws s3 cp "$LAYER_ZIP_PATH" "s3://${S3_BUCKET}/${S3_KEY}" --region "$AWS_REGION" --profile "$AWS_PROFILE"
echo "✅ Upload to S3 completed"

# Publish the layer from S3
echo "🏗️ Publishing Lambda layer..."
LAYER_VERSION_ARN=$(aws lambda publish-layer-version \
  --layer-name $LAYER_NAME \
  --description "$LAYER_DESCRIPTION" \
  --content "S3Bucket=${S3_BUCKET},S3Key=${S3_KEY}" \
  --compatible-runtimes $RUNTIME \
  --compatible-architectures $ARCHITECTURE \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE" \
  --query 'LayerVersionArn' \
  --output text)

echo ""
echo "🎉 Layer uploaded successfully!"
echo "📋 Layer Details:"
echo "   Name: $LAYER_NAME"
echo "   Profile: $AWS_PROFILE"
echo "   Region: $AWS_REGION"
echo "   ARN: $LAYER_VERSION_ARN"
echo ""
echo "🔧 Next steps:"
echo "   1. Set the layer ARN as a secret:"
echo "      sst secret set CHROMIUM_LAYER_ARN \"$LAYER_VERSION_ARN\""
echo ""
echo "   2. Deploy your application:"
echo "      sst deploy"
echo ""
echo "✅ Layer ready for deployment!" 