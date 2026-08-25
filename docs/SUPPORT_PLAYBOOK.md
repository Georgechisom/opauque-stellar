# Support playbook

This project is designed so that support can help with diagnostics and recovery guidance without ever seeing the secrets that make the wallet private.

## What support may inspect

Support can review:

- the app version and build metadata
- the configured network
- deployed contract IDs from the active deployment manifest
- feature-flag state relevant to the issue
- non-sensitive sync health such as scanner status, latest ledger, and last successful refresh time
- redacted error reports and sanitized diagnostics exports

These are intentionally limited to values that identify a bug or a failed state, not a user or a note.

## What users must provide

To investigate a support issue, the user should provide:

1. A sanitized diagnostics export from the app.
2. The exact flow they were attempting, including the action and the screen or route.
3. Whether the issue happened on testnet or mainnet.
4. A recent screenshot or error text, if available.
5. Any relevant public transaction hashes, if they already exist and are safe to share.

Users should not paste raw metadata, full wallet addresses, payment links with sensitive query strings, nullifiers, proofs, or private keys in public issues or email threads.

## What support cannot recover

Opaque is intentionally backend-free for wallet state and privacy data. The app does not keep a centrally recoverable copy of the user's private notes, keys, proofs, or wallet metadata. Support cannot:

- restore a lost local key or backup password
- recover a deleted note, secret, or nullifier from browser storage
- reverse a successful on-chain transaction or cancelled proof
- decrypt a backup without the same password or device state that was used at export time
- infer a user's hidden address or exact private spending material from a sanitized diagnostics export

If a user loses local data, the only safe options are the user's own backup, wallet seed recovery, or re-deriving state from the relevant on-chain history.

## How to export diagnostics safely

1. Open the Security & Recovery settings page.
2. Open the diagnostics section.
3. Use the "Review diagnostics export" action to inspect the JSON before sharing.
4. Download the JSON file only after confirming it contains app version, network, deployment metadata, feature flags, and scrubbed error details.
5. Share the file with support or attach it to the issue if the user is comfortable doing so.

## Recovery policy and documentation guidance

Docs must not imply that support can recover local wallet data from the browser or restore privacy metadata after it is lost. The supported recovery path is user-controlled backup, local export, or a clear explanation of what information is unavailable because of the privacy model.

The privacy policy and support guidance should refer users to the app's local backup and recovery flow rather than promising a server-side recovery service.
