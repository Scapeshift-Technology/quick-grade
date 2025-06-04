#!/bin/bash

# Script to manually invoke a cron Lambda function for debugging
# Usage: ./invoke-cron.sh <function-name-contains-string>
# Example: ./invoke-cron.sh TestCron
# Example: ./invoke-cron.sh UploadMLBPlayerTeamHistory

set -e

PROFILE="quick-grade-dev"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if function name substring is provided
if [ -z "$1" ]; then
    echo "Error: Function name substring is required."
    echo "Usage: $0 <function-name-contains-string>"
    echo ""
    echo "Example: $0 TestCron"
    echo "Example: $0 UploadMLBPlayerTeamHistory"
    echo ""
    echo "Available functions (list may be long):"
    aws lambda list-functions --profile $PROFILE --query "Functions[].FunctionName" --output text 2>/dev/null || true
    exit 1
fi

FUNCTION_NAME_CONTAINS="$1"

echo "Finding Lambda function containing: '$FUNCTION_NAME_CONTAINS'..."
# Query for functions containing the provided string in their name
FUNCTION_NAMES=$(aws lambda list-functions --profile $PROFILE --query "Functions[?contains(FunctionName, '$FUNCTION_NAME_CONTAINS')].FunctionName" --output text 2>/dev/null)

if [ -z "$FUNCTION_NAMES" ]; then
    echo "Error: Could not find any Lambda function containing '$FUNCTION_NAME_CONTAINS'."
    echo "Please check the name and try again."
    echo ""
    echo "Available functions (list may be long):"
    aws lambda list-functions --profile $PROFILE --query "Functions[].FunctionName" --output text 2>/dev/null || true
    exit 1
fi

# Count how many functions were found
FUNCTION_COUNT=$(echo "$FUNCTION_NAMES" | wc -w)

if [ "$FUNCTION_COUNT" -gt 1 ]; then
    echo "Error: Found multiple functions containing '$FUNCTION_NAME_CONTAINS':"
    echo "$FUNCTION_NAMES" | tr '\t' '\n' # Print each function name on a new line
    echo "Please provide a more specific string to uniquely identify the function."
    exit 1
elif [ "$FUNCTION_COUNT" -eq 1 ]; then
    FUNCTION_NAME="$FUNCTION_NAMES"
    echo "Found unique function: $FUNCTION_NAME"
else # Should not happen if FUNCTION_NAMES was not empty, but as a safeguard
    echo "Error: Unexpected issue identifying the function."
    exit 1
fi

echo ""
echo "Invoking function: $FUNCTION_NAME"
echo "Profile: $PROFILE"
echo "Payload file: $SCRIPT_DIR/test-cron-payload.json"
echo ""

# Check if payload file exists
if [ ! -f "$SCRIPT_DIR/test-cron-payload.json" ]; then
    echo "Error: Payload file not found at $SCRIPT_DIR/test-cron-payload.json"
    echo "Ensure a generic payload suitable for scheduled events exists at this location."
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
    echo "Function response (raw from $SCRIPT_DIR/response.json):"
    cat "$SCRIPT_DIR/response.json"
    echo ""

    echo "Function response (decoded logs if present, and payload):"
    # Attempt to decode and print logs if log result is present
    LOG_RESULT_ENCODED=$(jq -r '.LogResult // empty' "$SCRIPT_DIR/response.json")
    if [ -n "$LOG_RESULT_ENCODED" ]; then
        echo "---- Decoded Logs ----"
        echo "$LOG_RESULT_ENCODED" | base64 --decode
        echo "-- End Decoded Logs --"
    fi

    # Print the payload (output of the function) nicely formatted if it's JSON
    PAYLOAD_OUTPUT=$(jq -r '.Payload // empty' "$SCRIPT_DIR/response.json")
    if [ -n "$PAYLOAD_OUTPUT" ]; then
        echo "---- Function Output Payload ----"
        # Check if payload is JSON and pretty print, otherwise cat
        if echo "$PAYLOAD_OUTPUT" | jq '.' > /dev/null 2>&1; then
            echo "$PAYLOAD_OUTPUT" | jq '.'
        else
            echo "$PAYLOAD_OUTPUT"
        fi
        echo "-- End Function Output Payload --"
    fi
    echo ""
    
    # Check if response indicates an error from the Lambda execution itself
    if jq -e '.FunctionError // empty' "$SCRIPT_DIR/response.json" > /dev/null || grep -q '"errorType"' "$SCRIPT_DIR/response.json" ; then
        echo "⚠️  Function execution resulted in an error! (logged in function output or response.json)"
    elif [ $INVOKE_RESULT -ne 0 ]; then
        echo "⚠️  AWS CLI invoke command failed (exit code $INVOKE_RESULT). Check AWS CLI error messages above."
    else
        echo "✅ Function invoked successfully by AWS CLI. Check logs and output payload for function-specific success/failure."
    fi
else
    echo "❌ No response file found - AWS CLI invoke command likely failed before creating it."
fi

echo "" 