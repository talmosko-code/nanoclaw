# Cabinet systemd (UID 1000)

Units run as **`developer`** (UID/GID 1000 on this host), matching NanoClaw agent containers.

## Why `/home/developer/cabinet`

`/root` is usually `700`, so UID 1000 cannot `cd` to `/root/Documents/cabinet`. Install the app under the service user’s home (or another path they can read).

## One-time setup

```bash
#1) Copy tree (or clone fresh) and own it
sudo cp -a /root/Documents/cabinet /home/developer/cabinet
sudo chown -R developer:developer /home/developer/cabinet

# 2) Link NanoClaw groups *before* first build, then exclude them from TypeScript (symlink pulls .ts into the app)
sudo -u developer mkdir -p /home/developer/cabinet/data
sudo -u developer ln -sfn /root/Documents/nanoclaw/groups /home/developer/cabinet/data/nanoclaw-groups
# In tsconfig.json: "exclude": ["node_modules", "data/nanoclaw-groups"]
# In next.config.ts outputFileTracingExcludes "/*": add "data/nanoclaw-groups/**/*"

# 3) Production build (as developer)
sudo -u developer -H bash -lc 'cd /home/developer/cabinet && npm ci && npm run build'

# 4) Env: copy .env.local and set KB_PASSWORD, ports, origins if needed
sudo -u developer cp /home/developer/cabinet/.env.example /home/developer/cabinet/.env.local
sudo chown developer:developer /home/developer/cabinet/.env.local
# Edit .env.local (optional: create .env.production with only KEY=value lines for EnvironmentFile=)
```

If NanoClaw stays under `/root/Documents/nanoclaw`, UID 1000 must be able to **traverse** those directories to follow the symlink (e.g. `sudo chmod 711 /root /root/Documents /root/Documents/nanoclaw`) or move the repo to a shared path like `/srv/nanoclaw` with `chown -R developer:developer` on `groups/` only—pick what fits your security model.

## Install units

```bash
sudo cp /root/Documents/nanoclaw/scripts/cabinet-systemd/cabinet-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cabinet-next.service cabinet-daemon.service
sudo systemctl status cabinet-next.service cabinet-daemon.service
```

Logs: `journalctl -u cabinet-next.service -f` and `journalctl -u cabinet-daemon.service -f`.

## Change install path

If Cabinet lives somewhere else, edit `WorkingDirectory=` in both units and run `sudo systemctl daemon-reload`.
