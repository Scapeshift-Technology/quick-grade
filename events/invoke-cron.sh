#!/bin/bash

# Script to manually invoke the TestCron function for debugging
# Usage: ./invoke-cron.sh [function-name]

set -e

PROFILE="quick-grade-dev"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Try to find the TestCron function specifically if not provided
if [ -z "$1" ]; then
    echo "Finding TestCron function..."
    FUNCTION_NAME=$(aws lambda list-functions --profile $PROFILE --query "Functions[?contains(FunctionName, 'TestCron')].FunctionName" --output text 2>/dev/null)
    
    if [ -z "$FUNCTION_NAME" ]; then
        echo "Could not find TestCron function automatically."
        echo "Please provide the function name as an argument:"
        echo "Usage: $0 <function-name>"
        echo ""
        echo "Available functions:"
        aws lambda list-functions --profile $PROFILE --query "Functions[].FunctionName" --output text 2>/dev/null
        exit 1
    fi
    
    # If multiple functions found, take the first one and warn
    FUNCTION_COUNT=$(echo "$FUNCTION_NAME" | wc -w)
    if [ "$FUNCTION_COUNT" -gt 1 ]; then
        echo "Multiple TestCron functions found. Using the first one:"
        FUNCTION_NAME=$(echo "$FUNCTION_NAME" | awk '{print $1}')
        echo "Selected: $FUNCTION_NAME"
    fi
else
    FUNCTION_NAME="$1"
fi

echo "Invoking function: $FUNCTION_NAME"
echo "Profile: $PROFILE"
echo "Payload file: $SCRIPT_DIR/test-cron-payload.json"
echo ""

# Check if payload file exists
if [ ! -f "$SCRIPT_DIR/test-cron-payload.json" ]; then
    echo "Error: Payload file not found at $SCRIPT_DIR/test-cron-payload.json"
    exit 1
fi

# Invoke the function
echo "Executing AWS Lambda invoke..."
aws lambda invoke \
    --profile $PROFILE \
    --function-name "$FUNCTION_NAME" \
    --payload "file://$SCRIPT_DIR/test-cron-payload.json" \
    --cli-binary-format raw-in-base64-out \
    --log-type Tail \
    "$SCRIPT_DIR/response.json" 2>&1

INVOKE_RESULT=$?

echo ""
echo "Invoke command exit code: $INVOKE_RESULT"
echo "Response saved to: $SCRIPT_DIR/response.json"
echo ""

if [ -f "$SCRIPT_DIR/response.json" ]; then
    echo "Function response:"
    if command -v jq &> /dev/null; then
        cat "$SCRIPT_DIR/response.json" | jq '.'
    else
        cat "$SCRIPT_DIR/response.json"
    fi
    echo ""
    
    # Check if response contains error
    if grep -q '"errorType"' "$SCRIPT_DIR/response.json"; then
        echo "⚠️  Function execution failed with an error!"
        echo "This might be due to:"
        echo "  1. TypeScript compilation issues"
        echo "  2. Missing dependencies"
        echo "  3. Environment variable issues"
        echo "  4. SST Live Lambda not running properly"
    else
        echo "✅ Function executed successfully!"
    fi
else
    echo "❌ No response file found - invoke may have failed"
fi

echo "" 