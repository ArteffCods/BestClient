#!/usr/bin/env bash
set -euo pipefail

# The friend service runs as a docker container behind the Coolify Traefik proxy, which
# already owns ports 80 and 443 and issues the certificate. Nothing here touches nginx or
# certbot: installing either would fight Traefik for the ports and quietly do nothing.

HOST="${1:-client.bestpvp.eu}"
ROOT="/opt/bestclient-api"
NAME="bestclient-api"
NETWORK="coolify"
APP_PORT=8080
PORT="${BC_DB_PORT:-3306}"

if [ "$(id -u)" -ne 0 ]; then
    echo "Run this as root, for example with sudo." >&2
    exit 1
fi

: "${BC_DB_HOST:?set BC_DB_HOST=... in front of the command}"
: "${BC_DB_NAME:?set BC_DB_NAME=... in front of the command}"
: "${BC_DB_USER:?set BC_DB_USER=... in front of the command}"
: "${BC_DB_PASS:?set BC_DB_PASS=... in front of the command}"

if ! command -v docker >/dev/null 2>&1; then
    echo "docker is not installed, and this service runs as a container." >&2
    exit 1
fi

if ! docker network inspect "${NETWORK}" >/dev/null 2>&1; then
    echo "The ${NETWORK} docker network is missing. Is the Coolify proxy running?" >&2
    exit 1
fi

echo "==> writing the service to ${ROOT}"
mkdir -p "${ROOT}/public"

cat > "${ROOT}/index.php" <<'BESTCLIENT_INDEX_PHP'
<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

const SESSION_DAYS = 30;
const ONLINE_SECONDS = 90;
const CHALLENGE_SECONDS = 120;
const MAX_FRIENDS = 200;

function fail(int $status, string $message): never
{
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_UNESCAPED_SLASHES);
    exit;
}

function done(array $payload): never
{
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $file = __DIR__ . '/config.php';

    if (!is_file($file)) {
        fail(500, 'The server is not configured yet.');
    }

    $config = require $file;

    try {
        $pdo = new PDO(
            sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $config['host'], $config['port'], $config['name']),
            $config['user'],
            $config['pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false],
        );
    } catch (PDOException $error) {
        fail(503, 'The database is not reachable.');
    }

    return $pdo;
}

function body(): array
{
    $raw = file_get_contents('php://input');

    if ($raw === false || $raw === '') {
        return [];
    }

    $parsed = json_decode($raw, true);

    return is_array($parsed) ? $parsed : [];
}

function text(array $source, string $key, int $limit): string
{
    $value = $source[$key] ?? '';

    return is_string($value) ? substr(trim($value), 0, $limit) : '';
}

function isUuid(string $value): bool
{
    return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', strtolower($value)) === 1;
}

function isName(string $value): bool
{
    return preg_match('/^[A-Za-z0-9_]{3,16}$/', $value) === 1;
}

function dashed(string $plain): string
{
    return strtolower(
        substr($plain, 0, 8) . '-' . substr($plain, 8, 4) . '-' . substr($plain, 12, 4)
        . '-' . substr($plain, 16, 4) . '-' . substr($plain, 20, 12),
    );
}

function get(string $url): ?array
{
    $context = stream_context_create(['http' => ['timeout' => 8, 'ignore_errors' => true]]);
    $raw = @file_get_contents($url, false, $context);

    if ($raw === false || $raw === '') {
        return null;
    }

    $parsed = json_decode($raw, true);

    return is_array($parsed) ? $parsed : null;
}

function caller(): array
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';

    if (stripos($header, 'Bearer ') !== 0) {
        fail(401, 'Sign in first.');
    }

    $token = substr($header, 7);

    if (!preg_match('/^[0-9a-f]{64}$/', $token)) {
        fail(401, 'Sign in first.');
    }

    $statement = db()->prepare(
        'SELECT s.uuid, p.name FROM bc_session s JOIN bc_player p ON p.uuid = s.uuid'
        . ' WHERE s.token = ? AND s.expires > NOW()',
    );
    $statement->execute([$token]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    if ($row === false) {
        fail(401, 'That sign in has run out.');
    }

    return $row;
}

