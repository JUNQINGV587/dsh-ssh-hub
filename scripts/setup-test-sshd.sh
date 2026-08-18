#!/usr/bin/env bash
# CI-ready test sshd: creates a throwaway sshd on 127.0.0.1:2222 with key auth.
# The plugin integration tests expect SSH_TEST_HOST=127.0.0.1 SSH_TEST_PORT=2222
# SSH_TEST_KEY pointing at the generated client private key.
set -euo pipefail

PORT="${SSH_TEST_PORT:-2222}"
WORK="${SSH_TEST_WORK:-/tmp/dsh-multi-server-test-sshd}"
rm -rf "$WORK"
mkdir -p "$WORK"

# Host key
ssh-keygen -q -t ed25519 -N "" -f "$WORK/host_key" <<<y >/dev/null 2>&1

# Client key (auth as the current user, PermitRootLogin not required)
ssh-keygen -q -t ed25519 -N "" -f "$WORK/client_key" <<<y >/dev/null 2>&1
cp "$WORK/client_key.pub" "$WORK/authorized_keys"

cat > "$WORK/sshd_config" <<EOF
Port $PORT
ListenAddress 127.0.0.1
HostKey $WORK/host_key
PidFile $WORK/sshd.pid
PermitRootLogin yes
PubkeyAuthentication yes
PasswordAuthentication no
AuthorizedKeysFile $WORK/authorized_keys
UsePAM no
StrictModes no
Subsystem sftp internal-sftp
EOF

/usr/sbin/sshd -f "$WORK/sshd_config" -D &
SSHD_PID=$!
# wait for the port
for _ in $(seq 1 50); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
    exec 3>&- 3<&-
    break
  fi
  sleep 0.1
done

echo "test sshd up on 127.0.0.1:$PORT (pid $SSHD_PID)"
echo "SSH_TEST_HOST=127.0.0.1 SSH_TEST_PORT=$PORT SSH_TEST_KEY=$WORK/client_key"
trap 'kill $SSHD_PID 2>/dev/null || true' EXIT
wait "$SSHD_PID"
