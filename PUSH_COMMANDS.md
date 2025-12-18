# Commands to Push Code

## Option 1: Using Personal Access Token (Easiest)

1. Create token at: https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Select `repo` scope
   - Copy the token

2. Run these commands:
```bash
cd "/Users/mondo/Manufacturer Agents/manufacture-agents"
git push origin main
```
- Username: your GitHub username
- Password: paste the token (not your GitHub password)

## Option 2: Configure Credential Helper (One-time)

```bash
git config --global credential.helper osxkeychain
```
Then use Option 1 - credentials will be saved in macOS Keychain.

## Option 3: Using SSH (if you have SSH keys)

```bash
cd "/Users/mondo/Manufacturer Agents/manufacture-agents"
git remote set-url origin git@github.com:noman-optimsync/manufacture-agents.git
git push origin main
```

## Verify your commit is ready:
```bash
git log --oneline -1
git status
```

