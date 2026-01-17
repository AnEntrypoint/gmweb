#!/bin/bash
# Setup: Chromium extension enablement script
set -e

echo "Setting up Chromium extension enablement..."

cat > /usr/local/bin/enable_chromium_extension.py << 'PYTHON'
#!/usr/bin/env python3
import json, os, sys

prefs_file = os.path.expanduser("~/.config/chromium/Default/Preferences")
if os.path.exists(prefs_file):
    try:
        with open(prefs_file) as f: prefs = json.load(f)
        prefs.setdefault("extensions", {}).setdefault("settings", {}).setdefault("jfeammnjpkecdekppnclgkkffahnhfhe", {})["active_bit"] = True
        with open(prefs_file, "w") as f: json.dump(prefs, f)
    except: pass
PYTHON

chmod +x /usr/local/bin/enable_chromium_extension.py

echo "Chromium extension setup complete"
