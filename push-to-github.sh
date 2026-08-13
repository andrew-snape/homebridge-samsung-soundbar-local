#!/usr/bin/env bash
#
# Initialise this folder as a git repo and push it to GitHub.
#
#   chmod +x push-to-github.sh
#   ./push-to-github.sh
#
# Optionally override the defaults:
#   ./push-to-github.sh myusername my-repo-name
#
# Create the empty repository on GitHub first, with no README, no .gitignore
# and no licence, since this folder already has all three.

set -euo pipefail

GH_USER="${1:-snapeos}"
REPO="${2:-homebridge-samsung-soundbar-local}"
BRANCH="main"

cd "$(dirname "$0")"

echo "Repository: https://github.com/${GH_USER}/${REPO}"
echo "Folder:     $(pwd)"
echo

# --- sanity checks --------------------------------------------------------

if [ ! -f package.json ]; then
  echo "ERROR: no package.json here. Run this from inside the plugin folder."
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is not installed."
  exit 1
fi

# --- gitignore ------------------------------------------------------------

if [ ! -f .gitignore ]; then
  echo "Creating .gitignore"
  cat > .gitignore <<'EOF'
node_modules/
dist/
*.log
.DS_Store
*.tgz
EOF
fi

# --- make sure nothing sensitive sneaks in --------------------------------

if ls homebridge-config*.json >/dev/null 2>&1; then
  echo "WARNING: a homebridge-config.json is in this folder."
  echo "That file contains live credentials and must not be committed."
  echo "Move it elsewhere, then run this script again."
  exit 1
fi

# --- init -----------------------------------------------------------------

if [ ! -d .git ]; then
  echo "Initialising repository"
  git init -q
  git branch -M "$BRANCH"
else
  echo "Repository already initialised"
fi

# --- commit ---------------------------------------------------------------

git add .

echo
echo "Files staged:"
git diff --cached --name-only | sed 's/^/  /'
echo

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -q -m "Local HomeKit control for Samsung D-series soundbars

Talks directly to the soundbar's IP Control JSON-RPC service on port 1516.
No SmartThings account and no cloud round trip.

Verified against HW-Q930D. Exposes power, input selection, volume and mute
as a HomeKit Television accessory."
  echo "Committed."
fi

# --- remote ---------------------------------------------------------------

REMOTE_URL="git@github.com:${GH_USER}/${REPO}.git"

if git remote get-url origin >/dev/null 2>&1; then
  CURRENT=$(git remote get-url origin)
  if [ "$CURRENT" != "$REMOTE_URL" ]; then
    echo "Updating origin: $CURRENT -> $REMOTE_URL"
    git remote set-url origin "$REMOTE_URL"
  fi
else
  echo "Adding origin: $REMOTE_URL"
  git remote add origin "$REMOTE_URL"
fi

# --- push -----------------------------------------------------------------

echo
echo "Pushing to $BRANCH..."
if git push -u origin "$BRANCH"; then
  echo
  echo "Done: https://github.com/${GH_USER}/${REPO}"
else
  echo
  echo "Push failed. Common causes:"
  echo "  - The repository does not exist yet on GitHub. Create it empty first."
  echo "  - SSH key not set up for GitHub. Test with: ssh -T git@github.com"
  echo "  - Using HTTPS instead of SSH. To switch:"
  echo "      git remote set-url origin https://github.com/${GH_USER}/${REPO}.git"
  exit 1
fi
