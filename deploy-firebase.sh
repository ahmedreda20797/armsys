#!/bin/bash
# ============================================
# ARM ERP - Firebase App Hosting Deployment
# ============================================

set -e

echo "=== ARM ERP - Firebase Deployment ==="
echo ""

# Check Firebase CLI
if ! command -v firebase &> /dev/null; then
    echo "🔧 Installing Firebase CLI..."
    npm install -g firebase-tools
fi

# Check login
echo "📱 Checking Firebase login..."
firebase login --no-localhost 2>/dev/null || firebase login

PROJECT="arm-erp-project"
REGION="europe-west1"

echo ""
echo "📦 Deploying to Firebase App Hosting..."
echo "   Project: $PROJECT"
echo "   Region:  $REGION"
echo ""

# Deploy
firebase deploy --project "$PROJECT"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "NOTE: If this is the FIRST deployment, run this first:"
echo "  firebase apphosting:backends:create --project $PROJECT --region $REGION"
echo ""
echo "Environment variables must be set in Firebase Console:"
echo "  https://console.firebase.google.com/project/$PROJECT/apphosting/backends"
echo ""