function touch_player(string $uuid, string $name, string $server): void
{
    $statement = db()->prepare(
        'INSERT INTO bc_player (uuid, name, first_seen, last_seen, server)'
        . ' VALUES (?, ?, NOW(), NOW(), ?)'
        . ' ON DUPLICATE KEY UPDATE name = VALUES(name), last_seen = NOW(), server = VALUES(server)',
    );
    $statement->execute([$uuid, $name, $server]);
}

function seen(string $uuid): void
{
    db()->prepare('UPDATE bc_player SET last_seen = NOW() WHERE uuid = ?')->execute([$uuid]);
}

function befriend(string $one, string $other): void
{
    $insert = db()->prepare('INSERT IGNORE INTO bc_friend (uuid, friend, created) VALUES (?, ?, NOW())');
    $insert->execute([$one, $other]);
    $insert->execute([$other, $one]);

    $clear = db()->prepare('DELETE FROM bc_request WHERE (uuid = ? AND target = ?) OR (uuid = ? AND target = ?)');
    $clear->execute([$one, $other, $other, $one]);
}

$action = $_GET['a'] ?? '';

if ($action === 'health') {
    db();
    done(['ok' => true]);
}

if ($action === 'auth-begin') {
    $uuid = strtolower(text(body(), 'uuid', 36));

    if (!isUuid($uuid)) {
        fail(400, 'That is not a player id.');
    }

    $serverId = bin2hex(random_bytes(20));

    $statement = db()->prepare('INSERT INTO bc_challenge (server_id, uuid, created) VALUES (?, ?, NOW())');
    $statement->execute([$serverId, $uuid]);

    db()->prepare('DELETE FROM bc_challenge WHERE created < DATE_SUB(NOW(), INTERVAL ? SECOND)')
        ->execute([CHALLENGE_SECONDS]);

    done(['serverId' => $serverId]);
}

if ($action === 'auth-finish') {
    $input = body();
    $serverId = text($input, 'serverId', 40);
    $name = text($input, 'name', 16);

    if (!preg_match('/^[0-9a-f]{40}$/', $serverId) || !isName($name)) {
        fail(400, 'That sign in was not started here.');
    }

    $statement = db()->prepare(
        'SELECT uuid FROM bc_challenge WHERE server_id = ? AND created > DATE_SUB(NOW(), INTERVAL ? SECOND)',
    );
    $statement->execute([$serverId, CHALLENGE_SECONDS]);
    $claimed = $statement->fetchColumn();

    if ($claimed === false) {
        fail(400, 'That sign in was not started here.');
    }

    $profile = get(sprintf(
        'https://sessionserver.mojang.com/session/minecraft/hasJoined?username=%s&serverId=%s',
        rawurlencode($name),
        rawurlencode($serverId),
    ));

    if ($profile === null || !isset($profile['id'], $profile['name'])) {
        fail(403, 'Mojang did not confirm that account.');
    }

    $verified = dashed((string) $profile['id']);

    if ($verified !== strtolower((string) $claimed)) {
        fail(403, 'That account does not match the one that started the sign in.');
    }

    db()->prepare('DELETE FROM bc_challenge WHERE server_id = ?')->execute([$serverId]);

    touch_player($verified, (string) $profile['name'], '');

    $token = bin2hex(random_bytes(32));

    $statement = db()->prepare(
        'INSERT INTO bc_session (token, uuid, issued, expires) VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))',
    );
    $statement->execute([$token, $verified, SESSION_DAYS]);

    db()->prepare('DELETE FROM bc_session WHERE expires < NOW()')->execute();

    done(['token' => $token, 'uuid' => $verified, 'name' => (string) $profile['name']]);
}

$me = caller();

if ($action === 'presence') {
    $server = strtolower(text(body(), 'server', 96));

    touch_player($me['uuid'], $me['name'], $server);

    if ($server === '') {
        done(['players' => []]);
    }

    $statement = db()->prepare(
        'SELECT uuid FROM bc_player WHERE server = ? AND last_seen > DATE_SUB(NOW(), INTERVAL ? SECOND)',
    );
    $statement->execute([$server, ONLINE_SECONDS]);

    done(['players' => $statement->fetchAll(PDO::FETCH_COLUMN)]);
}

