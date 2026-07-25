# Scheduled State Backups for Protocol Services

The ASP indexer, reputation publisher, and relayer each maintain local state that is
not recoverable from on-chain data alone. This guide covers scheduled encrypted backups,
restore verification, and retention policy for each service.

## What needs backing up

| Service | State directory | Why it cannot be rebuilt from chain |
|:--|:--|:--|
| ASP | `asp/data/` | Approved-set membership decisions and incremental event cursor |
| Publisher | `publisher/data/` | Holder-submitted leaf commitments (private, never on-chain) |
| Relayer | `~/.opaque-relayer/` or the directory set by `RELAYER_DATA_DIR` | Job history and operator registration metadata |

The publisher's inbox is the most critical: leaf commitments are submitted off-chain by
holders and cannot be reconstructed from public events. Losing them means affected
holders must resubmit their leaves.

## Backup script

Save this as `/usr/local/bin/opaque-backup` and make it executable (`chmod +x`):

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="${OPAQUE_BACKUP_DIR:-/var/backups/opaque}"
REPO_ROOT="${OPAQUE_REPO_ROOT:-/srv/opaque/stellar}"
PASSPHRASE_FILE="${OPAQUE_BACKUP_PASSPHRASE_FILE:-/etc/opaque/backup-passphrase}"
RETENTION_DAYS="${OPAQUE_BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")

mkdir -p "$BACKUP_ROOT"

backup_service() {
  local name="$1"
  local src="$2"
  local dest="$BACKUP_ROOT/${name}-${TIMESTAMP}.tar.gz.gpg"

  if [[ ! -d "$src" ]]; then
    echo "SKIP: $name — $src does not exist"
    return
  fi

  tar -czf - -C "$(dirname "$src")" "$(basename "$src")" \
    | gpg --batch --yes --passphrase-file "$PASSPHRASE_FILE" \
          --symmetric --cipher-algo AES256 \
          -o "$dest"

  echo "OK: $name -> $dest ($(du -sh "$dest" | cut -f1))"
}

backup_service asp       "$REPO_ROOT/asp/data"
backup_service publisher "$REPO_ROOT/publisher/data"
backup_service relayer   "${RELAYER_DATA_DIR:-$HOME/.opaque-relayer}"

# Prune old backups
find "$BACKUP_ROOT" -name "*.tar.gz.gpg" -mtime "+${RETENTION_DAYS}" -delete
echo "Pruned backups older than ${RETENTION_DAYS} days"
```

Generate and store the passphrase once:

```bash
openssl rand -base64 32 | sudo tee /etc/opaque/backup-passphrase > /dev/null
sudo chmod 600 /etc/opaque/backup-passphrase
```

## Scheduling with cron

Run backups every 6 hours:

```bash
sudo crontab -e
```

```cron
0 */6 * * * /usr/local/bin/opaque-backup >> /var/log/opaque-backup.log 2>&1
```

## Scheduling with systemd timer (alternative)

```ini
# /etc/systemd/system/opaque-backup.service
[Unit]
Description=Opaque protocol service state backup

[Service]
Type=oneshot
User=root
ExecStart=/usr/local/bin/opaque-backup
StandardOutput=journal
StandardError=journal
```

```ini
# /etc/systemd/system/opaque-backup.timer
[Unit]
Description=Run Opaque backup every 6 hours

[Timer]
OnCalendar=*-*-* 00,06,12,18:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now opaque-backup.timer
sudo systemctl list-timers opaque-backup.timer
```

## Restore procedure

```bash
# List available backups
ls -lh /var/backups/opaque/

# Decrypt and extract a specific backup
gpg --batch --passphrase-file /etc/opaque/backup-passphrase \
    --decrypt /var/backups/opaque/publisher-20260101T120000Z.tar.gz.gpg \
  | tar -xzf - -C /tmp/opaque-restore/

# Inspect the restored tree
ls -la /tmp/opaque-restore/data/

# Stop the service before restoring live state
sudo systemctl stop opaque-publisher

# Replace live state
rsync -a --delete /tmp/opaque-restore/data/ /srv/opaque/stellar/publisher/data/

# Restart
sudo systemctl start opaque-publisher
```

## Automated restore verification

Save this as `/usr/local/bin/opaque-verify-backup` and schedule it weekly:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="${OPAQUE_BACKUP_DIR:-/var/backups/opaque}"
PASSPHRASE_FILE="${OPAQUE_BACKUP_PASSPHRASE_FILE:-/etc/opaque/backup-passphrase}"
RESTORE_TMP=$(mktemp -d)
trap 'rm -rf "$RESTORE_TMP"' EXIT

FAILURES=0

for service in asp publisher relayer; do
  latest=$(ls -t "$BACKUP_ROOT/${service}"-*.tar.gz.gpg 2>/dev/null | head -1)
  if [[ -z "$latest" ]]; then
    echo "FAIL: no backup found for $service"
    FAILURES=$((FAILURES + 1))
    continue
  fi

  if gpg --batch --passphrase-file "$PASSPHRASE_FILE" \
         --decrypt "$latest" 2>/dev/null \
       | tar -tzf - > /dev/null 2>&1; then
    echo "OK: $service — $(basename "$latest") is readable"
  else
    echo "FAIL: $service — $(basename "$latest") failed integrity check"
    FAILURES=$((FAILURES + 1))
  fi
done

if [[ $FAILURES -gt 0 ]]; then
  echo "Backup verification: $FAILURES failure(s)" >&2
  exit 1
fi

echo "Backup verification: all services OK"
```

Schedule weekly:

```cron
0 3 * * 0 /usr/local/bin/opaque-verify-backup >> /var/log/opaque-backup.log 2>&1
```

## Retention policy

| Service | Retention | Rationale |
|:--|:--|:--|
| ASP | 30 days | Event cursor can be rebuilt from chain if needed; 30 days covers any incident response window |
| Publisher | 90 days | Leaf commitments are irreplaceable; longer retention protects against silent data loss |
| Relayer | 30 days | Job history is informational; operator key and registration are the critical items |

Override defaults by setting `OPAQUE_BACKUP_RETENTION_DAYS` in the backup script's
environment before running it, or by setting separate retention values per service in
a wrapper script.

## Off-site replication

For production, replicate backups to a second location. Example using `rclone` to S3:

```bash
# Configure rclone once
rclone config

# Add to the backup script after the prune step
rclone sync "$BACKUP_ROOT" s3:your-bucket/opaque-backups/ \
  --s3-sse AES256 \
  --log-level INFO
```

Ensure the S3 bucket has versioning enabled and a lifecycle rule that matches the
retention policy above.
