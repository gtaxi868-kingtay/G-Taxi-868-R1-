#!/bin/zsh

# 1. Set Android SDK Path
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools

# 2. Force Java 17 (Required for Expo 50+)
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
export PATH=$JAVA_HOME/bin:$PATH

if [[ $(java -version 2>&1) == *"17"* ]]; then
  echo "✅ Java 17 successfully activated."
else
  echo "❌ Error: Java 17 activation failed. Current version below:"
  java -version
fi

echo "✅ Environment variables set for CURRENT session."
echo "To make these permanent, add the following to your ~/.zshrc:"
echo ""
echo 'export ANDROID_HOME=$HOME/Library/Android/sdk'
echo 'export PATH=$PATH:$ANDROID_HOME/emulator'
echo 'export PATH=$PATH:$ANDROID_HOME/platform-tools'