if ($action === 'friends') {
    seen($me['uuid']);

    $statement = db()->prepare(
        'SELECT p.uuid, p.name, p.server, p.last_seen > DATE_SUB(NOW(), INTERVAL ? SECOND) AS online'
        . ' FROM bc_friend f JOIN bc_player p ON p.uuid = f.friend'
        . ' WHERE f.uuid = ? ORDER BY online DESC, p.name ASC',
    );
    $statement->execute([ONLINE_SECONDS, $me['uuid']]);
    $friends = $statement->fetchAll(PDO::FETCH_ASSOC);

    $statement = db()->prepare(
        'SELECT p.uuid, p.name FROM bc_request r JOIN bc_player p ON p.uuid = r.uuid'
        . ' WHERE r.target = ? ORDER BY r.created DESC',
    );
    $statement->execute([$me['uuid']]);
    $incoming = $statement->fetchAll(PDO::FETCH_ASSOC);

    $statement = db()->prepare(
        'SELECT p.uuid, p.name FROM bc_request r JOIN bc_player p ON p.uuid = r.target'
        . ' WHERE r.uuid = ? ORDER BY r.created DESC',
    );
    $statement->execute([$me['uuid']]);
    $outgoing = $statement->fetchAll(PDO::FETCH_ASSOC);

    done([
        'me' => ['uuid' => $me['uuid'], 'name' => $me['name']],
        'friends' => array_map(static fn (array $row): array => [
            'uuid' => $row['uuid'],
            'name' => $row['name'],
            'server' => $row['server'],
            'online' => (bool) $row['online'],
        ], $friends),
        'incoming' => $incoming,
        'outgoing' => $outgoing,
    ]);
}

if ($action === 'add') {
    $name = text(body(), 'name', 16);

    if (!isName($name)) {
        fail(400, 'That is not a Minecraft name.');
    }

    $statement = db()->prepare('SELECT uuid, name FROM bc_player WHERE name = ?');
    $statement->execute([$name]);
    $target = $statement->fetch(PDO::FETCH_ASSOC);

    if ($target === false) {
        fail(404, $name . ' has not opened BestClient yet.');
    }

    if ($target['uuid'] === $me['uuid']) {
        fail(400, 'That is you.');
    }

    $statement = db()->prepare('SELECT COUNT(*) FROM bc_friend WHERE uuid = ?');
    $statement->execute([$me['uuid']]);

    if ((int) $statement->fetchColumn() >= MAX_FRIENDS) {
        fail(409, 'Your friend list is full.');
    }

    $statement = db()->prepare('SELECT 1 FROM bc_friend WHERE uuid = ? AND friend = ?');
    $statement->execute([$me['uuid'], $target['uuid']]);

    if ($statement->fetchColumn() !== false) {
        done(['state' => 'friends', 'name' => $target['name']]);
    }

    $statement = db()->prepare('SELECT 1 FROM bc_request WHERE uuid = ? AND target = ?');
    $statement->execute([$target['uuid'], $me['uuid']]);

    if ($statement->fetchColumn() !== false) {
        befriend($me['uuid'], $target['uuid']);
        done(['state' => 'friends', 'name' => $target['name']]);
    }

    $statement = db()->prepare(
        'INSERT IGNORE INTO bc_request (uuid, target, created) VALUES (?, ?, NOW())',
    );
    $statement->execute([$me['uuid'], $target['uuid']]);

    done(['state' => 'asked', 'name' => $target['name']]);
}

if ($action === 'accept') {
    $uuid = strtolower(text(body(), 'uuid', 36));

    if (!isUuid($uuid)) {
        fail(400, 'That is not a player id.');
    }

    $statement = db()->prepare('SELECT 1 FROM bc_request WHERE uuid = ? AND target = ?');
    $statement->execute([$uuid, $me['uuid']]);

    if ($statement->fetchColumn() === false) {
        fail(404, 'That request is gone.');
    }

    befriend($me['uuid'], $uuid);
    done(['state' => 'friends']);
}

