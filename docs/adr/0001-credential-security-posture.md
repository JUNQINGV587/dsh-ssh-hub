# Credential security posture

Secrets (passwords, private keys, passphrases) are stored **in plaintext** in the server store file, protected only by filesystem permissions (`0600`); machine-key encryption was considered and rejected. A same-user process on this machine can read any key we would encrypt with, so encryption would only defend against the file being copied elsewhere while adding key-rotation burden — a false sense of security. The explicit boundary is instead: secrets never leave the host process (the API returns only `hasPassword` / `hasPrivateKey` flags, and the export file uses the same secret-stripped Server View shape by construction).

Two corollaries, decided together with the above:

- **Switching a Server's Auth Kind clears orphaned secrets** (`agent`/`none` clears everything; `password` clears key + passphrase; `privateKey` clears password). Credentials for a method no longer in use must not linger on disk.
- **Import always creates new Servers** with fresh ids and never writes secret fields, even if an import file carries them. Re-entering secrets after import is a five-minute job; a merge/overwrite path or a secret-bearing export is a lifetime of leaked files.

## Considered Options

- Machine-key symmetric encryption of the store file — rejected (see above).
- Export with secrets included (encrypted archive) — rejected: the migration use case does not justify credentials leaving the host in a portable file.
- Import with overwrite/merge semantics — rejected: silently mutating a working server is worse than a duplicate the user deletes by hand.

## Consequences

- Users must re-enter secrets after an import; the UI says so in the import confirmation.
- The store file must never be committed, synced, or backed up to anywhere its plaintext content would be unacceptable — the README says this in user terms.