if ($action === 'remove') {
    $uuid = strtolower(text(body(), 'uuid', 36));

    if (!isUuid($uuid)) {
        fail(400, 'That is not a player id.');
    }

    db()->prepare('DELETE FROM bc_friend WHERE (uuid = ? AND friend = ?) OR (uuid = ? AND friend = ?)')
        ->execute([$me['uuid'], $uuid, $uuid, $me['uuid']]);

    db()->prepare('DELETE FROM bc_request WHERE (uuid = ? AND target = ?) OR (uuid = ? AND target = ?)')
        ->execute([$me['uuid'], $uuid, $uuid, $me['uuid']]);

    done(['state' => 'gone']);
}

fail(404, 'No such call.');
BESTCLIENT_INDEX_PHP

umask 027

# Written from the shell rather than with php -r, because php is not installed on the
# host - it only exists inside the image.
escape() { printf '%s' "$1" | sed "s/\\\\/\\\\\\\\/g; s/'/\\\\'/g"; }

cat > "${ROOT}/config.php" <<CONFIG
<?php
return [
    'host' => '$(escape "${BC_DB_HOST}")',
    'port' => ${PORT},
    'name' => '$(escape "${BC_DB_NAME}")',
    'user' => '$(escape "${BC_DB_USER}")',
    'pass' => '$(escape "${BC_DB_PASS}")',
];
CONFIG

chmod 600 "${ROOT}/config.php"

# serve_site() answers 503 when public/ is missing, so leave a placeholder for the case
# where the landing page has not been uploaded yet.
if [ ! -f "${ROOT}/public/index.html" ]; then
    printf '<!doctype html><meta charset="utf-8"><title>BestClient</title><p>BestClient is here.\n' \
        > "${ROOT}/public/index.html"
fi

echo "==> building the image"
cat > "${ROOT}/Dockerfile" <<'DOCKERFILE'
FROM php:8.3-cli
RUN docker-php-ext-install pdo_mysql
DOCKERFILE

docker build -q -t "${NAME}:latest" "${ROOT}" >/dev/null

echo "==> starting the container behind the Coolify proxy"
docker rm -f "${NAME}" >/dev/null 2>&1 || true

docker run -d \
    --name "${NAME}" \
    --network "${NETWORK}" \
    --restart unless-stopped \
    -v "${ROOT}/index.php:/app/index.php:ro" \
    -v "${ROOT}/config.php:/app/config.php:ro" \
    -v "${ROOT}/public:/app/public:ro" \
    -l "traefik.enable=true" \
    -l "traefik.docker.network=${NETWORK}" \
    -l "traefik.http.routers.${NAME}.rule=Host(\`${HOST}\`)" \
    -l "traefik.http.routers.${NAME}.entrypoints=http" \
    -l "traefik.http.routers.${NAME}.service=${NAME}" \
    -l "traefik.http.routers.${NAME}-secure.rule=Host(\`${HOST}\`)" \
    -l "traefik.http.routers.${NAME}-secure.entrypoints=https" \
    -l "traefik.http.routers.${NAME}-secure.tls=true" \
    -l "traefik.http.routers.${NAME}-secure.service=${NAME}" \
    -l "traefik.http.services.${NAME}.loadbalancer.server.port=${APP_PORT}" \
    "${NAME}:latest" \
    php -S "0.0.0.0:${APP_PORT}" -t /app /app/index.php >/dev/null

echo "==> checking the container answers"
sleep 2
if docker exec "${NAME}" php -r "echo @file_get_contents('http://127.0.0.1:${APP_PORT}/?a=health') ?: '';" | grep -q '"ok"'; then
    echo "    the service answers inside the container"
else
    echo "    the service did not answer. The database details in ${ROOT}/config.php are the usual cause:"
    docker logs --tail 20 "${NAME}" || true
fi

echo
echo "Traefik picks the container up by its labels and handles the certificate."
echo "From your own computer this should print {\"ok\":true}:"
echo "    curl https://${HOST}/?a=health"
echo
echo "The landing page is separate - copy it into ${ROOT}/public/ (it is a read-only mount,"
echo "so new files appear straight away; only a changed index.php needs a container restart)."
